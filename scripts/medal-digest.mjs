import {readFileSync,existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';

export function webhookURL(value) {
 const url=new URL(value);
 if(url.protocol!=='https:' || url.hostname!=='discord.com' || url.port || url.username || url.password || !/^\/api(?:\/v\d+)?\/webhooks\/\d+\/[A-Za-z0-9_-]+$/.test(url.pathname))throw Error('Invalid Discord webhook configuration');
 url.search='?wait=true';url.hash='';return url.href;
}
const clean=(value,limit=180)=>String(value||'').replace(/[\\`*_~|<>@\[\]]/g,'').replace(/[\r\n]+/g,' ').slice(0,limit);
export function payload(rows,id) {
 // One compact embed even for large award sessions; avoid pings from user content.
 let description='**DEPARTMENTO MUNITORUM / XXII**\nREGIMENTAL LEDGER // HONOURS\n\n';let shown=0;
 for(const row of rows){const reason=clean(row.reason,512);const line=`• **${clean(row.name)}** — ${clean(row.medal)}\n${reason?`> ${reason}\n`:""}\n`;if(description.length+line.length>3400)break;description+=line;shown++;}
 if(shown<rows.length)description+=`\n…and ${rows.length-shown} additional awards. View the regimental ledger for the full record.`;
 return {username:'22nd Regimental Honours',avatar_url:'https://22orbat.ivenity.co.uk/regiment-logo-transparent.png',allowed_mentions:{parse:[]},embeds:[{title:'XXII // HONOURS DISPATCH',description,color:0xddc17c,image:{url:'https://raw.githubusercontent.com/Fuhrizen/22-Elysian-Drop-Orbat/1527391eb1c2757498efb5991c850b96cfc671d4/public/discord-honours-banner.png'},footer:{text:`22ND DROP REGIMENT · ${rows.length} award${rows.length===1?'':'s'} · Dispatch ${id}`}}]};
}

export async function flushDigest(db,url,{now=Math.floor(Date.now()/1000),send=fetch}={}) {
 const token=randomUUID();let batch;
 db.exec('BEGIN IMMEDIATE');
 try {
  batch=db.prepare('SELECT * FROM discord_medal_batches WHERE delivered_at IS NULL AND due_at<=? AND retry_at<=? AND lease_until<=? ORDER BY id LIMIT 1').get(now,now,now);
  if(batch)db.prepare('UPDATE discord_medal_batches SET token=?,lease_until=?,attempts=attempts+1 WHERE id=?').run(token,now+60,batch.id);
  db.exec('COMMIT');
 } catch(e){db.exec('ROLLBACK');throw e;}
 if(!batch)return false;
 const rows=db.prepare('SELECT p.name,m.name AS medal,a.comment AS reason FROM discord_medal_items i JOIN medal_awards a ON a.id=i.award_id JOIN personnel p ON p.id=a.user_id JOIN medals m ON m.id=a.medal_id LEFT JOIN operation_audits o ON o.id=a.operation_id WHERE i.batch_id=? AND a.revoked_at IS NULL AND (a.operation_id IS NULL OR o.hidden=0) ORDER BY a.created,a.id').all(batch.id);
 if(!rows.length){db.prepare('UPDATE discord_medal_batches SET delivered_at=?,lease_until=0 WHERE id=? AND token=?').run(now,batch.id,token);return true;}
 let retry=Math.min(3600,30*2**Math.min(batch.attempts,7));
 try {
  const response=await send(webhookURL(url),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload(rows,batch.id)),signal:AbortSignal.timeout(10000),redirect:'error'});
  if(response.status===429){const body=await response.json();retry=Math.max(1,Math.min(86400,Number(body.retry_after)||30));throw Error('rate limit');}
  if(!response.ok){if(response.status>=400&&response.status<500)retry=3600;throw Error('webhook rejected');}
  const message=await response.json();
  if(!message.id)throw Error('missing acknowledgement');
  db.prepare('UPDATE discord_medal_batches SET delivered_at=?,message_id=?,lease_until=0 WHERE id=? AND token=?').run(now,String(message.id),batch.id,token);
  return true;
 } catch {
  // Never log a webhook URL/token or Discord response body.
  db.prepare('UPDATE discord_medal_batches SET retry_at=?,lease_until=0 WHERE id=? AND token=?').run(now+Math.ceil(retry),batch.id,token);
  console.warn('Discord medal digest deferred; queued awards will be retried.');return false;
 }
}

export function environmentWebhook() {
 const file=process.env.DISCORD_MEDALS_WEBHOOK_FILE;
 return (process.env.DISCORD_MEDALS_WEBHOOK_URL || (file?readFileSync(file,'utf8'):'')).trim();
}
export function startDigestWorker(db) {
 if(process.env.DISCORD_MEDALS_ENABLED==='false')return ()=>{};
 let stopped=false,busy=false;
 const tick=async()=>{
  if(stopped||busy||existsSync(process.env.ORBAT_DEPLOYMENT_GUARD||'/app/data/.deployment-paused'))return;
  busy=true;
  try {
   // Resolve on every tick so administrator edits take effect without restarting.
   const value=environmentWebhook() || db.prepare("SELECT value FROM settings WHERE key='discord_medals_webhook'").get()?.value || '';
   if(value)await flushDigest(db,webhookURL(value));
  }catch{console.warn('Discord medal digest deferred: check webhook configuration.');}
  finally{busy=false;}
 };
 const timer=setInterval(tick,15000);timer.unref();void tick();
 return ()=>{stopped=true;clearInterval(timer);};
}


