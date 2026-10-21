'use client';
import { useEffect, useState } from 'react';
import { ArchiveOrbat } from '@/components/archive-orbat';
import { rankAbbreviation } from '@/lib/regiment';
import { LedgerRoster } from '@/components/personnel-directory';
import { statusLabel } from '@/lib/countdown';

type Summary = { id: number; title: string; created: string; signup_count: number };
type Snapshot = { sections?: {id:string;name:string;eyebrow:string}[]; configuration?: { mode: string }; roles: { id: string; name: string; code: string; section?: string }[]; personnel: { id: string; name: string; rank: string; status: string }[]; assignments: { slot: string; user_id: string }[]; countdown?: { localStart: string; timeZone: string } };
async function read(url: string, signal?: AbortSignal) {
    const r = await fetch(url, { cache: 'no-store', signal }); const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'The archive is unavailable.'); return d;
}
export function PublicArchive({initialId}:{initialId?:number|null}) {
    const [rows, setRows] = useState<Summary[]>([]), [selected, setSelected] = useState<{title:string;created:string;snapshot:Snapshot} | null>(null);
    const [error, setError] = useState(''), [busy, setBusy] = useState(false), [end, setEnd] = useState(false);
    async function load(before?: number) {
        setBusy(true); setError('');
        try { const d = await read('/api/regiment?public_archive=list' + (before ? '&before='+before : '')); setRows(prior => before ? [...prior,...d.operations] : d.operations); setEnd(d.operations.length < 20); }
        catch(e) { setError((e as Error).message); } finally { setBusy(false); }
    }
    useEffect(() => { load(); }, []);
    useEffect(()=>{if(initialId)open(initialId)},[initialId]);
    async function open(id: number) { setBusy(true); setError(''); try { setSelected(await read('/api/regiment?public_archive='+id)); } catch(e) { setError((e as Error).message); } finally {setBusy(false);} }
    const snap = selected?.snapshot;
    return <div className="public-records"><div className="page-heading"><div><p className="eyebrow">DEPARTMENTO MUNITORUM / SEALED RECORDS</p><h1>{selected ? selected.title : 'Operation archive'}</h1></div>{selected && <button className="secondary" onClick={()=>setSelected(null)}>Back to archive</button>}</div>
    {error && <p role="alert" className="form-error">{error}</p>}{busy && <p role="status">Retrieving records…</p>}
    {!selected ? <><div className="archive-list">{rows.map(row=><button className="archive-entry secondary" disabled={busy} key={row.id} onClick={()=>open(row.id)}><strong>{row.title}</strong><span>Sealed {new Date(row.created).toLocaleString()} · {row.signup_count} signups</span><span>View sealed ORBAT →</span></button>)}</div>{!busy&&!rows.length&&<p>No sealed operations yet.</p>}{!end&&<button className="secondary" disabled={busy} onClick={()=>load(rows.at(-1)?.id)}>Older operations</button>}</> : <>
    <div className="section-strip"><span>SEALED {new Date(selected.created).toLocaleString()}</span><span>READ ONLY</span></div>
    {snap?.countdown && <p className="muted">Operation scheduled: {snap.countdown.localStart.replace('T',' ')} · {snap.countdown.timeZone}</p>}
    {snap && <ArchiveOrbat snapshot={snap} onOperation={id=>void open(id)}/>}
    </>}</div>;
}
export function RegimentLedger({onOperation}:{onOperation:(id:number)=>void}) {
    const [activityQuery,setActivityQuery]=useState(''),[days,setDays]=useState(30),[draft,setDraft]=useState('30'),[members,setMembers]=useState<any[]>([]),[allMembers,setAllMembers]=useState<any[]>([]),[busy,setBusy]=useState(true),[error,setError]=useState('');
    useEffect(()=>{ const controller=new AbortController();setBusy(true);setError('');read('/api/regiment?ledger_days='+days,controller.signal).then(d=>{setMembers(d.members);setAllMembers(d.allMembers)}).catch(e=>{if(e.name!=='AbortError')setError(e.message)}).finally(()=>{if(!controller.signal.aborted)setBusy(false)});return()=>controller.abort();},[days]);
    return <div className="public-records"><div className="page-heading"><div><p className="eyebrow">REGIMENTAL SERVICE LEDGER</p><h1>Regiment ledger</h1></div></div><p>Members signed up and marked active in sealed operations during the selected range. Leave and unassigned members are excluded. Signups do not confirm attendance.</p><LedgerRoster users={allMembers} onOperation={onOperation}/><section className="activity-console"><div className="section-heading"><div><span className="eyebrow">MUNITORUM / SERVICE QUERY</span><h2>Operation activity search</h2></div><span className="section-count">LAST {days} DAYS</span></div><p>Search archived signups within a date range.</p><div className="activity-controls"><label className="ledger-search">Member, rank or latest operation<input value={activityQuery} placeholder="Name, rank or operation" onChange={e=>setActivityQuery(e.target.value)}/></label><form className="ledger-range" onSubmit={e=>{e.preventDefault();const n=Number(draft);if(Number.isInteger(n)&&n>=1&&n<=3660)setDays(n)}}><label>Last <input type="number" min="1" max="3660" value={draft} onChange={e=>setDraft(e.target.value)} required/> days</label><button className="secondary">Apply range</button><button type="button" className="text-button" onClick={()=>{setActivityQuery('');setDraft('30');setDays(30)}}>Reset filters</button></form></div>{error&&<p className="form-error" role="alert">{error}</p>}{busy?<p role="status">Retrieving ledger…</p>:<div className="ledger-members activity-members">{members.filter(p=>(p.name+' '+p.rank+' '+p.lastOperation).toLowerCase().includes(activityQuery.toLowerCase())).map(p=><article className="ledger-dossier activity-dossier" key={p.id}><div className="dossier-identity"><span className="person-initial">{p.name.slice(0,2).toUpperCase()}</span><div><span className="eyebrow">{p.rank}</span><h3>{rankAbbreviation(p.rank)} {p.name}</h3></div><span className={'person-status '+p.status}>{statusLabel(p.status)}</span></div><div className="dossier-service"><span className="eyebrow">LAST OPERATION</span><strong>{p.lastOperation || 'N/A'}</strong><time>{new Date(p.lastSeen).toLocaleDateString()}</time></div><div className="dossier-total"><span className="eyebrow">OPERATIONS IN RANGE</span><strong>{String(p.operations).padStart(3,'0')}</strong></div><button className="secondary dossier-inspect" onClick={()=>onOperation(p.lastOperationId)}>View operation →</button></article>)}{!members.some(p=>(p.name+' '+p.rank+' '+p.lastOperation).toLowerCase().includes(activityQuery.toLowerCase()))&&<p>No activity matches these filters.</p>}</div>}</section></div>;
}
