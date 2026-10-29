import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../db/sqlite.mjs';
import {flushDigest,payload,webhookURL,startDigestWorker} from '../scripts/medal-digest.mjs';
const url='https://discord.com/api/webhooks/123/test-token';
function fixture(){const adapter=openDatabase(':memory:');const db=adapter.sqlite;
 db.prepare("INSERT INTO personnel(id,name,steam_id,enlisted) VALUES ('p','Player @everyone','s','now')").run();
 db.prepare("INSERT INTO medals(id,name,description,created) VALUES ('m','Service medal','Description','now')").run();
 return db;}
function award(db,id){db.prepare('INSERT INTO medal_awards(id,medal_id,user_id,created) VALUES (?,?,?,?)').run(id,'m','p',new Date().toISOString());}
const ack=async()=>({ok:true,status:200,json:async()=>({id:'discord-message'})});

test('awards share a persistent fifteen-minute batch; no early sends or historical replay',async()=>{
 const db=fixture();try{
  assert.equal(db.prepare('SELECT count(*) AS n FROM discord_medal_batches').get().n,0);
  award(db,'a');award(db,'b');const batch=db.prepare('SELECT * FROM discord_medal_batches').get();
  assert.ok(batch.due_at>=Math.floor(Date.now()/1000)+899);
  let sent=0;
  const send=async(u,o)=>{sent++;const body=JSON.parse(o.body);assert.equal(body.embeds.length,1);assert.equal(body.embeds[0].description.split('\n').filter(line=>line.startsWith('•')).length,2);assert.doesNotMatch(body.embeds[0].description,/×/);assert.deepEqual(body.allowed_mentions,{parse:[]});return ack();};
  assert.equal(await flushDigest(db,url,{now:batch.due_at-1,send}),false);assert.equal(sent,0);
  assert.equal(await flushDigest(db,url,{now:batch.due_at,send}),true);assert.equal(sent,1);
  assert.equal(await flushDigest(db,url,{now:batch.due_at+100,send}),false);assert.equal(sent,1);
 }finally{db.close();}
});
test('revoked awards are omitted and an empty batch never posts',async()=>{
 const db=fixture();try{award(db,'a');db.prepare("UPDATE medal_awards SET revoked_at='now'").run();let sent=0;
 await flushDigest(db,url,{now:Math.floor(Date.now()/1000)+901,send:async()=>{sent++;return ack();}});assert.equal(sent,0);
 }finally{db.close();}
});
test('rate limit is retried later and an active lease prevents competing workers',async()=>{
 const db=fixture();try{award(db,'a');const now=Math.floor(Date.now()/1000)+901;
 await flushDigest(db,url,{now,send:async()=>({status:429,ok:false,json:async()=>({retry_after:60})})});
 assert.equal(db.prepare('SELECT retry_at FROM discord_medal_batches').get().retry_at,now+60);
 let sent=0;assert.equal(await flushDigest(db,url,{now:now+30,send:async()=>{sent++;return ack();}}),false);
 let release;const sending=flushDigest(db,url,{now:now+60,send:()=>new Promise(r=>{release=r;})});
 assert.equal(await flushDigest(db,url,{now:now+61,send:async()=>{sent++;return ack();}}),false);release(await ack());await sending;assert.equal(sent,0);
 }finally{db.close();}
});
test('invalid destinations rejected, payload bounded, explicitly disabled workers do not start',()=>{
 for(const value of ['http://discord.com/api/webhooks/1/t','https://example.com/api/webhooks/1/t','https://discord.com.evil/api/webhooks/1/t'])assert.throws(()=>webhookURL(value));
 const message=payload(Array.from({length:1000},(_,i)=>({name:'Member '+i,medal:'Award'})),1);
 assert.ok(message.embeds[0].description.length<4096);
 const prior=process.env.DISCORD_MEDALS_ENABLED;process.env.DISCORD_MEDALS_ENABLED='false';try{assert.doesNotThrow(()=>startDigestWorker({}));}finally{if(prior===undefined)delete process.env.DISCORD_MEDALS_ENABLED;else process.env.DISCORD_MEDALS_ENABLED=prior;}
});

test('mixed batch omits revoked awards, including revocations before a retry',async()=>{
 const db=fixture();try{
  award(db,'keep');award(db,'revoke');
  db.prepare("UPDATE medal_awards SET revoked_at='now' WHERE id='revoke'").run();
  const now=Math.floor(Date.now()/1000)+901;
  await flushDigest(db,url,{now,send:async(u,o)=>{assert.equal(JSON.parse(o.body).embeds[0].description.split('\n').filter(line=>line.startsWith('•')).length,1);return {ok:false,status:500};}});
  db.prepare("UPDATE medal_awards SET revoked_at='now' WHERE id='keep'").run();
  let sends=0;await flushDigest(db,url,{now:now+3601,send:async()=>{sends++;return ack();}});
  assert.equal(sends,0);
 }finally{db.close();}
});

test('environment webhook can be blank and configured without exposing a saved URL',async()=>{
 const {environmentWebhook}=await import('../scripts/medal-digest.mjs');
 const prior=process.env.DISCORD_MEDALS_WEBHOOK_URL,priorFile=process.env.DISCORD_MEDALS_WEBHOOK_FILE;
 try{
  delete process.env.DISCORD_MEDALS_WEBHOOK_FILE;
  process.env.DISCORD_MEDALS_WEBHOOK_URL='   ';assert.equal(environmentWebhook(),'');
  process.env.DISCORD_MEDALS_WEBHOOK_URL=url;assert.equal(environmentWebhook(),url);
 }finally{
  if(prior===undefined)delete process.env.DISCORD_MEDALS_WEBHOOK_URL;else process.env.DISCORD_MEDALS_WEBHOOK_URL=prior;
  if(priorFile===undefined)delete process.env.DISCORD_MEDALS_WEBHOOK_FILE;else process.env.DISCORD_MEDALS_WEBHOOK_FILE=priorFile;
 }
});


test('dispatch congratulates recipients, includes medal purpose and omits banner/footer',()=>{
 const message=payload([{name:'Player',medal:'Valour',purpose:'Recognises courage under fire',reason:'Held the line @everyone <script>'}],7);
 assert.match(message.avatar_url,/regiment-logo-transparent.png$/);
 const embed=message.embeds[0];assert.equal(embed.color,0xddc17c);assert.equal(embed.image,undefined);assert.match(embed.footer.text,/Emperor protects/);assert.match(embed.description,/^By order of Regimental Command/);assert.match(embed.description,/has been awarded:/);assert.match(embed.description,/\*\*Valour\*\*/);assert.doesNotMatch(embed.description,/https?:|\]\(/);
 assert.match(embed.description,/> Held the line everyone script/);assert.doesNotMatch(embed.description,/@everyone|<script>/);
 assert.deepEqual(message.allowed_mentions,{parse:[]});
});

