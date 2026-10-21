'use client';
import {PersonnelProfile} from '@/components/personnel-profile';
import {Award} from 'lucide-react';
import { useEffect, useState } from 'react';
import { rankAbbreviation, type Person } from '@/lib/regiment';
import { statusLabel } from '@/lib/countdown';

type ServiceRecord = { id: number; title: string; created: string; role: string; status: string };
export function LedgerRoster({users,onOperation}:{users:Person[];onOperation:(id:number)=>void}) {
    const [query,setQuery] = useState('');
    const [medalCounts,setMedalCounts]=useState<Record<string,number>>({});
    useEffect(()=>{const c=new AbortController();fetch('/api/regiment?medals=1',{signal:c.signal,cache:'no-store'}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error);const counts:Record<string,number>={};for(const a of d.awards)counts[a.user_id]=(counts[a.user_id] || 0)+1;setMedalCounts(counts)}).catch(e=>{if(e.name!=='AbortError')setError(e.message)});return()=>c.abort()},[]);
    const [records,setRecords] = useState<Record<string,ServiceRecord[]>>({});
    const [inspect,setInspect] = useState<Person|null>(null);
    const [error,setError] = useState('');
    useEffect(()=>{
        const controller = new AbortController();
        fetch('/api/regiment?personnel_history=all',{signal:controller.signal})
            .then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error);setRecords(data.histories);})
            .catch(error=>{if(error.name!=='AbortError')setError(error.message);});
        return ()=>controller.abort();
    },[]);
    const visible = users.filter(person=>person.status!=='inactive' && (person.name+' '+person.rank).toLowerCase().includes(query.toLowerCase()));
    return <section className="ledger-roster">
        <div className="section-heading"><h2>Regiment personnel</h2><span className="section-count">{users.filter(p=>p.status!=='inactive').length} RECORDS</span></div>
        <label className="ledger-search">Find a member<input placeholder="Name or rank" value={query} onChange={event=>setQuery(event.target.value)}/></label>
        {error && <p role="alert" className="form-error">{error}</p>}
        <div className="ledger-members">{visible.map(person=><article className="ledger-dossier" key={person.id}>
            <div className="dossier-identity"><span className="person-initial">{person.name.slice(0,2).toUpperCase()}</span><div><span className="eyebrow">{person.rank}</span><h3>{rankAbbreviation(person.rank)} {person.name}</h3></div><div className="dossier-badges"><span className={'person-status '+person.status}>{statusLabel(person.status)}</span><span className="ledger-medal-count" title="Medals awarded" aria-label={(medalCounts[person.id] || 0)+' medals'}><Award size={14}/>{medalCounts[person.id] || 0}</span></div></div>
            <div className="dossier-service"><span className="eyebrow">LAST OPERATION</span><strong>{records[person.id]?.find(o=>!/^Absent|^Tentative/.test(o.role))?.title || 'N/A'}</strong></div>
            <div className="dossier-total"><span className="eyebrow">TOTAL OPERATIONS</span><strong>{records[person.id]?.filter(o=>!/^Absent|^Tentative/.test(o.role)).length || 0}</strong></div><button className="secondary dossier-inspect" onClick={()=>setInspect(person)}>Inspect history <span aria-hidden="true">→</span></button>
        </article>)}</div>
        {!visible.length && <p>No members match this search.</p>}
        <PersonnelProfile person={inspect} onClose={()=>setInspect(null)} onOperation={id=>{setInspect(null);onOperation(id)}}/>
    </section>;
}
