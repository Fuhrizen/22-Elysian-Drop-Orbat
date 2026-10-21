export const slots = [
    { id: 'gm', name: 'Gamemaster', code: 'CMD', protected: true, type: 'command', section: 'command' },
    ...[1, 2].flatMap(n => [
        { id: n === 1 ? 'ic' : 'ic2', name: 'Section Leader', code: `S${n}/01`, protected: true, type: 'leader', section: `spear${n}` },
        ...(n === 1 ? [{ id: 'vox', name: 'Vox Operator', code: 'S1/02', protected: false, type: 'vox', section: 'spear1' }] : []),
        { id: n === 1 ? 'medic' : 'medic2', name: 'Medicae', code: `S${n}/0${n === 1 ? 3 : 2}`, protected: false, type: 'medic', section: `spear${n}` },
        { id: 'at' + n, name: 'AT Specialist', code: `S${n}/0${n === 1 ? 4 : 3}`, protected: false, type: 'at', section: `spear${n}` },
        { id: n === 1 ? 'plasma' : 'plasma2', name: 'Plasma Gunner', code: `S${n}/0${n === 1 ? 5 : 4}`, protected: false, type: 'plasma', section: `spear${n}` },
        ...[1, 2, 3].map(i => ({ id: 'trooper' + ((n - 1) * 3 + i), name: 'Guardsmen', code: `S${n}/0${i + (n === 1 ? 5 : 4)}`, protected: false, type: 'trooper', section: `spear${n}` })),
        ...(n === 2 ? [{ id: 'vox2', name: 'Guardsmen', code: 'S2/08', protected: false, type: 'trooper', section: 'spear2' }] : [])
    ]),
    ...[1, 2].map(n => ({ id: n === 1 ? 'shield' : 'shield2', name: 'Pilot ' + n, code: 'FLT/0' + n, protected: true, type: 'pilot', section: 'shield' }))
];
export function phraseRole(id: string) { return id === 'shield2' ? 'shield' : id === 'ic2' ? 'ic' : id; }
export const protectedRoles = slots.filter(s => s.protected && s.id !== 'shield2' && s.id !== 'ic2');
export type OperationConfig = { title: string; mode: 'main' | 'open'; locked: boolean };
export const defaultOperationConfig: OperationConfig = { title: 'Regimental operation', mode: 'main', locked: false };
export const canLockSlot = (s:{id:string;type?:string}) => !['gm','ic','ic2','shield','shield2'].includes(s.id) && !['command','leader','pilot'].includes(s.type || '');
export type Person = {
    medal_count?: number;
    id: string;
    name: string;
    rank: string;
    status: string;
    enlisted: string;
    steam_id?: string;
    discord_id?: string;
    steam_oauth_link?: string;
    discord_oauth_link?: string;
};
export type Operation = {
    id: string;
    title: string;
    date: string;
    briefing: string;
    status: string;
    created: string;
};
export type Assignment = {
    operation_id: string;
    slot: string;
    user_id: string;
    created: string;
};
export const ranks = ['Commissar', 'Junior Commissar', 'Lieutenant', 'Staff Sgt', 'Flight Lieutenant', 'Sergeant', 'Corporal', 'Guardsman', 'Recruit'];
export function rankOrder(rank: string) { const index = ranks.indexOf(rank === 'Staff Sergeant' ? 'Staff Sgt' : rank === 'Trooper' || rank === 'Veteran' ? 'Guardsman' : rank); return index < 0 ? ranks.length : index; }
export function comparePersonnel(a: {rank:string;name:string}, b: {rank:string;name:string}) { return rankOrder(a.rank) - rankOrder(b.rank) || a.name.localeCompare(b.name); }
export const rankAbbreviations: Record<string, string> = { Commissar:'Cmsr.', 'Junior Commissar':'Jr Cmsr.', Recruit: 'Rct.', Trooper: 'Gdsm.', Guardsman: 'Gdsm.', 'Flight Lieutenant': 'Flt Lt', Veteran: 'Vet.', Corporal: 'Cpl.', Sergeant: 'Sgt.', 'Staff Sgt': 'SSgt.', 'Staff Sergeant': 'SSgt.', Lieutenant: 'Lt.', Captain: 'Capt.', Major: 'Maj.', Colonel: 'Col.' };
export function rankAbbreviation(rank: string) { return rankAbbreviations[rank] || rank; }
const readinessGrades = [
    { label: 'AWAITING ORDERS', order: 'The vox awaits the regiment’s return.' },
    { label: 'OPERATION FORMING', order: 'The first boots answer the call.' },
    { label: 'CADRE FORMING', order: 'The regimental cadre gathers beneath the colours.' },
    { label: 'FORCE ASSEMBLING', order: 'The manifest strengthens. Weapons and kit are being prepared.' },
    { label: 'COMBAT EFFECTIVE', order: 'A fighting force stands upon the embarkation deck.' },
    { label: 'DEPLOYMENT PREPARATIONS', order: 'The regiment forms for embarkation.' },
    { label: 'DROP READINESS', order: 'Drop harnesses checked. Awaiting the command vox.' },
    { label: 'ASSAULT READY', order: 'The regiment stands ready to descend. The Emperor protects.' }
];
export function combatReadiness(filled: number, total: number) { const ratio = total > 0 ? Math.max(0, Math.min(1, filled / total)) : 0; const grade = ratio === 0 ? 0 : ratio === 1 ? 7 : Math.min(6, 1 + Math.floor(ratio * 6)); return { ...readinessGrades[grade], grade, ratio }; }
export function formationReadiness(filled: number, total: number) { return filled === 0 ? 'AWAITING ORDERS' : filled >= total ? 'IN POSITION' : filled / total < .5 ? 'FORMING' : 'ASSEMBLING'; }

export const editableRoles = [ 'Vox Operator', 'Medicae', 'AT Specialist', 'Plasma Gunner', 'Melta Gunner', 'Guardsmen'];
export function editableSlot(id: string) { const slot = slots.find(s=>s.id===id); return !!slot && slot.section.startsWith('spear') && !['ic','ic2'].includes(id); }
export function applySlotRoles(roles: Record<string,string>) {
    const types: Record<string,string> = { 'Section Leader':'leader','Vox Operator':'vox','Medicae':'medic','AT Specialist':'at','Plasma Gunner':'plasma','Melta Gunner':'melta','Guardsmen':'trooper' };
    return slots.map(s=> editableSlot(s.id) && (editableRoles.includes(roles[s.id]) || roles[s.id] === 'Section Leader') ? {...s,name:roles[s.id],type:types[roles[s.id]],protected:roles[s.id]==='Section Leader'} : s);
}
export function slotPhraseRole(slot: {id:string;type?:string;phraseRole?:string}) { return slot.phraseRole || (slot.type==='leader' ? 'ic' : phraseRole(slot.id)); }


export type OrbatSlot = { id: string; name: string; code: string; type: string; section: string; protected: boolean; phraseRole: string };
export type OrbatSection = { id: string; name: string; eyebrow: string };
export type OrbatLayout = { sections: OrbatSection[]; slots: OrbatSlot[] };
export type RolePolicy = { enabled: boolean; editScope: 'none' | 'section' | 'all'; canEditRoles: boolean; canEditAssignments: boolean };
export type OrbatTemplate = { id: string; name: string; layout: OrbatLayout; updated: string };
export const slotTypes = ['command','leader','vox','medic','at','plasma','melta','trooper','pilot'];
export function defaultLayout(): OrbatLayout { return {
    sections: [{id:'command',name:'Regimental command',eyebrow:'REGIMENTAL HQ'},{id:'spear1',name:'SPEAR 1',eyebrow:'DROP INFANTRY'},{id:'spear2',name:'SPEAR 2',eyebrow:'DROP INFANTRY'},{id:'shield',name:'SHIELD',eyebrow:'ATTACHED FLIGHT ASSET'}],
    slots: slots.map(s=>({...s,phraseRole:slotPhraseRole(s)}))
}; }
export function defaultRolePolicy(role: string, layout: OrbatLayout): RolePolicy {
    return {enabled:layout.slots.some(s=>s.phraseRole===role && s.protected),editScope:role==='ic'?'all':'none',canEditRoles:role==='ic',canEditAssignments:false};
}
// IDs are stable assignment references. Display names and slot codes are editable.
export function validateLayout(value: unknown): OrbatLayout {
    const v=value as OrbatLayout;
    const validId=(s:unknown)=>typeof s==='string' && /^[a-zA-Z0-9_-]{1,64}$/.test(s) && s!=='admin' && s!=='reserve';
    const text=(s:unknown,max:number)=>typeof s==='string' && s.trim().length>0 && s.length<=max;
    if(!v || !Array.isArray(v.sections) || !Array.isArray(v.slots) || v.sections.length<1 || v.sections.length>30 || v.slots.length<1 || v.slots.length>200) throw new Error('Use 1–30 sections and 1–200 slots.');
    if(v.sections.some(s=>!s || !validId(s.id) || !text(s.name,80) || typeof s.eyebrow!=='string' || s.eyebrow.length>100) || new Set(v.sections.map(s=>s.id)).size!==v.sections.length) throw new Error('Check section names and unique IDs.');
    if(v.slots.some(s=>!s || !validId(s.id) || !validId(s.phraseRole) || !text(s.name,80) || !text(s.code,24) || !slotTypes.includes(s.type) || typeof s.protected!=='boolean' || !v.sections.some(g=>g.id===s.section)) || new Set(v.slots.map(s=>s.id)).size!==v.slots.length) throw new Error('Check slot names, types, sections and unique IDs.');
    return {sections:v.sections.map(s=>({id:s.id,name:s.name.trim(),eyebrow:s.eyebrow.trim()})),slots:v.slots.map(s=>({id:s.id,name:s.name.trim(),code:s.code.trim(),type:s.type,section:s.section,protected:s.protected,phraseRole:s.phraseRole}))};
}

export type SharedKey = { id: string; name: string; updated: string };
export function validRolePolicy(value: unknown): value is RolePolicy {
    const p=value as RolePolicy;
    return !!p && typeof p.enabled==='boolean' && typeof p.canEditRoles==='boolean' && typeof p.canEditAssignments==='boolean' && ['none','section','all'].includes(p.editScope);
}

export const slotRoleOptions = (s:{id:string;section?:string}) => ['gm','ic','ic2'].includes(s.id) ? [] : s.section==='shield' ? ['Pilot','Vox Operator'] : [...editableRoles];
