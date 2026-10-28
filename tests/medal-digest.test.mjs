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
  const send=async(u,o)=>{sent++;const body=JSON.parse(o.body);assert.equal(body.embeds.length,1);assert.match(body.embeds[0].description,/× 2/);assert.deepEqual(body.allowed_mentions,{parse:[]});return ack();};
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
test('invalid destinations rejected, payload bounded, previews disabled by default',()=>{
 for(const value of ['http://discord.com/api/webhooks/1/t','https://example.com/api/webhooks/1/t','https://discord.com.evil/api/webhooks/1/t'])assert.throws(()=>webhookURL(value));
 const message=payload(Array.from({length:1000},(_,i)=>({name:'Member '+i,medal:'Award'})),1);
 assert.ok(message.embeds[0].description.length<4096);
 assert.doesNotThrow(()=>startDigestWorker({}));
});
