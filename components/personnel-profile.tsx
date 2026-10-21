'use client';
import {MedalHonours} from '@/components/medals';
import {useEffect,useState} from 'react';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {TerminalCounters} from '@/components/terminal-counters';
import {type Person,rankAbbreviation} from '@/lib/regiment';
import {statusLabel} from '@/lib/countdown';
type Record={id:number;title:string;created:string;role:string};
export function PersonnelProfile({person,onClose,onOperation,recordedRole}:{person:Person|null;recordedRole?:string;onClose:()=>void;onOperation:(id:number)=>void}) {
 const [records,setRecords]=useState<Record[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{setRecords([]);setError('');if(!person)return;const c=new AbortController();setBusy(true);fetch('/api/regiment?personnel_history=all',{signal:c.signal}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error);setRecords(d.histories[person.id] || [])}).catch(e=>{if(e.name!=='AbortError')setError(e.message)}).finally(()=>{if(!c.signal.aborted)setBusy(false)});return()=>c.abort()},[person?.id]);
 const attendance=records.filter(r=>! /^(Absent|Tentative)/.test(r.role));
 return <Dialog open={!!person} onOpenChange={open=>{if(!open)onClose()}}><DialogContent className="regiment-dialog history-overlay"><DialogTitle>{person && `${rankAbbreviation(person.rank)} ${person.name}`}</DialogTitle><DialogDescription>{person?.rank} · {statusLabel(person?.status || '')} · {recordedRole?'Recorded at sealing':'Personnel service record'}</DialogDescription>{busy?<p role="status">Retrieving service record…</p>:<><TerminalCounters items={[{label:'Operations',value:attendance.length},{label:'Absences',value:records.filter(r=>r.role==='Absent').length}]}/>{recordedRole&&<p>Recorded role: {recordedRole}</p>}<p>Roles held: {[...new Set(attendance.filter(r=>r.role!=='Reserve').map(r=>r.role))].join(', ') || 'N/A'}</p><p>Last operation: {attendance[0]?.title || 'N/A'}</p>{person && <MedalHonours userId={person.id} onOperation={onOperation}/>}<details className="profile-section"><summary>Operation history <span className="section-count">{records.length} RECORDS</span></summary><div className="history-list">{records.map(r=><button className="history-entry" key={r.id} onClick={()=>onOperation(r.id)}><strong>{r.title}</strong><time>{new Date(r.created).toLocaleDateString()}</time><span>{r.role==='Reserve'?'Attending':r.role}</span></button>)}{!records.length&&!error&&<p>No sealed operations recorded.</p>}</div></details></>}{error&&<p role="alert">{error}</p>}</DialogContent></Dialog>
}
