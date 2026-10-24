'use client';
import { StubberIcon } from '@/components/stubber-icon';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { Crosshair, Plane, Flame, Shield, LockKeyhole, Radio, HeartPulse, Zap, Target, Users, CalendarDays, Plus, Terminal, ChevronRight, Check, RefreshCw, LogOut, Settings2, UserPlus, Search, CheckCheck, ShieldCheck, X, Fingerprint, Award } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Table, TableHeader, TableHead, TableRow, TableBody, TableCell } from '@/components/ui/table';
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';
import { Toaster, toast } from 'sonner';
import { adminHeaders, adminToken, saveAdminToken } from '@/lib/client-session';
import { slotRoleOptions, canLockSlot, defaultLayout, defaultRolePolicy, type OrbatLayout, type OrbatTemplate, type RolePolicy, type SharedKey, slotTypes, editableRoles, slotPhraseRole, ranks, rankAbbreviation, combatReadiness, formationReadiness, type Person, type Operation, type Assignment, type OperationConfig } from '@/lib/regiment';
import { defaultCountdown, nextCountdown, statusLabel, type CountdownConfig } from '@/lib/countdown';
import { OperationAudits, type OperationAuditSummary } from '@/components/operation-audits';
import { PublicArchive, RegimentLedger } from '@/components/public-records';
import { PixelField } from '@/components/pixel-field';
import { TerminalLamp } from '@/components/terminal-lamp';
import { TerminalText } from '@/components/terminal-text';
import { ChangeSignal } from '@/components/change-signal';
import { terminalSound, commandSound } from '@/components/terminal-audio';

import { PersonnelProfile } from '@/components/personnel-profile';
import { TerminalCounters } from '@/components/terminal-counters';
import {PersonnelWarnings} from '@/components/personnel-warnings';
import { MedalAdmin } from '@/components/medals';
import { ChangeLog } from '@/components/change-log';
import { TerminalHeader } from '@/components/terminal-header';
type Audit = {
    id: number;
    operation_id: string;
    operation_title: string;
    slot: string;
    event: string;
    before_name: string;
    after_name: string;
    actor: string;
    created: string;
};
type Data = {
    layout?: OrbatLayout;
    layoutRevision?: number;
    rolePolicies?: Record<string,RolePolicy>;
    templates?: OrbatTemplate[];
    sharedKeys?: SharedKey[];
    operationAudits?: OperationAuditSummary[];
    slotLocks?: Record<string,boolean>;
    slotRoles?: Record<string,string>;
    configuration?: OperationConfig;
    countdown?: CountdownConfig;
    serverNow?: number;
    users: Person[];
    operations: Operation[];
    assignments: Assignment[];
    admin: boolean;
    configuredRoles: string[];
    audit: Audit[];
};
const blank: Data = { users: [], operations: [], assignments: [], admin: false, configuredRoles: [], audit: [] };
const icons: Record<string, typeof Shield> = { command: Terminal, leader: Shield, vox: Radio, medic: HeartPulse, at: Target, plasma: Zap, stubber: StubberIcon, trooper: Crosshair, pilot: Plane, melta: Flame };
function Choice({ value, onChange, items, label, placeholder = 'Select' }: {
    value: string;
    onChange: (v: string) => void;
    items: {
        value: string;
        label: string;
        icon?: string;
    }[];
    label: string;
    placeholder?: string;
}) {
    const itemSignature = JSON.stringify(items);
    const options = useMemo(() => (JSON.parse(itemSignature) as {value:string;label:string;icon?:string}[]).map(i => {const Icon=i.icon?icons[i.icon]:null;return <SelectItem key={i.value} value={i.value}>{Icon && <Icon size={17}/ >}{i.label}</SelectItem>}), [itemSignature]);
    return <Select value={value} onValueChange={onChange}>
    <SelectTrigger aria-label={label}>
    <SelectValue placeholder={placeholder}/>
    </SelectTrigger>
    <SelectContent>{options}</SelectContent>
    </Select>;
}
function Input({ label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & {
    label: string;
}) {
    return <label className="field">
    <span>{label}</span>
    <input {...props}/>
    </label>;
}
function Boot() {
    const [show,setShow]=useState(false),[running,setRunning]=useState(false);
    const finish=useCallback(()=>{setShow(false);try{sessionStorage.setItem('xxii-boot-v2','1')}catch{}},[]);
    useEffect(()=>{try{if(sessionStorage.getItem('xxii-boot-v2'))return}catch{}if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;setShow(true)},[]);
    useEffect(()=>{if(!show || running)return;const start=()=>{if(!document.hidden && document.hasFocus()){setRunning(true);}};start();window.addEventListener('focus',start);document.addEventListener('visibilitychange',start);return()=>{window.removeEventListener('focus',start);document.removeEventListener('visibilitychange',start)}},[show,running]);
    useEffect(()=>{if(!running)return;const timer=setTimeout(finish,6500);return()=>clearTimeout(timer)},[running,finish]);

    if(!show)return null;
    return <div className={'boot '+(running?'boot-running':'boot-waiting')} role="dialog" aria-label="Regimental terminal boot sequence">
    {running&&<><div className="boot-raster" aria-hidden="true"/><div className="boot-blocks" aria-hidden="true">{Array.from({length:16},(_,i)=><i key={i} style={{'--block':i,left:((i*17)%91)+'%',top:((i*23)%89)+'%'} as React.CSSProperties}/>)}</div></>}
    <div className="boot-center"><Crosshair size={64}/><p>ADEPTUS MUNITORUM</p><h1>XXII</h1>
    {running?<><div className="boot-lines"><span>ENGAGING DATA REELS …</span><span>ENERGISING COGITATOR CORE …</span><span>VERIFYING REGIMENTAL ARCHIVES …</span><span>22ND DROP REGIMENT / ACCESS GRANTED</span></div><div className="boot-progress"/></>:<p className="boot-audio-hint">COGITATOR STANDBY / WAITING FOR FOCUS</p>}
    <button onClick={finish}>Skip initialization</button></div></div>;
}
function MedalCount({person}:{person:Person}) {
 const count=person.medal_count || 0;
 return count>0 ? <span className="orbat-medal-count" aria-label={`${count} medal${count===1?'':'s'}`} title={`${count} medal${count===1?'':'s'}`}><Award size={14} aria-hidden="true"/>{count}</span> : null;
}
function OperationSettings({config,busy,save}:{config:OperationConfig;busy:boolean;save:(config:OperationConfig & {resetLayout?:boolean;confirmedLayout?:boolean})=>Promise<boolean>}) {
 const [draft,setDraft]=useState(config),[pending,setPending]=useState<(OperationConfig & {resetLayout?:boolean;confirmedLayout?:boolean})|null>(null);
 useEffect(()=>setDraft(config),[config.title,config.mode,config.locked]);
 async function apply(value:NonNullable<typeof pending>){if(await save(value)){setPending(null);toast.success(value.resetLayout?'Default layout restored.':'Operation configuration updated.')}}
 return <div className="countdown-settings"><h2>Operation configuration</h2><p>Switch layouts without clearing signups. Roles move into Attending in the open manifest and are restored when you switch back. Tentative and absent entries are kept.</p><form className="dialog-form" onSubmit={e=>{e.preventDefault();if(draft.mode!==config.mode)setPending({...draft});else void apply(draft)}}><label className="input-label">ORBAT layout<select value={draft.mode} onChange={e=>setDraft({...draft,mode:e.target.value as 'main'|'open'})}><option value="main">Main ORBAT — SPEAR 1, SPEAR 2 and SHIELD</option><option value="open">Open personnel manifest</option></select></label><label className="checkbox-label"><input type="checkbox" checked={!!draft.locked} onChange={e=>setDraft({...draft,locked:e.target.checked})}/>Lock ORBAT — administrators only</label><p className="field-help">While locked, only administrators can change signups, withdrawals, slot roles or slot passphrase locks. The lock stays active until an administrator disables it.</p><button className="primary" disabled={busy}>Save operation configuration</button>{draft.mode==='main' && <button className="secondary" type="button" disabled={busy} onClick={()=>setPending({...draft,resetLayout:true,confirmedLayout:true})}>Restore default layout</button>}</form><AlertDialog open={!!pending} onOpenChange={open=>{if(!open&&!busy)setPending(null)}}><AlertDialogContent className="regiment-dialog"><AlertDialogTitle>{pending?.resetLayout?'Restore default layout?':'Switch operation layout?'}</AlertDialogTitle><AlertDialogDescription>{pending?.resetLayout?'Slot roles will reset. Members whose positions are removed will move to Attending, where they can withdraw or choose another slot. Other signups are kept.':pending?.mode==='open'?'Assigned members will move to Attending. Their previous slots are remembered for switching back.':'Remembered slots will be restored where available. Other attending members can choose a slot or withdraw.'}</AlertDialogDescription><AlertDialogFooter><AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel><button className="primary" disabled={busy} onClick={()=>pending&&void apply(pending)}>{busy?'Applying…':'Confirm layout change'}</button></AlertDialogFooter></AlertDialogContent></AlertDialog></div>;
}
function CountdownSettings({ config, busy, save }: {
    config: CountdownConfig;
    busy: boolean;
    save: (config: CountdownConfig) => Promise<boolean>;
}) {
    const [draft, setDraft] = useState(config);
    const [localZone, setLocalZone] = useState('Europe/London');
    useEffect(() => setLocalZone(Intl.DateTimeFormat().resolvedOptions().timeZone), []);
    useEffect(() => setDraft(config), [config.localStart, config.timeZone, config.autoRenew]);
    return <div className="countdown-settings">
    <h2>
    <TerminalText text="Operation countdown"/>
    </h2>
    <p>Choose the next operation date, time and timezone. Auto-renew repeats it every week at the same local time, including UK clock changes.</p>
    <form className="dialog-form" onSubmit={async (e) => { e.preventDefault(); if (await save(draft))
        toast.success('Deployment countdown updated.'); }}>
    <Input label={`Next operation (${draft.timeZone})`} type="datetime-local" value={draft.localStart} onChange={e => setDraft({ ...draft, localStart: e.target.value })} required/>
    <label className="field">
    <span>Schedule timezone</span>
    <Choice value={draft.timeZone} onChange={v => setDraft({ ...draft, timeZone: v })} label="Schedule timezone" items={[...new Set(['Europe/London', localZone, 'UTC', draft.timeZone])].map(v => ({ value: v, label: v === 'Europe/London' ? 'UK — Europe/London (BST / GMT)' : v === localZone ? `Your timezone — ${v}` : v }))}/>
    </label>
    <label className="renew-choice">
    <input type="checkbox" checked={draft.autoRenew} onChange={e => setDraft({ ...draft, autoRenew: e.target.checked })}/>
    <span>Auto-renew weekly after deployment time</span>
    </label>
    <div className="button-row">
    <button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save countdown'}</button>
    <button type="button" className="secondary" onClick={() => setDraft(defaultCountdown())}>Use Friday 19:30 UK</button>
    </div>
    </form>
    </div>;
}
export default function Home() {

    const [profile,setProfile] = useState<Person|null>(null);
    const [strikePerson,setStrikePerson]=useState<Person|null>(null);
    const [archiveId,setArchiveId] = useState<number | null>(null);
    useEffect(()=>{const id=Number(new URLSearchParams(window.location.search).get('operation'));if(Number.isSafeInteger(id)&&id>0){setArchiveId(id);setView('archive')}},[]);
    const [recordRevision, setRecordRevision] = useState(0);
    const [clock, setClock] = useState<number | null>(null), [clockOffset, setClockOffset] = useState(0);
    const [data, setData] = useState<Data>(blank), [loading, setLoading] = useState(true), [error, setError] = useState(''), [view, setView] = useState('orbat'), [adminArea, setAdminArea] = useState('players'), [opId, setOpId] = useState(''), [modal, setModal] = useState(''), [selected, setSelected] = useState(''), [userId, setUserId] = useState(''), [phrase, setPhrase] = useState(''), [busy, setBusy] = useState(false), [form, setForm] = useState<Record<string, string>>({}), [query, setQuery] = useState(''), [confirm, setConfirm] = useState<{
        type: string;
        role?: string;
        slot?: string;
        user?: string;
        name?: string;
    } | null>(null), [dialogError, setDialogError] = useState(''), [generated, setGenerated] = useState(''), [olderAudit, setOlderAudit] = useState<Audit[]>([]), [auditEnd, setAuditEnd] = useState(false), [auditBusy, setAuditBusy] = useState(false);
    const load = useCallback(async () => { try {
        const tokenAtStart = adminToken();
        const res = await fetch('/api/regiment', { cache: 'no-store', headers: adminHeaders(), signal: AbortSignal.timeout(15000) });
        const d = await res.json() as Data & {
            error?: string;
        };
        if (!res.ok)
            throw new Error(d.error);
        if (tokenAtStart !== adminToken())
            return null;
        setData(d);
        if (d.serverNow)
            setClockOffset(d.serverNow - Date.now());
        setError('');
        if (!d.admin && tokenAtStart)
            saveAdminToken('');
        return d as Data;
    }
    catch (e) {
        setError((e as Error).message);
        return null;
    }
    finally {
        setLoading(false);
    } }, []);
    useEffect(() => { load(); const v = new URLSearchParams(location.search).get('view'); if (v && ['orbat', 'admin', 'archive', 'ledger'].includes(v))
        setView(v); const refresh = () => { if (!document.hidden)
        load(); }; window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh); const id = setInterval(() => { if (!document.hidden)
        load(); }, 2000); return () => { clearInterval(id); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); }; }, [load]);
    useEffect(() => { if (!opId && data.operations.length)
        setOpId(data.operations.find(o => o.status === 'open')?.id || data.operations[0].id); }, [data.operations, opId]);
    useEffect(() => { setClock(Date.now()); const tick = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(tick); }, []);
    const changeView = (v: string) => { setView(v); history.replaceState(null, '', '?view=' + v); requestAnimationFrame(() => { window.scrollTo({ top: 0 }); document.querySelector('.terminal-tabs > [data-state=active]')?.scrollTo({ top: 0 }); }); };

    const orbatReadOnly = !!data.configuration?.locked && !data.admin;
    const layout = data.layout || defaultLayout();
    const policies = data.rolePolicies || Object.fromEntries([...new Set(layout.slots.map(s=>s.phraseRole))].map(role=>[role,defaultRolePolicy(role,layout)]));
    const slots = layout.slots.map(s=>({...s,protected:policies[s.phraseRole]?.enabled || !!data.slotLocks?.[s.id]}));
    const accessRoles=(target:string,permission:'canEditRoles'|'canEditAssignments')=>Object.entries(policies).filter(([role,p])=>role==='ic' && data.configuredRoles.includes(role) && (role==='ic' || p.editScope==='all' || (p.editScope==='section' && layout.slots.some(s=>s.phraseRole===role && s.section===slots.find(t=>t.id===target)?.section)))).map(([role])=>({value:role,label:data.sharedKeys?.find(k=>k.id===role)?.name || layout.slots.filter(s=>s.phraseRole===role).map(s=>s.name+' '+s.code).join(' / ')}));
    const clearanceFields=(permission:'canEditRoles'|'canEditAssignments')=><><Choice label="Editing clearance role" placeholder="Choose your role clearance" value={form.accessRole || ''} onChange={accessRole=>setForm({...form,accessRole})} items={accessRoles(selected,permission)}/><Input label="Editing clearance passphrase" type="password" autoComplete="off" value={phrase} onChange={e=>setPhrase(e.target.value)} required/></>;
    const operation = data.operations.find(o => o.id === opId), assigned = data.assignments.filter(a => a.operation_id === opId), slot = /^(reserve|tentative|absent)(:|$)/.test(selected) ? { id: selected, name: selected.startsWith('reserve') && data.configuration?.mode==='open'?'ATTENDING':selected.split(':')[0].toUpperCase(), protected: false } : slots.find(s => s.id === selected), active = data.users.filter(u => u.status === 'active'), available = active.filter(u => !assigned.some(a => a.user_id === u.id));
    async function command(payload: Record<string, unknown>) { setBusy(true); setDialogError(''); try {
        const r = await fetch('/api/regiment', { method: 'POST', headers: { 'Content-Type': 'application/json', ...adminHeaders() }, signal: AbortSignal.timeout(15000), body: JSON.stringify(payload) });
        const d = await r.json() as {
            ok?: boolean;
            id?: string;
            error?: string;
            phrase?: string;
            sessionToken?: string;
            slot?: string;
            withdrawalToken?: string;
        };
        if (!r.ok)
            throw new Error(d.error);
        terminalSound(commandSound(String(payload.action),typeof payload.phrase === 'string' && payload.phrase.length > 0));
        if (payload.action === 'login') {
            if (!d.sessionToken)
                throw new Error('The server did not issue an administrator session. Please retry.');
            saveAdminToken(d.sessionToken);
        }
        if (payload.action === 'logout' || payload.action === 'phrase' && payload.role === 'admin')
            saveAdminToken('');
        const current = await load();
        if (!current)
            throw new Error('Saved, but the archive could not refresh. Use Retry to confirm.');
        if (payload.action === 'login' && !current.admin)
            throw new Error('Your key was accepted, but the administrator session could not be established. Please retry.');
        if (!['login', 'logout'].includes(String(payload.action)))
            setRecordRevision(n => n + 1);
        return d;
    }
    catch (e) {
        setDialogError((e as Error).message);
        terminalSound('error');
        toast.error((e as Error).message);
        return null;
    }
    finally {
        setBusy(false);
    } }
    const open = (m: string, f: Record<string, string> = {}) => { setModal(m); setForm(f); setDialogError(''); setPhrase(''); setUserId(''); setGenerated(''); };
    const edit = (u: Person) => open('edit', Object.fromEntries(Object.entries(u).map(([k, v]) => [k, String(v)])));
    const target = data.countdown && clock !== null ? nextCountdown(data.countdown, clock + clockOffset) : null;
    const remaining = target && clock !== null ? Math.max(0, Math.floor((target - clock - clockOffset) / 1000)) : 0;
    const defaultAbsent=data.users.filter(p=>!assigned.some(a=>a.user_id===p.id));
    const reserves = assigned.filter(a => /^(reserve|tentative|absent):/.test(a.slot)), mainAssigned = assigned.filter(a => !/^(reserve|tentative|absent):/.test(a.slot));
    const sectionSlots = slots.filter(s => s.section==='spear1' || s.section==='spear2');
    const openManifest = data.configuration?.mode === 'open';
    const pilotSlots = slots.filter(s => s.type === 'pilot');
    const shieldDeployable = assigned.some(a => pilotSlots.some(s => s.id === a.slot) && data.users.some(u => u.id === a.user_id && u.status === 'active'));
    const infantryAssigned = mainAssigned.filter(a => sectionSlots.some(s=>s.id===a.slot));
    const readiness = combatReadiness(infantryAssigned.length + reserves.filter(a=>a.slot.startsWith('reserve:')).length, sectionSlots.length);
    const auditRows = [...data.audit, ...olderAudit].filter((a, i, all) => all.findIndex(x => x.id === a.id) === i).sort((a, b) => b.id - a.id);
    const roleLabel = (id: string) => id.startsWith('reserve:') ? (data.configuration?.mode==='open'?'Attending':'Reserve') : data.sharedKeys?.find(k=>k.id===id)?.name || slots.find(s => s.id === id)?.name || id;
    async function moreAudit() { if (!auditRows.length)
        return; setAuditBusy(true); try {
        const response = await fetch('/api/regiment?audit_before=' + auditRows[auditRows.length - 1].id, { headers: adminHeaders() });
        const result = await response.json() as {
            audit: Audit[];
            error?: string;
        };
        if (!response.ok)
            throw new Error(result.error);
        setOlderAudit(prev => [...prev, ...result.audit]);
        setAuditEnd(result.audit.length < 50);
    }
    catch (e) {
        terminalSound('error');
        toast.error((e as Error).message);
    }
    finally {
        setAuditBusy(false);
    } }
    const f = (k: string) => ({ value: form[k] || '', onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value }) });
    async function submit(e: React.FormEvent) {
        e.preventDefault();
        let result;
        switch (modal) {
            case 'reset_orbat':
                return;
                if (result)
                    toast.success(form.disposition === 'destroy' ? 'Manifest destroyed. ORBAT cleared.' : 'Operation declared and archived. ORBAT cleared.');
                break;
            case 'withdraw':
                result = await command({ action: 'withdraw', operation: opId, slot: selected, expected: form.expected, created: form.created, phrase });
                if (result)
                    toast.success('Assignment withdrawn.');
                break;
            case 'register':
                result = await command({ action: 'register', ...form });
                if (result)
                    toast.success('Personnel record added to the regimental roll.');
                break;
            case 'claim':
                result = await command({ action: 'claim', operation: opId, slot: selected, user: userId, phrase });
                if (result)
                    toast.success('Assignment confirmed. Report for duty.');
                break;
            case 'release_assignment':
                result = await command({action:'release',slot:selected,expected:form.expected,created:form.created,accessRole:form.accessRole,phrase});
                if(result)toast.success('Assignment cleared.');
                break;
            case 'edit_assignment':
                result = await command({ action: 'edit_assignment', operation: opId, slot: selected, user: userId, expected: form.expected, accessRole:form.accessRole, phrase });
                if (result)
                    toast.success('Role assignment updated.');
                break;
            case 'edit':
                result = await command({ action: 'save_user', ...form });
                if (result)
                    toast.success('Personnel record updated.');
                break;
            case 'slot_lock':
                result = await command({action:'slot_lock',slot:selected,enabled:form.enabled==='true',lockPhrase:form.lockPhrase,expectedLocked:form.enabled!=='true',accessRole:'ic',phrase});
                break;
            case 'slot_role':
                result = await command({action:'slot_role',slot:selected,role:form.role,icon:form.icon,phrase,accessRole:form.accessRole});
                if(result)toast.success('Slot role updated.');
                break;
            case 'phrase':
                result = await command({ action: 'phrase', role: selected, phrase });
                if (result)
                    toast.success(selected === 'admin' ? 'Admin key changed. Sign in with your new key.' : 'Role passphrase updated on the ORBAT.');
                break;
        }
        if (result)
            setModal('');
    }
    function roleCard(s: typeof slots[number]) {
        const a = assigned.find(a => a.slot === s.id), person = data.users.find(u => u.id === a?.user_id), Icon = icons[s.type] || Crosshair;
        return <ChangeSignal value={JSON.stringify([a?.user_id, a?.created, person?.name, person?.rank, person?.status, person?.medal_count, s.name])} className={'role ' + (person ? 'filled' : '') + (s.protected ? ' protected' : '')} key={s.id}>
        {(slotRoleOptions(s).length>0 && !orbatReadOnly && (data.admin || accessRoles(s.id,'canEditRoles').length>0)) ? <button className="role-icon role-editor" title="Edit slot role" aria-label={'Edit '+s.name+' role in '+s.code} onClick={()=>{setSelected(s.id);open('slot_role',{role:s.section==='shield' && s.type==='pilot'?'Pilot':s.name,icon:s.type})}}><Icon size={20}/></button> : <div className="role-icon"><Icon size={20}/></div>}
        <div className="role-body">
        <div className="role-name">
        <TerminalLamp lit={!!person} seed={'role-' + s.id} shape="dot"/>{s.name}{s.protected && <LockKeyhole size={13} aria-label="Protected role"/>}</div>
        <div className="role-person">
        {person ? <button className="role-profile" onClick={()=>setProfile(person)}><TerminalText text={`${rankAbbreviation(person.rank)} ${person.name}`}/><MedalCount person={person}/></button> : <TerminalText text="Awaiting assignment"/>}
        </div>
        </div>
        <span className="role-code">{s.code}</span>{!orbatReadOnly && <div className="slot-action-panel"><button disabled={!canLockSlot(s)} className="slot-padlock" aria-label={"Manage passphrase lock for "+s.name} aria-pressed={!!data.slotLocks?.[s.id]} title={data.slotLocks?.[s.id]?"Disable slot lock":"Enable slot lock"} onClick={()=>{if(data.slotLocks?.[s.id] && data.admin){void command({action:'slot_lock',slot:s.id,enabled:false,expectedLocked:true});return;}setSelected(s.id);open("slot_lock",{enabled:data.slotLocks?.[s.id]?"false":"true"})}}><LockKeyhole size={15}/></button>{person ? <button className="withdraw-button" onClick={()=>{setSelected(s.id);open('withdraw',{expected:person.id,created:a!.created,name:person.name})}}>Withdraw</button> : <button className="join" disabled={!operation || operation.status!=='open' || loading || !!error} onClick={()=>{setSelected(s.id);open('claim')}}><Plus size={14}/><span>Sign up</span></button>}</div>}</ChangeSignal>;
    }
    return <>
    <div className="crt-layer motion" aria-hidden="true">
    <div className="crt-scanlines"/>
    <div className="crt-grain"/>
    <div className="crt-static"/>
    <PixelField />
    </div>
    <div className="terminal-frame" aria-hidden="true"/>
    <div className="crt-foreground" aria-hidden="true">
    <div className="crt-roll"/>
    </div>
    <PersonnelProfile person={profile} onClose={()=>setProfile(null)} onOperation={id=>{setProfile(null);setArchiveId(id);setView('archive')}}/>
    <Dialog open={!!strikePerson && data.admin} onOpenChange={open=>{if(!open)setStrikePerson(null)}}><DialogContent className="regiment-dialog history-overlay"><DialogTitle>Strikes — {strikePerson?.name}</DialogTitle><DialogDescription>Administrator-only disciplinary record. Add, review or remove a strike.</DialogDescription>{strikePerson && data.admin && <PersonnelWarnings key={strikePerson.id} userId={strikePerson.id} onChanged={()=>setRecordRevision(n=>n+1)}/>}</DialogContent></Dialog>
    <Boot />
    <Toaster position="bottom-right" theme="dark" closeButton toastOptions={{ duration: 6500 }} icons={{ success: <ShieldCheck size={20}/>, error: <X size={20}/> }}/>
    <TerminalHeader loading={loading} error={error} admin={data.admin}/>
    <main className={view==='admin'?'admin-page':''}>

    <Tabs className="terminal-tabs" value={view} onValueChange={changeView}>
    <div className="navline">
    <TabsList variant="line" className="main-nav">
    <TabsTrigger value="orbat">
    <Crosshair size={17}/>ORBAT</TabsTrigger><TabsTrigger value="admin">
    <ShieldCheck size={17}/>ADMINISTRATION</TabsTrigger><TabsTrigger value="archive">OPERATION ARCHIVE</TabsTrigger><TabsTrigger value="ledger">REGIMENT LEDGER</TabsTrigger>
    </TabsList>
    <span className="terminal-id">
    <img src="/imperial-aquila.png" alt="" aria-hidden="true"/>TERMINAL 022 // MUNITORUM</span>
    </div>{error && <div className="error-banner" role="alert">{error}<button onClick={load}>
        <RefreshCw size={14}/>Retry</button>
        </div>}
    <TabsContent value="orbat">
    <div className="page-heading">
    <div>
    <p className="eyebrow">
    <TerminalText text="REGIMENTAL COMMAND // 01"/>
    </p>
    <h1>
    <TerminalText text="Order of battle"/>
    <span className="heading-period">.</span>
    </h1>
    </div>
    </div>

    {data.configuration?.locked && <div className="orbat-lock-notice" role="status"><LockKeyhole size={17} aria-hidden="true"/><span><strong>ORBAT locked.</strong> {data.admin?"Administrator editing is enabled. Unlock it in Operation configuration to reopen public changes.":"Only administrators can change the ORBAT. Contact an administrator for a correction."}</span></div>}
    <div className={"workspace " + (openManifest ? "open-manifest" : "")}>
    <div className="roster">
    {layout.sections.map(group=>{const section=slots.filter(s=>s.section===group.id);const flight=section.length>0 && section.every(s=>s.type==='pilot');const deployable=assigned.some(a=>section.some(s=>s.id===a.slot) && data.users.some(u=>u.id===a.user_id && u.status==='active'));const filled=mainAssigned.filter(a=>section.some(s=>s.id===a.slot)).length;return <section className={flight?'flight-section':'platoon'} key={group.id} aria-label={group.name}><div className="section-heading"><div><span className="eyebrow">{group.eyebrow}</span><h2><TerminalText text={group.name}/></h2></div><span className="section-count">{filled} / {section.length} ASSIGNED</span></div><div className="section-strip"><span><Crosshair size={14}/>{group.name}</span><span>{flight?`${filled} / ${section.length} FILLED · ${deployable?'DEPLOYABLE':'AWAITING PILOT'}`:`SECTION STRENGTH: ${filled} / ${section.length} FILLED`}</span></div><div className="role-grid">{section.map(roleCard)}</div></section>})}
    <div className="roster-foot">
    <span>
    <LockKeyhole size={13}/>Protected roles require their own passphrase.</span>
    <span>One assignment per member.</span>
    </div>


    </div>
    <aside>
    <ChangeSignal className="deployment-clock" value={JSON.stringify(data.countdown)}>
    <div className="panel-heading">
    <span className="eyebrow">
    <TerminalText text="NEXT DROP"/>
    </span>
    <CalendarDays size={16}/>
    </div>
    <div className="countdown-digits" role="timer" aria-label="Time until next operation">{target ? [[Math.floor(remaining / 86400), 'D'], [Math.floor(remaining / 3600) % 24, 'H'], [Math.floor(remaining / 60) % 60, 'M'], [remaining % 60, 'S']].map(([n, label]) => <div key={label}>
        <strong>{String(n).padStart(2, '0')}</strong>
        <span>{label}</span>
        </div>) : <span>Establishing chronometer…</span>}</div>{target && <>
        <p className="drop-local">Your time: {new Date(target).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })} · {Intl.DateTimeFormat().resolvedOptions().timeZone}</p>
        <span className="clock-mode">{remaining === 0 ? 'DEPLOYMENT TIME REACHED' : data.countdown?.autoRenew ? 'WEEKLY VOX ORDERS' : 'SINGLE DEPLOYMENT'}</span>
        </>}</ChangeSignal>
    <div className="strength-panel">
    <div className="panel-heading">
    <span className="eyebrow">
    <TerminalText text="OPERATION STATUS"/>
    </span>
    <Users size={16}/>
    </div>
    <div className="strength-number">{String(mainAssigned.length + reserves.filter(a=>a.slot.startsWith('reserve:')).length).padStart(2, '0')}<span> / {slots.length}{reserves.some(a=>a.slot.startsWith('reserve:'))?' + RESERVES':''}</span>
    </div>
    <p>Personnel assigned</p>
    <div className="strength-bars" aria-label={`${mainAssigned.length} of ${slots.length} roles assigned`}>{slots.map((s, i) => <TerminalLamp key={s.id} lit={mainAssigned.some(a => a.slot === s.id)} seed={'operation-' + s.id}/>)}</div>
    <div className="strength-detail">
    <span>Available positions</span>
    <strong>{slots.length - mainAssigned.length}</strong>
    </div>
    <div className="strength-detail">
    <span>Active personnel</span>
    <strong>{active.length}</strong>
    </div>
    </div>
    <div className="readiness-report">
    <div className="panel-heading">
    <span className="eyebrow">
    <TerminalText text="COMBAT READINESS"/>
    </span>
    <Radio size={16}/>
    </div>
    <div className="report-ticker"> // SPEAR / VOX ASSESSMENT</div>
    <div className="readiness-verdict" data-grade={readiness.grade}>
    <span>
    <TerminalText text="REGIMENTAL DISPOSITION"/>
    </span>
    <strong>
    <TerminalText text={openManifest ? (reserves.length ? 'MANIFEST ASSEMBLED' : 'AWAITING PERSONNEL') : readiness.label}/>
    </strong>
    </div>
    <div className="readiness-gauge" aria-hidden="true">
    <i style={{ width: `${readiness.ratio * 100}%` }}/>
    </div>{[{ label: 'COMMAND', ids: sectionSlots.filter(s=>s.type==='leader').map(s=>s.id) }, { label: 'VOX / MEDICAL', ids: sectionSlots.filter(s=>['vox','medic'].includes(s.type)).map(s=>s.id) }, { label: 'HEAVY WEAPONS', ids: sectionSlots.filter(s=>['at','plasma','melta','stubber'].includes(s.type)).map(s=>s.id) }, { label: 'LINE INFANTRY', ids: sectionSlots.filter(s=>s.type==='trooper').map(s=>s.id) }].map(g => {
            const n = mainAssigned.filter(a => g.ids.includes(a.slot)).length;
            return <div className="report-row" key={g.label}>
            <span>{g.label}</span>
            <strong>
            <TerminalText text={g.ids.length === 0 ? 'NOT ASSIGNED' : g.label === 'FLIGHT ASSET' ? (shieldDeployable ? 'DEPLOYABLE' : 'AWAITING PILOT') : formationReadiness(n, g.ids.length)}/>
            </strong>
            </div>;
        })}<div className="report-dispositions">
    <span className="eyebrow">PERSONNEL DISPOSITIONS</span>
    <TerminalCounters items={[{label:openManifest?'Attending':'Reserve',value:reserves.filter(a=>a.slot.startsWith('reserve:')).length},{label:'Tentative',value:reserves.filter(a=>a.slot.startsWith('tentative:')).length},{label:'Absent',value:reserves.filter(a=>a.slot.startsWith('absent:')).length}]}/>
    </div>
    <p className="report-outcome">
    <TerminalText text={readiness.order}/>
    </p>
    </div>
    </aside>
    </div>
    <section className="disposition-grid">{['reserve','tentative','absent'].map(disposition=><div className="reserve-section" key={disposition}><div className="section-heading"><h2>{disposition==='reserve' && openManifest?'ATTENDING':disposition.toUpperCase()}</h2>{!orbatReadOnly && <button className="secondary" disabled={busy || loading || !operation} onClick={()=>{setSelected(disposition);open('claim')}}><Plus size={14}/>Sign up</button>}</div>{reserves.filter(a=>a.slot.startsWith(disposition+':')).map(a=>{const person=data.users.find(p=>p.id===a.user_id);return <div className="disposition-member" key={a.slot}>{person ? <button className="role-profile" onClick={()=>setProfile(person)}><strong>{rankAbbreviation(person.rank)} {person.name}</strong><MedalCount person={person}/></button> : <strong>Unknown member</strong>}{!orbatReadOnly && <button className="withdraw-button" onClick={()=>{setSelected(a.slot);open('withdraw',{expected:a.user_id,created:a.created,name:person?.name || ''})}}>Withdraw</button>}</div>})}{disposition==='absent' && defaultAbsent.map(p=><div className="disposition-member" key={p.id}><button className="role-profile" onClick={()=>setProfile(p)}><strong>{rankAbbreviation(p.rank)} {p.name}</strong><MedalCount person={p}/></button><span className="eyebrow">UNCONFIRMED</span></div>)}{!reserves.some(a=>a.slot.startsWith(disposition+':')) && (disposition!=='absent' || !defaultAbsent.length) && <p className="muted">No members recorded.</p>}</div>)}</section>
    </TabsContent>
    <TabsContent value="archive"><PublicArchive initialId={archiveId}/></TabsContent>
    <TabsContent value="ledger"><RegimentLedger onOperation={id=>{setArchiveId(id);changeView('archive')}}/></TabsContent>
    <TabsContent value="admin" className="bureau-surface">
    <div className="page-heading">
    <div>
    <p className="eyebrow">DEPARTMENTO MUNITORUM // 022</p>
    <h1>
    <TerminalText text="Munitorum bureau"/>
    <span className="heading-period">.</span>
    </h1>
    </div>{data.admin && <button className="secondary" onClick={async () => { if (await command({ action: 'logout' }))
            toast.success('Administrator session ended.'); }}>
        <LogOut size={16}/>Log Out</button>}</div>{!data.admin ? <div className="bureau-login">
        <aside className="bureau-index">
        <img src="/regiment-logo-transparent.png" alt="Regimental insignia"/>
        <span className="eyebrow">IMPERIAL GUARD / XXII</span>
        <h2>Regimental<br />Records Office</h2>
        <div className="bureau-stencil">DEPARTMENTO<br />MUNITORUM</div>
        <dl>
        <div>
        <dt>ARCHIVE</dt>
        <dd>022 / SPEAR</dd>
        </div>
        <div>
        <dt>AUTHORITY</dt>
        <dd>REGIMENTAL COMMAND</dd>
        </div>
        <div>
        <dt>DISPOSITION</dt>
        <dd>RESTRICTED</dd>
        </div>
        </dl>
        <p>By order of the Departmento Munitorum.<br />The Emperor protects.</p>
        </aside>
        <div className="admin-login">
        <div className="warrant-header">
        <span>ACCESS WARRANT / 022-C</span>
        <span>COMMAND ONLY</span>
        </div>
        <div className="clearance-symbol">
        <ShieldCheck size={36}/>
        </div>
        <span className="eyebrow">COMMAND CIPHER REQUIRED</span>
        <h2>Administrator sign-in</h2>
        <p>Enter your administrator key to manage personnel, role passphrases, the countdown and archived operations.</p>
        <form onSubmit={async (e) => { e.preventDefault(); if (await command({ action: 'login', key: phrase })) {
            setPhrase('');
            changeView('admin');
            toast.success('Signed in. Personnel records opened.');
        } }}>
        <Input label="Administrator access key" type="password" autoComplete="current-password" value={phrase} onChange={e => setPhrase(e.target.value)}/>
        <button className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>{dialogError && <p className="form-error" role="alert">{dialogError}</p>}</form>
        <div className="bureau-boot-log">
        <span>01 / VOX RELAY ESTABLISHED</span>
        <span>02 / RECORDS SEAL INTACT</span>
        <span>03 / AWAITING COMMAND CIPHER<span className="cursor-block"/>
        </span>
        </div>
        <span className="login-foot">WARRANT VALIDITY / 8 HOURS</span>
        </div>
        </div> : <ChangeSignal className="bureau-console" value={String(recordRevision)}>
        <div className="bureau-console-header">
        <img className="bureau-aquila" src="/imperial-aquila.png" alt="Imperial eagle insignia"/>
        <div>
        <span className="eyebrow">REGIMENTAL RECORDS OFFICE</span>
        <strong>COMMAND WARRANT VERIFIED</strong>
        </div>
        <span>XXII / SPEAR PLATOON<br />{data.users.length} PERSONNEL ON ROLL</span>
        </div>
        <nav className="bureau-navigation" aria-label="Administration sections">{[{ id: 'players', code: '01', name: 'Personnel records' }, { id: 'clearance', code: '02', name: 'Administrator key' }, { id: 'countdown', code: '03', name: 'Operation configuration' }, { id: 'operation_audits', code: '04', name: 'Operation archive' }, { id: 'audit', code: '05', name: 'Assignment history' }, {id:'medals',code:'06',name:'Medals'}].map(area => <button key={area.id} type="button" aria-pressed={adminArea === area.id} onClick={() => setAdminArea(area.id)}>
            <span>{area.code}</span>
            <strong>{area.name}</strong>
            </button>)}</nav>
        <section className="bureau-panel" hidden={adminArea !== 'players'} aria-label="players"><div className="admin-panel-content">
        <div className="admin-section-head">
        <h2>
        <TerminalText text="Personnel records"/>
        </h2>
        <button className="secondary" onClick={() => open('register')}>
        <Plus size={16}/>Add personnel</button>
        </div>
        <div className="table-panel">
        <Table>
        <TableHeader>
        <TableRow>
        <TableHead>NAME</TableHead>
        <TableHead>RANK</TableHead>
        <TableHead>STATUS</TableHead>
        <TableHead>RECORD</TableHead>
        </TableRow>
        </TableHeader>
        <TableBody>{data.users.map(u => <TableRow key={u.id}>
            <TableCell>
            <TerminalText text={u.name}/>
            </TableCell>
            <TableCell>
            <TerminalText text={u.rank}/>
            </TableCell>
            <TableCell>
            <span className={'person-status ' + u.status}>
            <TerminalText text={statusLabel(u.status)}/>
            </span>
            </TableCell>
            <TableCell>
            <div className="record-actions">
            <button className="record-action" onClick={() => edit(u)}><Settings2 size={14}/>Manage
            </button>
            <button className="record-action record-action-strikes" onClick={()=>setStrikePerson(u)}><Shield size={14}/>Strikes</button>
            <button className="record-action record-action-delete" onClick={() => setConfirm({ type: 'deregister', user: u.id, name: u.name })}><X size={14}/>Delete</button>
            </div>
            </TableCell>
            </TableRow>)}</TableBody>
        </Table>{!data.users.length && <div className="empty-state">
            <p>No personnel records. Use Add personnel to create one.</p>
            </div>}</div>
        </div></section>
        <section className="bureau-panel" hidden={adminArea !== 'clearance'} aria-label="clearance"><div className="admin-panel-content">
        <div className="admin-section-head">
        <h2>
        <TerminalText text="Administrator access"/>
        </h2>
        <span className="muted">Command access key</span>
        </div>

        <div className="admin-access-panel">
        <ShieldCheck size={25}/>
        <div>
        <h3>Administrator access key</h3>
        <p>Changing the key ends all administrator sessions.</p>
        </div>
        <button className="secondary" onClick={() => { setSelected('admin'); open('phrase'); }}>Change key</button>
        </div>
<h3>Role passphrases</h3>{[...new Set(layout.slots.map(s=>s.phraseRole))].filter(role=>policies[role]?.enabled || role==='ic').map(role=><div className="admin-access-panel" key={role}><div><strong>{roleLabel(role)}</strong><p>{data.configuredRoles.includes(role)?'Configured':'Not configured'}</p></div><button className="secondary" onClick={()=>{setSelected(role);open('phrase')}}>Set passphrase</button><button className="secondary" onClick={()=>setConfirm({type:'regenerate',role})}>Generate</button><button className="secondary" onClick={()=>setConfirm({type:'reset',role})}>Remove</button></div>)}
        </div></section>
        <section className="bureau-panel" hidden={adminArea !== 'countdown'} aria-label="Operation configuration"><div className="admin-panel-content"><OperationSettings config={data.configuration || {title:"Regimental operation",mode:"main",locked:false}} busy={busy} save={async c=>!!await command({action:"operation_config",...c})}/>{data.countdown && <CountdownSettings config={data.countdown} busy={busy} save={async (config) => !!await command({ action: 'countdown', config })}/>}</div></section>
        <section className="bureau-panel" hidden={adminArea !== 'operation_audits'} aria-label="operation audits"><div className="admin-panel-content">
        <OperationAudits onChanged={async()=>{await load();setRecordRevision(n=>n+1)}} recent={data.operationAudits || []} busy={busy} onReset={() => open('reset_orbat', { title: data.configuration?.title || 'Regimental operation', disposition: 'declare' })}/>
        </div></section>
        <section className="bureau-panel" hidden={adminArea !== 'medals'}><MedalAdmin users={data.users} revision={recordRevision} onChanged={()=>{void load();setRecordRevision(n=>n+1)}}/></section>
        <section className="bureau-panel" hidden={adminArea !== 'audit'} aria-label="audit"><div className="admin-panel-content">
        <div className="admin-section-head">
        <div>
        <h2>
        <TerminalText text="Assignment history"/>
        </h2>
        <p className="audit-caption">See who signed up, changed roles or withdrew, and when each change happened.</p>
        </div>
        <span className="eyebrow">REGIMENTAL ANNALS // COMMAND RECORD</span>
        </div>
        <ChangeLog revision={recordRevision}/><details className="legacy-assignment-history"><summary>Assignment history (includes earlier records)</summary><div className="audit-register">{auditRows.map(a => <div className="audit-entry" key={a.id}>
            <span className="audit-id">#{String(a.id).padStart(5, '0')}</span>
            <div>
            <div className="audit-top">
            <span className={'audit-event ' + a.event}>{({ filled: 'SIGNED UP', edited: 'CHANGED', cleared: 'CLEARED' } as Record<string, string>)[a.event] || a.event.toUpperCase()}</span>
            <strong>{roleLabel(a.slot)}</strong>
            </div>
            <p>{a.before_name || 'Vacant'} <ChevronRight size={13}/> {a.after_name || 'Vacant'}</p>
            <div className="audit-meta">
            <span>{a.actor.replace('Public signup', 'Signup').replace('Public withdrawal', 'Withdrawal').replace('operation audit and reset', 'ORBAT reset').replace('personnel deregistration', 'personnel deleted')}</span>
            <time dateTime={a.created}>{new Date(a.created).toLocaleString('en-GB')}</time>
            </div>
            </div>
            </div>)}{!auditRows.length && <div className="empty-state">
            <Terminal size={30}/>
            <h3>No assignment changes yet</h3>
            <p>Signups, role changes and withdrawals appear here. Older changes from before logging began are unavailable.</p>
            </div>}</div>{auditRows.length >= 50 && !auditEnd && <button className="secondary audit-more" disabled={auditBusy} onClick={moreAudit}>{auditBusy ? 'Retrieving records…' : 'Load older records'}</button>}</details></div></section>
        </ChangeSignal>}</TabsContent>
    </Tabs>
    <footer>
    <span>22ND DROP REGIMENT <span className="footer-slash">/</span> ADEPTUS MUNITORUM</span>
    <span>THE EMPEROR PROTECTS.</span>
    <span>ARCHIVE REV. 020</span>
    </footer>
    </main>
    <Dialog open={!!modal} onOpenChange={v => { if (!v && !busy)
        setModal(''); }}>
    <DialogContent className="regiment-dialog">
    <DialogTitle>{modal === 'reset_orbat' ? 'Seal operation' : modal === 'slot_lock' ? (form.enabled==='true'?'Enable slot passphrase lock':'Disable slot passphrase lock') : modal === 'slot_role' ? 'Edit slot role' : modal === 'release_assignment' ? `Clear ${form.name}'s assignment?` : modal === 'withdraw' ? `Withdraw ${form.name}?` : modal === 'generated' ? 'New passphrase' : modal === 'register' ? 'New personnel record' : modal === 'edit_assignment' ? 'Edit assignment' : modal === 'claim' ? 'Report for duty' : modal === 'edit' ? 'Personnel record' : selected === 'admin' ? 'Administrator access key' : 'Role passphrase'}</DialogTitle>
    <DialogDescription>{modal === 'slot_lock' ? (form.enabled==='true'?'Set a passphrase to protect this slot.':'Confirm your SL clearance to remove this slot lock.') : modal === 'slot_role' ? 'Choose the role name for this slot. Its current assignment will be kept.' : modal === 'reset_orbat' ? 'Declare saves the manifest to the public archive and clears signups. Destroy clears signups without saving an archive. Personnel records and assignment history are kept.' : modal === 'withdraw' ? `${slot?.name} · This withdrawal will be recorded in the role audit log.` : modal === 'generated' ? 'This passphrase replaces the previous one for this role.' : modal === 'register' ? 'Add a member to the personnel roll. Only administrators can create records.' : (modal === 'claim' || modal === 'edit_assignment') ? `${slot?.name} · 22nd Drop Regiment` : modal === 'edit' ? 'Manage rank, enlistment and service status.' : `Set a new ${selected === 'admin' ? 'administrator' : roleLabel(selected)} passphrase.`}</DialogDescription>{modal === 'generated' ? <div className="generated-key">
        <span className="eyebrow">{selected === 'admin' ? 'ADMINISTRATOR' : roleLabel(selected).toUpperCase()} // NEW PASSPHRASE</span>
        <code>{generated}</code>
        <p>Copy this passphrase before closing. You cannot view it again later.</p>
        <div className="button-row">
        <button className="primary" onClick={async () => { try {
            await navigator.clipboard.writeText(generated);
            toast.success('Passphrase copied.');
        }
        catch {
            toast.error('Copy the passphrase manually from this window.');
        } }}>Copy passphrase</button>
        <button className="secondary" onClick={() => { setGenerated(''); setModal(''); }}>Done</button>
        </div>
        </div> : <form onSubmit={submit} className="dialog-form">{modal === 'slot_lock' && <>{form.enabled==='true' && <Input label="New slot passphrase" type="password" {...f('lockPhrase')} required maxLength={200}/ >}{!data.admin && <Input label="SL passphrase" type="password" value={phrase} onChange={e=>setPhrase(e.target.value)} required/>}<p className="field-help">This slot lock resets when the ORBAT is sealed or cleared.</p></>}{modal === 'slot_role' && <><Choice label="Slot role" value={form.role} onChange={role=>{const types:Record<string,string>={'Section Leader':'leader','Gamemaster':'command','Pilot':'pilot','Vox Operator':'vox','Medicae':'medic','AT Specialist':'at','Plasma Gunner':'plasma','Melta Gunner':'melta','Stubber':'stubber','Guardsmen':'trooper'};setForm({...form,role,icon:types[role]})}} items={slotRoleOptions(slots.find(s=>s.id===selected) || {id:selected}).map(value=>({value,label:value,icon:({'Section Leader':'leader','Gamemaster':'command','Pilot':'pilot','Vox Operator':'vox','Medicae':'medic','AT Specialist':'at','Plasma Gunner':'plasma','Melta Gunner':'melta','Stubber':'stubber','Guardsmen':'trooper'} as Record<string,string>)[value] || form.icon || 'trooper'}))}/>{!data.admin && <Input label="SL passphrase" type="password" value={phrase} onChange={e=>setPhrase(e.target.value)} required/>}</>}{modal === 'release_assignment' && <>{clearanceFields('canEditAssignments')}<p className="field-help">This clears another member’s assignment and records your role clearance in the history.</p></>}{modal === 'edit_assignment' && !data.admin && clearanceFields('canEditAssignments')}{modal === 'withdraw' && <>{slot?.protected && !data.admin && <Input label={`${slot.name} passphrase`} type="password" value={phrase} onChange={e => setPhrase(e.target.value)} autoComplete="off"/>}<p className="field-help">{slot?.protected && !data.admin ? 'Enter this protected role’s current passphrase to withdraw.' : 'Confirm to clear this assignment from the public ORBAT.'}</p>
            </>}{(modal === 'register' || modal === 'edit') && <>
            <Input label="Personnel name" autoComplete="nickname" {...f('name')} required minLength={2} maxLength={60}/>
            </>}{(modal === 'edit' || modal === 'register') && <>
            <div className="form-two">
            <label className="field">
            <span>Rank</span>
            <Choice value={form.rank || 'Recruit'} onChange={v => setForm({ ...form, rank: v })} label="Rank" items={ranks.map(v => ({ value: v, label: v }))}/>
            </label>
            <Input label="Date of enlistment" type="date" {...f('enlisted')} required={modal === 'edit'}/>
            </div>
            <label className="field">
            <span>Service status</span>
            <Choice value={form.status || 'active'} onChange={v => setForm({ ...form, status: v })} label="Service status" items={['active', 'retired', 'inactive', 'absent'].map(v => ({ value: v, label: statusLabel(v) }))}/>
            </label>
            </>}{(modal === 'claim' || modal === 'edit_assignment') && <>
            <label className="field">
            <span>Registered personnel</span>
            <Choice value={userId} onChange={setUserId} label="Registered personnel" placeholder="Select your personnel record" items={(modal === 'edit_assignment' ? active.filter(u => u.id === form.expected || !assigned.some(a => a.user_id === u.id)) : available).map(u => ({ value: u.id, label: `${rankAbbreviation(u.rank)} ${u.name}` }))}/>
            </label>{!available.length && <div className="form-note">No unassigned active personnel. Ask an administrator to add your personnel record or update your service status.</div>}{modal === 'claim' && slot?.protected && !data.admin && <>
                <div className="protected-note">
                <LockKeyhole size={18}/>
                <span>{data.configuredRoles.includes(slotPhraseRole(slot)) ? 'This role requires its own passphrase.' : 'An administrator must set this role’s passphrase before signup.'}</span>
                </div>
                <Input label={`${slot.name} passphrase`} type="password" value={phrase} onChange={e => setPhrase(e.target.value)} autoComplete="off"/>
                </>}<p className="field-help">One assignment per member on the ORBAT. Withdrawals are public. Protected slots require their current role passphrase.</p>
            </>}{modal === 'phrase' && <>
            <Input label="New passphrase" type="password" value={phrase} onChange={e => setPhrase(e.target.value)} autoComplete="new-password"/>
            <Input label="Confirm passphrase" type="password" value={form.confirm || ''} onChange={e => setForm({ ...form, confirm: e.target.value })} autoComplete="new-password"/>{selected !== 'admin' && <p className="field-help">Existing assignments are kept. Members will need the new passphrase to sign up or withdraw.</p>}</>}{dialogError && <p className="form-error" role="alert">{dialogError}</p>}{modal === 'reset_orbat' ? <><Input label="Operation name" {...f('title')} required maxLength={100}/><div className="seal-review"><h3>Confirm personnel dispositions</h3><p>{defaultAbsent.length} members not signed up will be recorded as absent.</p>{reserves.map(a=><p key={a.slot}>{a.slot.startsWith('reserve:') && openManifest?'ATTENDING':a.slot.split(':')[0].toUpperCase()} · {data.users.find(p=>p.id===a.user_id)?.name}</p>)}{reserves.filter(a=>a.slot.startsWith('tentative:')).map(a=><label className="tentative-review" key={a.user_id}><span>{data.users.find(p=>p.id===a.user_id)?.name}</span><select required value={form['attendance_'+a.user_id] || ''} onChange={e=>setForm({...form,['attendance_'+a.user_id]:e.target.value})}><option value="">Confirm attendance…</option><option value="present">{openManifest?'Present — mark attending':'Present — add to reserve'}</option><option value="absent">Absent</option></select></label>)}<label><input type="checkbox" required checked={form.reviewed==='yes'} onChange={e=>setForm({...form,reviewed:e.target.checked?'yes':''})}/> I confirm these {openManifest?'attending':'reserve'}, tentative and absent members.</label></div><div className="seal-actions"><button type="button" className="primary" disabled={busy || !form.title?.trim() || form.reviewed!=='yes' || reserves.some(a=>a.slot.startsWith('tentative:') && !form['attendance_'+a.user_id])} onClick={async()=>{if(await command({action:'clear_all',confirmed:form.reviewed==='yes',title:form.title,tentativeAttendance:Object.fromEntries(reserves.filter(a=>a.slot.startsWith('tentative:')).map(a=>[a.user_id,form['attendance_'+a.user_id]==='present'])),confirmedDispositions:reserves.map(({slot,user_id,created})=>({slot,user_id,created})).sort((a,b)=>a.slot.localeCompare(b.slot))})){toast.success('Operation declared.');setModal('')}}}>SEAL AND DECLARE</button><button type="button" className="danger-text secondary" disabled={busy || !form.title?.trim() || form.reviewed!=='yes' || reserves.some(a=>a.slot.startsWith('tentative:') && !form['attendance_'+a.user_id])} onClick={async()=>{if(await command({action:'destroy_orbat',confirmed:form.reviewed==='yes',tentativeAttendance:Object.fromEntries(reserves.filter(a=>a.slot.startsWith('tentative:')).map(a=>[a.user_id,form['attendance_'+a.user_id]==='present'])),confirmedDispositions:reserves.map(({slot,user_id,created})=>({slot,user_id,created})).sort((a,b)=>a.slot.localeCompare(b.slot))})){toast.success('Manifest destroyed.');setModal('')}}}>SEAL AND DESTROY</button></div></> : <div className="dialog-actions">
        <button className="secondary" type="button" disabled={busy} onClick={() => setModal('')}>Cancel</button>
        <button className="primary" disabled={busy || (orbatReadOnly && ['claim','withdraw','slot_role','slot_lock'].includes(modal)) || ((modal === 'claim' || modal === 'edit_assignment') && !userId) || (modal === 'phrase' && phrase !== form.confirm)}>{busy ? 'Saving…' : modal === 'reset_orbat' ? (form.disposition === 'destroy' ? 'SEAL AND DESTROY' : 'SEAL AND DECLARE') : modal === 'release_assignment' ? 'Confirm clear assignment' : modal === 'withdraw' ? 'Confirm withdrawal' : modal === 'claim' ? 'Confirm assignment' : modal === 'register' ? 'Add personnel' : modal==='slot_lock' ? (form.enabled==='true'?'Enable lock':'Disable lock') : 'Save record'}</button>
        </div>}
        </form>}</DialogContent>
    </Dialog>
    <AlertDialog open={!!confirm} onOpenChange={v => !v && setConfirm(null)}>
    <AlertDialogContent className="regiment-dialog">
    <AlertDialogTitle>{confirm?.type === 'clear_all' ? 'Clear the entire ORBAT?' : confirm?.type === 'deregister' ? `Delete ${confirm.name}?` : confirm?.type === 'withdraw' ? `Withdraw ${confirm.name}?` : confirm?.type === 'regenerate' ? 'Generate a new role passphrase?' : confirm?.type === 'release' ? 'Clear this assignment?' : 'Remove this role passphrase?'}</AlertDialogTitle>
    <AlertDialogDescription>{confirm?.type === 'clear_all' ? 'All fixed roles and reinforcement assignments will be cleared. Personnel records and audit history remain. Every cleared role is recorded in the audit log.' : confirm?.type === 'deregister' ? 'This permanently removes the personnel record and clears all of their ORBAT and reinforcement assignments. The audit history is preserved.' : confirm?.type === 'withdraw' ? 'Your assignment will be cleared and recorded in the audit log. You can sign up again on the ORBAT.' : confirm?.type === 'regenerate' ? 'Replace the current passphrase with a randomly generated one. Copy it when shown. Existing assignments are kept; signups and withdrawals will require the new passphrase.' : confirm?.type === 'release' ? 'This assignment will be cleared and recorded in the audit log.' : 'If protection is enabled, signups and withdrawals will be blocked until you set a new key. Delegated editing with this key will stop. Existing assignments are kept.'}</AlertDialogDescription>
    <AlertDialogFooter>
    <AlertDialogCancel>Cancel</AlertDialogCancel>
    <AlertDialogAction onClick={async () => { if (confirm?.type === 'clear_all') {
        if (await command({ action: 'clear_all' }))
            toast.success('ORBAT cleared. Personnel records retained.');
    }
    else if (confirm?.type === 'deregister') {
        if (await command({ action: 'deregister', id: confirm.user })) {
            toast.success('Personnel deleted. Assignment history kept.');
            setModal('');
        }
    }
    else if (confirm?.type === 'regenerate') {
        const role = confirm.role!;
        const result = await command({ action: 'regenerate_phrase', role });
        if (result?.phrase) {
            setSelected(role);
            open('generated');
            setGenerated(result.phrase);
        }
    }
    else if (confirm)
        await command(confirm.type === 'release' ? { action: 'release', operation: opId, slot: confirm.slot } : { action: 'reset_phrase', role: confirm.role }); setConfirm(null); }}>Confirm</AlertDialogAction>
    </AlertDialogFooter>
    </AlertDialogContent>
    </AlertDialog>
    </>;
}
