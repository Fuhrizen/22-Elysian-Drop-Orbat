'use client';
import {useCallback,useEffect,useState} from 'react';
import {adminHeaders} from '@/lib/client-session';
type State={locked:boolean;configured:boolean;sending:boolean;preview:null|{embeds:{title:string;description:string;footer:{text:string}}[]}};
export function DiscordMedalsSettings(){
 const [data,setData]=useState<State|null>(null),[url,setURL]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const load=useCallback(async()=>{try{const r=await fetch('/api/regiment?discord_medals=1',{headers:adminHeaders(),cache:'no-store'});const d=await r.json();if(!r.ok)throw Error(d.error);setData(d);setError('');}catch(e){setError((e as Error).message);}},[]);
 useEffect(()=>{void load();const timer=setInterval(()=>{if(!document.hidden)void load();},15000);return()=>clearInterval(timer);},[load]);
 const embed=data?.preview?.embeds[0];
 return <div className="admin-panel-content"><h2>Discord medal feed</h2><p>Awards are collected for 15 minutes from the first award. Medals revoked before sending are omitted.</p>
 {data?.locked?<p>Webhook managed by DISCORD_MEDALS_WEBHOOK_URL. Clear the environment value to edit it here.</p>:<form className="dialog-form" onSubmit={async e=>{e.preventDefault();setBusy(true);setNotice('');try{const r=await fetch('/api/regiment',{method:'POST',headers:{...adminHeaders(),'Content-Type':'application/json'},body:JSON.stringify({action:'discord_medals_webhook',url})});const d=await r.json();if(!r.ok)throw Error(d.error);setURL('');setNotice('Webhook saved.');await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>
 <label className="input-label">Discord webhook URL<input type="password" autoComplete="off" maxLength={2048} value={url} onChange={e=>setURL(e.target.value)} placeholder={data?.configured?'Configured — enter a replacement':'https://discord.com/api/webhooks/…'}/></label>
 <p>Saving a blank value disables the feed. The stored URL is never returned to the browser.</p><button className="secondary" disabled={busy||!data}>Save webhook</button></form>}
 {data&&!data.sending&&<p>Sending is disabled in this environment. You can still preview the next message.</p>}
 {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 <h3>Next message preview</h3><button className="secondary" type="button" onClick={()=>void load()}>Refresh preview</button>
 {embed?<div aria-label="Discord message preview" style={{marginTop:12,padding:16,background:'#313338',color:'#f2f3f5',borderRadius:6}}><strong>22nd Regimental Honours</strong><span style={{marginLeft:8,fontSize:11}}>APP</span><div style={{marginTop:8,padding:14,borderLeft:'4px solid #b4cf53',background:'#2b2d31',borderRadius:4}}><strong>{embed.title}</strong><p style={{whiteSpace:'pre-wrap',color:'#dbdee1'}}>{embed.description}</p><small>{embed.footer.text}</small></div></div>:<p>No awarded medals waiting to be announced.</p>}
 </div>;
}
