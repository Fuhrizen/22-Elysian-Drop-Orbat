'use client';
import {useCallback,useEffect,useState} from 'react';
import {adminHeaders} from '@/lib/client-session';
type State={locked:boolean;configured:boolean;sending:boolean;maintenance:boolean;serverNow:number;pending:number;nextAt:number|null;retrying:boolean;preview:null|{embeds:{title:string;description:string;footer:{text:string}}[]}};
export function DiscordMedalsSettings(){
 const [data,setData]=useState<State|null>(null),[url,setURL]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[clock,setClock]=useState(Date.now()),[offset,setOffset]=useState(0);
 const load=useCallback(async()=>{try{const r=await fetch('/api/regiment?discord_medals=1',{headers:adminHeaders(),cache:'no-store',signal:AbortSignal.timeout(10000)});const d=await r.json();if(!r.ok)throw Error(d.error);setData(d);setOffset(d.serverNow-Date.now());setError('');}catch(e){setError((e as Error).message);}},[]);
 useEffect(()=>{void load();const poll=setInterval(()=>{if(!document.hidden)void load();},5000),tick=setInterval(()=>setClock(Date.now()),1000);return()=>{clearInterval(poll);clearInterval(tick);};},[load]);
 async function command(body:Record<string,unknown>){setBusy(true);setNotice('');setError('');try{const r=await fetch('/api/regiment',{method:'POST',headers:{...adminHeaders(),'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});const d=await r.json();if(!r.ok)throw Error(d.error);setURL('');setNotice(body.action==='discord_medals_push'?(d.queued?'Dispatch requested. Sending on the next worker tick; retries still respect Discord rate limits.':'Paused — no awards waiting to send.'):'Webhook saved.');await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 const embed=data?.preview?.embeds[0];
 const paused=!data?.pending||!data.configured||!data.sending||data.maintenance;
 const seconds=Math.max(0,Math.ceil(((data?.nextAt||0)-clock-offset)/1000));
 const status=!data?'Loading dispatch status…':!data.pending?'Paused — no awards waiting':!data.configured?'Paused — configure a webhook':!data.sending?'Paused — sending disabled':data.maintenance?'Paused — deployment maintenance':seconds?`${data.retrying?'Retry':'Next dispatch'} in ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`:'Dispatch due — waiting for worker';
 return <div className="admin-panel-content"><div className="admin-section-head"><div><span className="eyebrow">XXII / VOX RELAY</span><h2>Discord feed</h2></div></div><p>Awards are collected for 15 minutes from the first award. Revoked medals are removed before delivery.</p>
 <div className="admin-access-panel"><div><strong role="status">{status}</strong><p>{data?.pending||0} awards queued. Empty batches never send.</p></div><button className="primary" type="button" disabled={busy||paused||!!error} onClick={()=>void command({action:'discord_medals_push'})}>Send now</button></div>
 <h3>Webhook definition</h3>
 {data?.locked?<p>Managed by DISCORD_MEDALS_WEBHOOK_URL. Clear the environment value to edit it here.</p>:<form className="dialog-form" onSubmit={e=>{e.preventDefault();void command({action:'discord_medals_webhook',url});}}>
 <label className="input-label">Discord webhook URL<input type="password" autoComplete="off" maxLength={2048} value={url} onChange={e=>setURL(e.target.value)} placeholder={data?.configured?'Configured — enter a replacement':'https://discord.com/api/webhooks/…'}/></label>
 <p>Saving blank disables the saved webhook. The stored URL is never returned to the browser.</p><button className="secondary" disabled={busy||!data}>Save webhook</button></form>}
 <p className="field-help">Preview instances send only to a webhook explicitly saved here. The production environment webhook is not shared with previews.</p>
 {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 <h3>Next dispatch preview</h3><button className="secondary" type="button" onClick={()=>void load()}>Refresh preview</button>
 {embed?<div aria-label="Discord message preview" style={{marginTop:12,padding:18,background:'#171e14',color:'#c8dca7',border:'1px solid #68744f',fontFamily:'var(--font-mono), monospace'}}><span className="eyebrow">22ND REGIMENTAL HONOURS / APP</span><div style={{marginTop:12,padding:16,borderLeft:'4px solid #b4cf53',background:'#222b1c'}}><strong>{embed.title}</strong><p style={{whiteSpace:'pre-wrap',lineHeight:1.7}}>{embed.description.split('\n').map((line,i)=><span key={i} style={{display:'block',minHeight:'1em'}}>{line.split('**').map((part,j)=>j%2?<strong key={j}>{part}</strong>:part)}</span>)}</p><small>{embed.footer.text}</small></div></div>:<p>No awarded medals waiting to be announced.</p>}
 </div>;
}
