import { database, runtimeSecret, runtimeOrigin, runtimeClientAddress } from '@/db/raw';
import { slotRoleOptions, canLockSlot, editableRoles, slotTypes, ranks, slotPhraseRole, phraseRole, comparePersonnel, defaultOperationConfig, defaultLayout, validateLayout, defaultRolePolicy, type OrbatLayout, type RolePolicy, validRolePolicy } from '@/lib/regiment';
import { defaultCountdown, localEpoch, type CountdownConfig } from '@/lib/countdown';
import { existsSync } from 'node:fs';
export const dynamic = 'force-dynamic';
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const hash = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))).map(x => x.toString(16).padStart(2, '0')).join('');
const equal = (a: string, b: string) => { let d = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++)
    d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return d === 0; };
async function encode(p: string, salt = crypto.randomUUID()) { const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(p), 'PBKDF2', false, ['deriveBits']); const bytes = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256); return salt + ':' + Array.from(new Uint8Array(bytes)).map(x => x.toString(16).padStart(2, '0')).join(''); }
async function verify(p: string, value: string) { if (!value)
    return false; return equal(await encode(p, value.split(':')[0]), value); }
async function setting(key: string) { return await database().prepare('SELECT value FROM settings WHERE key=?').bind(key).first<{
    value: string;
}>(); }
function cookie(req: Request, token: string, maxAge: number) { const secure = runtimeOrigin().startsWith('https://') || new URL(req.url).protocol === 'https:'; return `regiment_admin=${token}; HttpOnly; ${secure ? 'Secure; ' : ''}SameSite=Lax; Path=/; Max-Age=${maxAge}`; }
function sessionToken(req: Request) { const bearer = req.headers.get('authorization')?.match(/^Bearer ([a-f0-9-]{72})$/i)?.[1]; return bearer || req.headers.get('cookie')?.split(';').map(x => x.trim()).find(x => x.startsWith('regiment_admin='))?.slice(15) || ''; }
async function isAdmin(req: Request) { const token = sessionToken(req); if (!token)
    return false; return !!await database().prepare('SELECT token FROM admin_sessions WHERE token=? AND expires>?').bind(await hash(token), Date.now()).first(); }
function validOrigin(req: Request) { const origin = req.headers.get('origin'); return !origin || origin === (runtimeOrigin() || new URL(req.url).origin); }
async function throttle(req: Request, kind: string) { const bucket = Math.floor(Date.now() / 600000); const key = await hash((runtimeClientAddress(req)) + kind + bucket); await database().prepare('DELETE FROM attempts WHERE expires<?').bind(Date.now()).run(); const a = await database().prepare('INSERT INTO attempts (key,count,expires) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(key, Date.now() + 600000).first<{
    count: number;
}>(); return (a?.count || 0) <= 12; }
function field(v: unknown, max = 200) { return typeof v === 'string' ? v.trim().slice(0, max) : ''; }
const passphrase = (v: unknown) => typeof v === 'string' ? v : '';
function fail(message: string, status = 400) { return json({ error: message }, status); }
async function orbatId() { const db = database(); await db.prepare("INSERT OR IGNORE INTO operations(id,title,date,briefing,status,created) SELECT 'initial-muster','ORBAT','','','open',? WHERE NOT EXISTS(SELECT 1 FROM operations)").bind(new Date().toISOString()).run(); await db.prepare("INSERT OR IGNORE INTO settings(key,value) SELECT 'orbat_id',id FROM operations ORDER BY CASE WHEN status='open' THEN 0 ELSE 1 END,created DESC LIMIT 1").run(); const row = await setting('orbat_id'); return row!.value; }
async function slotRoles() { const rows = await database().prepare("SELECT key,value FROM settings WHERE key LIKE 'slot_role_%'").all<any>(); return Object.fromEntries(rows.results.map(r=>[r.key.slice(10),r.value])); }
async function layoutState() {
    const row = await setting('orbat_layout');
    const state = row ? JSON.parse(row.value) : {revision:0,layout:defaultLayout()};
    const roles = await slotRoles();
    state.layout.slots = state.layout.slots.map((s:any)=>roles[s.id] ? {...s,name:roles[s.id],type:({'Vox Operator':'vox','Medicae':'medic','AT Specialist':'at','Plasma Gunner':'plasma','Melta Gunner':'melta','Stubber':'plasma','Guardsmen':'trooper'} as Record<string,string>)[roles[s.id]] || s.type} : s);
    return state as {revision:number;layout:OrbatLayout};
}
async function rolePolicies(layout: OrbatLayout) {
    const rows = await database().prepare("SELECT key,value FROM settings WHERE key LIKE 'role_policy_%'").all<any>();
    const saved = Object.fromEntries(rows.results.map(r=>[r.key.slice(12),JSON.parse(r.value)]));
    return Object.fromEntries([...new Set(layout.slots.map(s=>s.phraseRole))].map(role=>[role,saved[role] || defaultRolePolicy(role,layout)])) as Record<string,RolePolicy>;
}
async function currentSlots() {
    const {layout}=await layoutState(), policies=await rolePolicies(layout);
    return Promise.all(layout.slots.map(async s=>({...s,protected:policies[s.phraseRole].enabled || (canLockSlot(s) && !!await setting('slot_lock_'+s.id)), locked:(canLockSlot(s) && !!await setting('slot_lock_'+s.id))})));
}
async function delegatedActor(req: Request, b: Record<string,unknown>, target: string, permission: 'canEditRoles'|'canEditAssignments') {
    if(await isAdmin(req)) return 'Administrator';
    if(!await throttle(req,'delegated_edit')) return null;
    const {layout}=await layoutState(), role=field(b.accessRole) || 'ic', policy=(await rolePolicies(layout))[role];
    const slot=layout.slots.find(s=>s.id===target);
    if(role !== 'ic' && (!policy?.enabled || !policy[permission] || policy.editScope==='none')) return null;
    if(role !== 'ic' && policy.editScope==='section' && (!slot || !layout.slots.some(s=>s.phraseRole===role && s.section===slot.section))) return null;
    const saved=await setting('phrase_'+role);
    if(!saved || !await verify(passphrase(b.phrase),saved.value)) return null;
    const named=await database().prepare('SELECT name FROM shared_keys WHERE id=?').bind(role).first<{name:string}>();
    return 'Role clearance / '+(named?.name || role);
}
async function applyLayout(layout: OrbatLayout, revision: unknown, policies: Record<string,RolePolicy> = {}, shared?: {id:string;name:string;encoded:string}, admin = true) {
    const state=await layoutState();
    if(revision!==state.revision) return fail('The layout has changed. Refresh the ORBAT before saving.',409);
    const operation=await orbatId(), db=database();
    // Guard against a concurrent signup in the same transaction as the layout change.
    const ids=layout.slots.map(s=>s.id), placeholders=ids.map(()=>'?').join(',');
    await db.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES ('orbat_layout',?)").bind(JSON.stringify({revision:0,layout:defaultLayout()})).run();
    const result=await db.batch([
        db.prepare(`UPDATE settings SET value=? WHERE key='orbat_layout' AND json_extract(value,'$.revision')=? AND NOT EXISTS(SELECT 1 FROM assignments WHERE operation_id=? AND slot NOT GLOB '*:*' AND slot NOT IN (${placeholders})) AND (?=1 OR COALESCE(json_extract((SELECT value FROM settings WHERE key='operation_config'),'$.locked'),0)=0)`).bind(JSON.stringify({revision:state.revision+1,layout}),state.revision,operation,...ids,admin?1:0),
        // Each write depends on the preceding write succeeding. A stale revision writes nothing.
        ...(shared ? [db.prepare('INSERT INTO shared_keys(id,name,updated) SELECT ?,?,? WHERE changes()>0').bind(shared.id,shared.name,new Date().toISOString()),db.prepare('INSERT INTO settings(key,value) SELECT ?,? WHERE changes()>0 ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('phrase_'+shared.id,shared.encoded)] : []),
        ...Object.entries(policies).map(([role,policy])=>db.prepare('INSERT INTO settings(key,value) SELECT ?,? WHERE changes()>0 ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('role_policy_'+role,JSON.stringify({enabled:policy.enabled,editScope:policy.editScope,canEditRoles:policy.canEditRoles,canEditAssignments:policy.canEditAssignments}))),
        db.prepare("DELETE FROM settings WHERE key LIKE 'slot_role_%' AND changes()>0")
    ]);
    return result[0].meta.changes ? json({ok:true}) : fail('The layout changed while saving. Reload and try again.',409);
}
async function operationConfig() { const row = await setting('operation_config'); return {...defaultOperationConfig,...(row ? JSON.parse(row.value) : {})}; }
const operationAuditSummary = "SELECT id,title,actor,created,hidden,(SELECT count(*) FROM json_each(json_extract(snapshot,'$.assignments')) WHERE json_extract(value,'$.slot') NOT LIKE 'absent:%') AS signup_count,json_array_length(json_extract(snapshot,'$.personnel')) AS personnel_count FROM operation_audits";
export async function GET(req: Request) {
    try {
        const admin = await isAdmin(req);
        const db = database();
        const params = new URL(req.url).searchParams;
        if(params.has('change_log')) {
            if(!admin) return fail('Administrator clearance required.',401);
            const q=field(params.get('q'),100), before=Number(params.get('before') || Number.MAX_SAFE_INTEGER);
            if(!Number.isSafeInteger(before) || before<1) return fail('Invalid log cursor.');
            const page=Number(params.get('page') || 1),size=Number(params.get('size') || 5);
            if(!Number.isSafeInteger(page)||page<1||page>1000000||![5,10,25].includes(size))return fail('Choose a valid page and results size.');
            const filter='id<? AND (ip LIKE ? OR machine_id LIKE ? OR action LIKE ? OR details LIKE ?)';
            const bindings=[before,...Array(4).fill('%'+q+'%')];
            const total=(await db.prepare('SELECT count(*) AS n FROM change_log WHERE '+filter).bind(...bindings).first<any>()).n;
            const records=await db.prepare('SELECT * FROM change_log WHERE '+filter+' ORDER BY id DESC LIMIT ? OFFSET ?').bind(...bindings,size,(page-1)*size).all();
            const people=(await db.prepare('SELECT id,name FROM personnel').all<any>()).results;
            const slots=await currentSlots();
            const operations=(await db.prepare('SELECT id,title FROM operation_audits').all<any>()).results;
            const recordsReadable=records.results.map((row:any)=>{let d:any;try{d=JSON.parse(row.details)}catch{return row}
                const member=people.find(p=>p.id===(d.user || d.id))?.name || d.name || 'A member';
                const slot=slots.find(s=>s.id===d.slot),position=slot?`${slot.name} (${slot.code})`:({reserve:'Attending',tentative:'Tentative',absent:'Absent'} as Record<string,string>)[String(d.slot).split(':')[0]] || 'an earlier slot';
                const title=operations.find(o=>o.id===Number(d.id))?.title || d.title || 'an earlier operation';
                const old:Record<string,string>={claim:`${member} signed up for ${position}.`,withdraw:`${member} withdrew from ${position}.`,register:`Added ${member} to the personnel registry.`,deregister:`Removed ${member} from the personnel registry.`,slot_lock:`${d.enabled===false?'Disabled':'Enabled'} the passphrase lock for ${position}.`,clear_all:`Sealed “${title}” and cleared the manifest.`,operation_config:`Changed the operation configuration to ${d.mode==='open'?'the open manifest':'the main ORBAT'}.`,rename_operation:`Renamed the archived operation to “${d.title || title}”.`,operation_visibility:`${d.hidden?'Hid':'Restored'} “${title}” in the public archive.`};
                if(!d.description && old[row.action])d.description=old[row.action];
                if(!d.description)d.description=({login:'Administrator signed in.',logout:'Administrator signed out.',save_user:`Updated ${member}’s personnel record.`,slot_role:`Changed ${position} to ${d.role || 'a new role'}.`,destroy_orbat:'Cleared the manifest without archiving it.',phrase:'Changed an access passphrase.',reset_phrase:'Reset an access passphrase.',regenerate_phrase:'Generated a new access passphrase.',countdown:'Updated the deployment schedule.',delete_operation_audit:`Deleted “${title}” from the archive.`} as Record<string,string>)[row.action] || 'Updated a regimental record.';
                return {...row,details:JSON.stringify(d)};});
            return json({records:recordsReadable,total,page,size});
        }
        if(params.has('warnings') || params.has('strikes')) {
            if(!admin)return fail('Administrator clearance required.',401);
            const user=field(params.get('user')),page=Number(params.get('page') || 1),size=Number(params.get('size') || 5);
            if(!Number.isSafeInteger(page)||page<1||page>1000000||![5,10,25].includes(size))return fail('Choose a valid page and results size.');
            const total=(await db.prepare('SELECT count(*) AS n FROM personnel_warnings WHERE user_id=? AND removed_at IS NULL').bind(user).first<any>()).n;
            const rows=(await db.prepare('SELECT * FROM personnel_warnings WHERE user_id=? AND removed_at IS NULL ORDER BY created DESC,id DESC LIMIT ? OFFSET ?').bind(user,size,(page-1)*size).all()).results;
            return json({strikes:rows,warnings:rows,total,page,size});
        }
        if(params.has('medals')) {
            const page=Number(params.get('page') || 1),size=Number(params.get('size') || 5),paged=params.has('page');
            if(!Number.isSafeInteger(page)||page<1||page>1000000||![5,10,25].includes(size))return fail('Choose a valid page and results size.');
            const user=field(params.get('user')),q=field(params.get('q'),100);
            const where=`WHERE ${admin?'1=1':"a.revoked_at IS NULL AND (a.operation_id IS NULL OR o.hidden=0)"} AND (?='' OR a.user_id=?) AND (m.name LIKE ? OR p.name LIKE ? OR COALESCE(o.title,'Outside an operation') LIKE ?)`;
            const bindings=[user,user,...Array(3).fill('%'+q+'%')];
            const from=' FROM medal_awards a JOIN medals m ON m.id=a.medal_id JOIN personnel p ON p.id=a.user_id LEFT JOIN operation_audits o ON o.id=a.operation_id ';
            const total=(await db.prepare('SELECT count(*) AS n'+from+where).bind(...bindings).first<any>()).n;
            const awards=await db.prepare('SELECT a.id,a.user_id,a.operation_id,a.comment,a.revoked_at,p.name AS member_name,COALESCE(o.created,a.created) AS awarded_at,a.created,m.id AS medal_id,m.name,m.description,o.title AS operation_title'+from+where+' ORDER BY a.created DESC,a.id'+(paged?' LIMIT ? OFFSET ?':'')).bind(...bindings,...(paged?[size,(page-1)*size]:[])).all();
            return json({medals:(await db.prepare('SELECT * FROM medals WHERE retired_at IS NULL ORDER BY name COLLATE NOCASE').all()).results,awards:awards.results,total,page,size});
        }
        if (params.has('personnel_history')) {
            const rows = await db.prepare('SELECT id,title,created,snapshot FROM operation_audits WHERE hidden=0 ORDER BY created DESC,id DESC').all<any>();
            const histories: Record<string,any[]> = {};
            for (const row of rows.results) {
                const snap = JSON.parse(row.snapshot);
                for (const a of snap.assignments) {
                    const person = snap.personnel.find((p:any)=>p.id===a.user_id);
                    (histories[a.user_id] ||= []).push({ id:row.id,title:row.title,created:row.created,status:person?.status || 'active',role:snap.roles.find((r:any)=>r.id===a.slot)?.name || ({reserve:'Reserve',tentative:'Tentative',absent:'Absent'} as Record<string,string>)[a.slot.split(':')[0]] || 'Personnel manifest' });
                }
            }
            return json({histories});
        }
        if (params.has('public_archive')) {
            const id = Number(params.get('public_archive'));
            if (params.get('public_archive') === 'list') {
                const before = Number(params.get('before') || Number.MAX_SAFE_INTEGER);
                if (!Number.isSafeInteger(before) || before < 1) return fail('Invalid archive cursor.');
                return json({ operations: (await db.prepare(operationAuditSummary + ' WHERE hidden=0 AND id<? ORDER BY id DESC LIMIT 20').bind(before).all()).results });
            }
            if (!Number.isSafeInteger(id) || id < 1) return fail('Invalid operation reference.');
            const row = await db.prepare('SELECT id,title,created,snapshot FROM operation_audits WHERE hidden=0 AND id=?').bind(id).first<any>();
            if (!row) return fail('Operation not found.', 404);
            return json({ ...row, snapshot: {...JSON.parse(row.snapshot),medalAwards:(await db.prepare('SELECT a.user_id,m.name,m.description FROM medal_awards a JOIN medals m ON m.id=a.medal_id WHERE a.operation_id=? AND a.revoked_at IS NULL').bind(row.id).all()).results} });
        }
        if (params.has('ledger_days')) {
            const days = Number(params.get('ledger_days'));
            if (!Number.isInteger(days) || days < 1 || days > 3660) return fail('Choose a range from 1 to 3660 days.');
            const cutoff = new Date(Date.now() - days * 86400000).toISOString();
            const rows = await db.prepare('SELECT id,title,created,snapshot FROM operation_audits WHERE hidden=0 AND created>=? ORDER BY created DESC,id DESC').bind(cutoff).all<any>();
            const members = new Map<string, any>();
            const current = (await db.prepare('SELECT id,name,rank,status FROM personnel').all<any>()).results;
            const currentById = new Map(current.map(p=>[p.id,p]));
            for (const row of rows.results) {
                const snap = JSON.parse(row.snapshot);
                for (const id of new Set<string>(snap.assignments.map((a: any) => a.user_id))) {
                    const p = snap.personnel.find((p: any) => p.id === id);
                    if (!p || currentById.get(id)?.status==='inactive' || p.status !== 'active' || snap.assignments.some((a:any)=>a.user_id===id && /^(tentative|absent):/.test(a.slot))) continue;
                    const prior = members.get(id);
                    if (prior) prior.operations++;
                    else members.set(id, { id, name: currentById.get(id)?.name || p.name, rank: currentById.get(id)?.rank || p.rank, status:currentById.get(id)?.status || p.status, operations: 1, lastOperationId:row.id, lastOperation: row.title, lastSeen: row.created });
                }
            }
            return json({ days, members: [...members.values()].sort(comparePersonnel), allMembers: current.filter(p=>p.status!=='inactive').sort(comparePersonnel) });
        }
        if (params.has('operation_audit') || params.has('operations_before')) {
            if (!admin)
                return fail('Administrator clearance required.', 401);
            const detail = params.has('operation_audit'), id = Number(params.get(detail ? 'operation_audit' : 'operations_before'));
            if (!Number.isSafeInteger(id) || id < 1)
                return fail('Invalid operation audit reference.');
            if (detail) {
                const row = await db.prepare('SELECT * FROM operation_audits WHERE id=?').bind(id).first<{
                    id: number;
                    title: string;
                    actor: string;
                    created: string;
                    snapshot: string;
                }>();
                if (!row)
                    return fail('Operation audit not found.', 404);
                return json({ ...row, snapshot: {...JSON.parse(row.snapshot),medalAwards:(await db.prepare('SELECT a.user_id,m.name,m.description FROM medal_awards a JOIN medals m ON m.id=a.medal_id WHERE a.operation_id=? AND a.revoked_at IS NULL').bind(row.id).all()).results} });
            }
            const rows = await db.prepare(operationAuditSummary + ' WHERE id<? ORDER BY id DESC LIMIT 20').bind(id).all();
            return json({ operationAudits: rows.results });
        }
        const cursor = Number(new URL(req.url).searchParams.get('audit_before'));
        if (cursor) {
            if (!admin)
                return fail('Administrator clearance required.', 401);
            if (!Number.isSafeInteger(cursor) || cursor < 1)
                return fail('Invalid audit cursor.');
            const rows = await db.prepare('SELECT a.*,o.title AS operation_title FROM audit_log a JOIN operations o ON o.id=a.operation_id WHERE a.id<? ORDER BY a.id DESC LIMIT 50').bind(cursor).all();
            return json({ audit: rows.results });
        }
        const rosterId = await orbatId();
        await db.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES ('countdown',?)").bind(JSON.stringify(defaultCountdown())).run();
        const configuration = await operationConfig();
        const countdown = JSON.parse((await setting('countdown'))!.value) as CountdownConfig;
        if (process.env.ORBAT_DISABLE_AUTO_RENEW === 'true') countdown.autoRenew = false;
        const [users, ops, asgn, protectedKeys, audit, operationAudits] = await Promise.all([db.prepare(admin ? 'SELECT * FROM personnel ORDER BY name COLLATE NOCASE' : 'SELECT id,name,rank,status FROM personnel ORDER BY name COLLATE NOCASE').all(), db.prepare("SELECT id,'ORBAT' AS title,'' AS date,'open' AS status,created FROM operations WHERE id=?").bind(rosterId).all(), db.prepare('SELECT operation_id,slot,user_id,created FROM assignments WHERE operation_id=?').bind(rosterId).all(), db.prepare("SELECT key FROM settings WHERE key LIKE 'phrase_%'").all(), admin ? db.prepare('SELECT a.*,o.title AS operation_title FROM audit_log a JOIN operations o ON o.id=a.operation_id ORDER BY a.id DESC LIMIT 50').all() : Promise.resolve({ results: [] }), admin ? db.prepare(operationAuditSummary + ' ORDER BY id DESC LIMIT 20').all() : Promise.resolve({ results: [] })]);
        const state=await layoutState();

        const medalRows=await db.prepare('SELECT a.user_id,count(*) AS n FROM medal_awards a LEFT JOIN operation_audits o ON o.id=a.operation_id WHERE a.revoked_at IS NULL AND (a.operation_id IS NULL OR o.hidden=0) GROUP BY a.user_id').all<any>();
        const medalCounts=new Map(medalRows.results.map(r=>[r.user_id,r.n]));
        const sharedKeys=(await db.prepare('SELECT id,name,updated FROM shared_keys ORDER BY name COLLATE NOCASE').all()).results;
        return json({ sharedKeys, layout:state.layout, layoutRevision:state.revision, rolePolicies:await rolePolicies(state.layout), templates:[], slotLocks:Object.fromEntries((await db.prepare("SELECT key FROM settings WHERE key LIKE 'slot_lock_%'").all<any>()).results.filter(r=>state.layout.slots.some(s=>s.id===r.key.slice(10)&&canLockSlot(s))).map(r=>[r.key.slice(10),true])), operationAudits: operationAudits.results, slotRoles: Object.fromEntries(state.layout.slots.map(s=>[s.id,s.name])), configuration, countdown, serverNow: Date.now(), users: (users.results as any[]).map(p=>({...p,medal_count:medalCounts.get(p.id) || 0})).sort(comparePersonnel), operations: ops.results, assignments: asgn.results, admin, audit: audit.results, configuredRoles: protectedKeys.results.map((r: any) => r.key.replace('phrase_', '')) });
    }
    catch (e) {
        console.error(e);
        return fail('The regimental archive is unavailable. Try again shortly.', 503);
    }
}
async function handlePost(req: Request) {
    try {
        if (!validOrigin(req))
            return fail('Request origin rejected.', 403);
        if (process.env.ORBAT_DEPLOYMENT_GUARD && existsSync(process.env.ORBAT_DEPLOYMENT_GUARD))
            return fail('Deployment in progress. Please try again shortly.', 503);
        const b = await req.json() as Record<string, unknown>;
        const action = field(b.action);
        const db = database();
        if (action === 'login') {
            if (!await throttle(req, 'login'))
                return fail('Too many attempts. Try again in ten minutes.', 429);
            const key = passphrase(b.key);
            const saved = await setting('admin_password');
            const allowed = saved ? await verify(key, saved.value) : !!runtimeSecret() && equal(await hash(key), await hash(runtimeSecret()));
            if (!allowed)
                return fail('Access key not recognised.', 401);
            const token = crypto.randomUUID() + crypto.randomUUID();
            await db.prepare('DELETE FROM admin_sessions WHERE expires<?').bind(Date.now()).run();
            await db.prepare('INSERT INTO admin_sessions(token,expires) VALUES (?,?)').bind(await hash(token), Date.now() + 8 * 3600000).run();
            return new Response(JSON.stringify({ ok: true, sessionToken: token }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Set-Cookie': cookie(req, token, 28800) } });
        }
        if (action === 'logout') {
            const token = sessionToken(req);
            if (token)
                await db.prepare('DELETE FROM admin_sessions WHERE token=?').bind(await hash(token)).run();
            return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Set-Cookie': cookie(req, '', 0) } });
        }
        const admin=await isAdmin(req);
        if(!admin && ['claim','withdraw','slot_role','slot_lock','edit_assignment','release'].includes(action) && (await operationConfig()).locked) return fail('The ORBAT is locked. Only administrators can edit it.',423);
        if (action === 'register') {
            if (!await isAdmin(req))
                return fail('Only administrators may create personnel records.', 401);
            const name = field(b.name, 60), steam = field(b.steam_id, 30), discord = field(b.discord_id, 30);
            if (name.length < 2)
                return fail('Enter a name of at least two characters.');
            if (steam && !/^7656119\d{10}$/.test(steam))
                return fail('Enter a valid 17-digit SteamID64.');
            if (discord && !/^\d{17,20}$/.test(discord))
                return fail('Discord ID must contain 17–20 digits.');
            const id = crypto.randomUUID();
            await db.prepare("INSERT INTO personnel(id,name,steam_id,discord_id,rank,enlisted,status) VALUES (?,?,?,?,?,?,?)").bind(id, name, steam, discord, ranks.includes(field(b.rank)) ? field(b.rank) : 'Recruit', /^\d{4}-\d{2}-\d{2}$/.test(field(b.enlisted)) ? field(b.enlisted) : new Date().toISOString().slice(0, 10), ['active', 'retired', 'inactive', 'absent'].includes(field(b.status)) ? field(b.status) : 'active').run();
            return json({ ok: true, id });
        }
        if(['edit_assignment','release'].includes(action)) return fail('Withdraw the current member before signing up a replacement.',410);
        if (['save_layout','save_formation','save_template','delete_template','apply_template','create_shared_key'].includes(action)) return fail('The formation editor has been removed.',410);
        if (action === 'slot_lock') {
            const id=field(b.slot);
            const target=(await currentSlots()).find(s=>s.id===id);
            if(!target) return fail('Invalid slot.');
            if(!canLockSlot(target)) return fail('Temporary locks are unavailable for command, section leader and pilot slots.',403);
            if(!await delegatedActor(req,{...b,accessRole:'ic'},id,'canEditRoles')) return fail('SL passphrase or administrator access required.',403);
            const locked=!!await setting('slot_lock_'+id);
            if(typeof b.expectedLocked==='boolean' && b.expectedLocked!==locked)return fail('The slot lock changed. Refresh and try again.',409);
            if(b.enabled===false) {
                const result=await db.prepare("DELETE FROM settings WHERE key=? AND (?=1 OR COALESCE(json_extract((SELECT value FROM settings WHERE key='operation_config'),'$.locked'),0)=0)").bind('slot_lock_'+id,admin?1:0).run();
                if(!admin && !result.meta.changes && (await operationConfig()).locked)return fail('The ORBAT is locked. Only administrators can edit it.',423);
            }
            else {
                const key=passphrase(b.lockPhrase);
                if(!key || key.length>200) return fail('Enter a slot passphrase of 1–200 characters.');
                const result=await db.prepare("INSERT INTO settings(key,value) SELECT ?,? WHERE (?=1 OR COALESCE(json_extract((SELECT value FROM settings WHERE key='operation_config'),'$.locked'),0)=0) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind('slot_lock_'+id,await encode(key),admin?1:0).run();
                if(!result.meta.changes)return fail('The ORBAT is locked. Only administrators can edit it.',423);
            }
            return json({ok:true});
        }
        if (action === 'slot_role') {
            const id = field(b.slot), role = field(b.role,80);
            const target=(await currentSlots()).find(s=>s.id===id);
            if (!target || !slotRoleOptions(target).includes(role)) return fail('Choose a current slot and a role name.');
            const actor=await delegatedActor(req,{...b,accessRole:'ic'},id,'canEditRoles');
            if(!actor) return fail('A role passphrase with permission to edit this slot is required.',403);
            if ((await operationConfig()).mode !== 'main') return fail('Slot roles are only available on the main ORBAT.');
            const state=await layoutState();
            const type=({'Vox Operator':'vox','Medicae':'medic','AT Specialist':'at','Plasma Gunner':'plasma','Melta Gunner':'melta','Stubber':'plasma','Guardsmen':'trooper','Section Leader':'leader','Gamemaster':'command','Pilot':'pilot'} as Record<string,string>)[role];
            return await applyLayout({...state.layout,slots:state.layout.slots.map(s=>s.id===id?{...s,name:role,type:type || s.type}:s)},state.revision,{},undefined,admin);
        }
        if (action === 'claim') {
            if (!await throttle(req, 'claim'))
                return fail('Too many signup attempts. Try again in ten minutes.', 429);
            const slot = ['reserve','tentative','absent'].includes(String(b.slot)) ? { id: String(b.slot)+':' + crypto.randomUUID(), protected: false } : (await currentSlots()).find(s => s.id === b.slot);
            if (!slot)
                return fail('Invalid role.');
            if ((await operationConfig()).mode === 'open' && !['reserve','tentative','absent'].includes(String(b.slot))) return fail('This operation uses the open personnel manifest.');
            if (slot.protected && !await isAdmin(req)) {
                const saved = (canLockSlot(slot) ? await setting('slot_lock_'+slot.id) : null) || await setting('phrase_' + slotPhraseRole(slot));
                if (!saved)
                    return fail('This command role is awaiting administrator clearance.', 403);
                if (!await verify(passphrase(b.phrase), saved.value))
                    return fail('The passphrase for this role is incorrect.', 403);
            }
            const operation = await orbatId(), user = field(b.user), time = new Date().toISOString();
            const withdrawalToken = crypto.randomUUID() + crypto.randomUUID();
            const withdrawalHash = await hash(withdrawalToken);
            const actor = await isAdmin(req) ? 'Administrator' : 'Public signup';
            const results = await db.batch([
                db.prepare("INSERT INTO assignments(operation_id,slot,user_id,created,withdrawal_hash) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM operations WHERE id=?) AND EXISTS(SELECT 1 FROM personnel WHERE id=? AND status='active') AND (COALESCE(json_extract((SELECT value FROM settings WHERE key='operation_config'),'$.mode'),'main')='main' OR ? GLOB '*:*') AND (? GLOB '*:*' OR EXISTS(SELECT 1 FROM json_each(COALESCE((SELECT json_extract(value,'$.layout.slots') FROM settings WHERE key='orbat_layout'),?)) WHERE json_extract(value,'$.id')=?)) AND (?=1 OR COALESCE(json_extract((SELECT value FROM settings WHERE key='operation_config'),'$.locked'),0)=0)").bind(operation, slot.id, user, time, withdrawalHash, operation, user, slot.id, slot.id, JSON.stringify(defaultLayout().slots), slot.id,admin?1:0),
                db.prepare("INSERT INTO audit_log(operation_id,slot,event,before_name,after_name,actor,created) SELECT a.operation_id,a.slot,'filled','',p.name,?,? FROM assignments a JOIN personnel p ON p.id=a.user_id WHERE a.operation_id=? AND a.slot=? AND a.user_id=? AND a.created=?").bind(actor, time, operation, slot.id, user, time)
            ]);
            if (!results[0].meta.changes)
                return fail('Select an active member and the ORBAT.');
            return json({ ok: true, slot: slot.id, withdrawalToken });
        }
        if (action === 'withdraw') {
            if (!await throttle(req, 'withdraw'))
                return fail('Too many withdrawal attempts. Try again in ten minutes.', 429);
            const operation = await orbatId(), slot = field(b.slot), expected = field(b.expected), created = field(b.created), time = new Date().toISOString();
            const role = (await currentSlots()).find(s => s.id === slot);
            if (!role && ! /^(reserve|tentative|absent):/.test(slot))
                return fail('Invalid role.');
            if (role?.protected && !await isAdmin(req)) {
                const saved = (canLockSlot(role) ? await setting('slot_lock_'+role.id) : null) || await setting('phrase_' + slotPhraseRole(role));
                if (!saved || !await verify(passphrase(b.phrase), saved.value))
                    return fail('The current passphrase for this role is required to withdraw.', 403);
            }
            if (!expected || !created)
                return fail('Refresh the ORBAT before withdrawing.', 409);
            const results = await db.batch([
                db.prepare("INSERT INTO audit_log(operation_id,slot,event,before_name,after_name,actor,created) SELECT a.operation_id,a.slot,'cleared',p.name,'','Public withdrawal',? FROM assignments a JOIN personnel p ON p.id=a.user_id WHERE a.operation_id=? AND a.slot=? AND a.user_id=? AND a.created=? AND (?=1 OR COALESCE(json_extract((SELECT value FROM settings WHERE key='operation_config'),'$.locked'),0)=0)").bind(time, operation, slot, expected, created,admin?1:0),
                db.prepare("DELETE FROM assignments WHERE operation_id=? AND slot=? AND user_id=? AND created=? AND (?=1 OR COALESCE(json_extract((SELECT value FROM settings WHERE key='operation_config'),'$.locked'),0)=0)").bind(operation, slot, expected, created,admin?1:0),
                db.prepare('DELETE FROM assignment_role_memory WHERE operation_id=? AND user_id=? AND NOT EXISTS(SELECT 1 FROM assignments WHERE operation_id=? AND user_id=?)').bind(operation,expected,operation,expected)
            ]);
            if (!results[1].meta.changes)
                return fail('This assignment has changed. Refresh the ORBAT and try again.', 409);
            return json({ ok: true });
        }
        let assignmentActor='Administrator';
        if (action==='release' || action==='edit_assignment') {
            const actor=await delegatedActor(req,b,field(b.slot),'canEditAssignments');
            if(!actor) return fail('A role passphrase with permission to edit this assignment is required.',403);
            assignmentActor=actor;
            const target=field(b.slot);
            if(!(await currentSlots()).some(s=>s.id===target) && ! /^(reserve|tentative|absent):/.test(target)) return fail('Invalid role.');
        } else if (!await isAdmin(req)) return fail('Administrator clearance required.', 401);
        if(action==='add_warning' || action==='add_strike') {
            const user=field(b.user),kind='strike',reason=field(b.reason,1000);
            if(!reason||!await db.prepare('SELECT id FROM personnel WHERE id=?').bind(user).first())return fail('Select a member, warning type and reason.');
            const id=crypto.randomUUID();await db.prepare('INSERT INTO personnel_warnings(id,user_id,kind,reason,created) VALUES (?,?,?,?,?)').bind(id,user,kind,reason,new Date().toISOString()).run();return json({ok:true,id});
        }
        if(action==='remove_strike') {
            const result=await db.prepare('UPDATE personnel_warnings SET removed_at=? WHERE id=? AND user_id=? AND removed_at IS NULL').bind(new Date().toISOString(),field(b.id),field(b.user)).run();
            return result.meta.changes?json({ok:true}):fail('This strike was already removed or does not belong to this member.',409);
        }
        if(action==='correct_operation_membership') {
            const id=b.id,user=field(b.user),slot=field(b.slot),reason=field(b.reason,1000);
            if(!Number.isSafeInteger(id) || Number(id)<1)return fail('Invalid operation reference.');
            if(!user || !slot || !reason)return fail('Select a member, their historical position and a correction reason.');
            if(b.historicalStatus!==undefined)return fail('The service status recorded for a sealed operation cannot be changed.');
            const row=await db.prepare('SELECT title,created,snapshot FROM operation_audits WHERE id=?').bind(id).first<any>();
            if(!row)return fail('Sealed operation not found.',404);
            const snap=JSON.parse(row.snapshot), existing=snap.personnel.find((p:any)=>p.id===user);
            const current=await db.prepare('SELECT id,name,rank,status FROM personnel WHERE id=?').bind(user).first<any>();
            if(!existing && !current)return fail('Personnel record not found.',404);
            const previous=snap.assignments.filter((a:any)=>a.user_id===user);
            if(Object.prototype.hasOwnProperty.call(b,'expectedAssignment')) {
                if(b.expectedAssignment!==null && typeof b.expectedAssignment!=='string')return fail('Invalid historical assignment reference.');
                if((previous[0]?.slot ?? null)!==b.expectedAssignment)return fail('This member’s historical assignment changed. Refresh the preview before correcting it.',409);
            }
            if(['tentative','unassigned'].includes(slot))return fail('Sealed operations allow only a role, reserve / attending or absent.');
            const dispositions=['reserve','absent'];
            const target=dispositions.includes(slot) ? slot+':'+user : slot;
            if(!dispositions.includes(slot) && !(snap.roles || []).some((r:any)=>r.id===slot))return fail('Select an archived role or attendance disposition.');
            if(snap.assignments.some((a:any)=>a.slot===target && a.user_id!==user))return fail('This historical position is already occupied.',409);
            if(existing && previous.length<2 && (previous[0]?.slot ?? null)===target)return fail('Choose a different assignment or attendance disposition.',409);
            if(!existing)snap.personnel.push({...current});
            snap.assignments=snap.assignments.filter((a:any)=>a.user_id!==user);
            if(target!==null)snap.assignments.push({...previous[0],slot:target,user_id:user,created:previous[0]?.created || row.created});
            // Reasons stay in the administrator audit log. Compare-and-swap prevents lost edits to the sealed content.
            const result=await db.prepare('UPDATE operation_audits SET snapshot=? WHERE id=? AND snapshot=?').bind(JSON.stringify(snap),id,row.snapshot).run();
            if(!result.meta.changes)return fail('This operation changed while saving. Reload it and try again.',409);
            const positionLabel=(value:string|null)=>{const role=(snap.roles || []).find((r:any)=>r.id===value);return role ? role.name+(role.code?' ('+role.code+')':'') : ({reserve:'Attending / reserve',tentative:'Tentative',absent:'Absent'} as Record<string,string>)[value?.split(':')[0] || ''] || 'Unassigned';};
            return json({ok:true,previousAssignment:previous[0]?.slot ?? null,assignment:target,memberName:(existing || current).name,previousAssignmentLabel:positionLabel(previous[0]?.slot ?? null),assignmentLabel:positionLabel(target),operationTitle:row.title});
        }
        if(action==='revoke_medal') {
            const result=await db.prepare('UPDATE medal_awards SET revoked_at=? WHERE id=? AND revoked_at IS NULL').bind(new Date().toISOString(),field(b.id)).run();
            return result.meta.changes?json({ok:true}):fail('This award was already revoked or no longer exists.',409);
        }
        if(action==='update_medal') {
            const id=field(b.id),name=field(b.name,80),description=field(b.description,1000);
            if(!name || !description)return fail('Enter a medal name and description.');
            const result=await db.prepare('UPDATE medals SET name=?,description=? WHERE id=? AND retired_at IS NULL').bind(name,description,id).run();
            return result.meta.changes ? json({ok:true}) : fail('Medal type not found.',404);
        }
        if(action==='delete_medal') {
            const result=await db.prepare('UPDATE medals SET retired_at=? WHERE id=? AND retired_at IS NULL').bind(new Date().toISOString(),field(b.id)).run();
            return result.meta.changes ? json({ok:true}) : fail('Medal type not found.',404);
        }
        if(action==='create_medal') {
            const name=field(b.name,80),description=field(b.description,1000);
            if(!name || !description)return fail('Enter a medal name and description.');
            const id=crypto.randomUUID();await db.prepare('INSERT INTO medals(id,name,description,created) VALUES (?,?,?,?)').bind(id,name,description,new Date().toISOString()).run();return json({ok:true,id});
        }
        if(action==='award_medal') {
            const medal=field(b.medal),user=field(b.user),operation=b.operation===null || b.operation===undefined || b.operation==='' ? null : Number(b.operation);
            if((operation!==null && !Number.isSafeInteger(operation)) || !await db.prepare('SELECT id FROM medals WHERE id=? AND retired_at IS NULL').bind(medal).first() || !await db.prepare('SELECT id FROM personnel WHERE id=?').bind(user).first() || (operation!==null && !await db.prepare('SELECT id FROM operation_audits WHERE id=?').bind(operation).first()))return fail('Select a medal, member and archived operation.');
            if(operation!==null && await db.prepare('SELECT id FROM medal_awards WHERE medal_id=? AND user_id=? AND operation_id=? AND revoked_at IS NULL').bind(medal,user,operation).first())return fail('This member already received this medal for this operation.',409);
            const id=crypto.randomUUID();const awardResult=await db.prepare('INSERT OR IGNORE INTO medal_awards(id,medal_id,user_id,operation_id,created,comment) VALUES (?,?,?,?,?,?)').bind(id,medal,user,operation,new Date().toISOString(),field(b.comment,1000)).run();if(!awardResult.meta.changes)return fail('This member already received this medal for this operation.',409);return json({ok:true,id});
        }
        if (action === 'operation_config') {
            const title = (await operationConfig()).title, mode = b.mode;
            if (!title || !['main', 'open'].includes(String(mode))) return fail('Enter a title and choose an ORBAT layout.');
            if(b.locked!==undefined && typeof b.locked!=='boolean')return fail('Choose a valid ORBAT lock setting.');
            const prior = await operationConfig(), operation = await orbatId();
            if(b.resetLayout===true) {
                if(mode!=='main') return fail('Choose the main ORBAT to restore its default layout.');
                if(b.confirmedLayout!==true) return fail('Confirm the layout reset. Members whose slots are removed will move to Attending.',409);
                await db.batch([
                    db.prepare(`UPDATE assignments SET slot='reserve:' || user_id WHERE operation_id=? AND slot NOT GLOB '*:*' AND slot NOT IN (${defaultLayout().slots.map(()=>'?').join(',')})`).bind(operation,...defaultLayout().slots.map(s=>s.id)),
                    db.prepare("INSERT INTO settings(key,value) VALUES ('orbat_layout',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify({revision:(await layoutState()).revision+1,layout:defaultLayout()})),
                    db.prepare("DELETE FROM settings WHERE key LIKE 'slot_role_%' OR key LIKE 'role_policy_%' OR key LIKE 'slot_lock_%'"),
                    db.prepare('DELETE FROM assignment_role_memory WHERE operation_id=?').bind(operation)
                ]);
            }
            const ids=(await layoutState()).layout.slots.map(s=>s.id), placeholders=ids.map(()=>'?').join(',');
            await db.batch([
                ...(prior.mode==='main' && mode==='open' ? [
                    db.prepare("INSERT INTO assignment_role_memory(operation_id,user_id,slot) SELECT operation_id,user_id,slot FROM assignments WHERE operation_id=? AND slot NOT GLOB '*:*' ON CONFLICT(operation_id,user_id) DO UPDATE SET slot=excluded.slot").bind(operation),
                    db.prepare("UPDATE assignments SET slot='reserve:' || user_id WHERE operation_id=? AND slot NOT GLOB '*:*'").bind(operation)
                ] : []),
                ...(prior.mode==='open' && mode==='main' ? [
                    db.prepare(`UPDATE assignments AS a SET slot=(SELECT m.slot FROM assignment_role_memory m WHERE m.operation_id=a.operation_id AND m.user_id=a.user_id) WHERE a.operation_id=? AND a.slot LIKE 'reserve:%' AND EXISTS(SELECT 1 FROM assignment_role_memory m WHERE m.operation_id=a.operation_id AND m.user_id=a.user_id AND m.slot IN (${placeholders}) AND NOT EXISTS(SELECT 1 FROM assignments other WHERE other.operation_id=a.operation_id AND other.slot=m.slot))`).bind(operation,...ids)
                ] : []),
                db.prepare("INSERT INTO settings(key,value) VALUES ('operation_config',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify({title,mode,locked:b.locked ?? prior.locked}))
            ]);
            return json({ok:true});
        }
        if (action === 'countdown') {
            const config = b.config as CountdownConfig;
            if (!config || typeof config.localStart !== 'string' || typeof config.timeZone !== 'string' || typeof config.autoRenew !== 'boolean')
                return fail('Check the countdown settings.');
            try {
                localEpoch(config.localStart, config.timeZone);
            }
            catch (e) {
                return fail((e as Error).message);
            }
            await db.prepare("INSERT INTO settings(key,value) VALUES ('countdown',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify({ localStart: config.localStart, timeZone: config.timeZone, autoRenew: process.env.ORBAT_DISABLE_AUTO_RENEW === 'true' ? false : config.autoRenew })).run();
            return json({ ok: true });
        }
        if(action==='rename_operation' || action==='operation_visibility') {
            const id=Number(b.id);
            if(!Number.isSafeInteger(id) || id<1) return fail('Invalid operation reference.');
            let result;
            if(action==='rename_operation') {
                const title=field(b.title,100);
                if(!title) return fail('Enter an operation name.');
                result=await db.prepare('UPDATE operation_audits SET title=? WHERE id=?').bind(title,id).run();
            } else {
                if(typeof b.hidden!=='boolean') return fail('Choose an archive visibility.');
                result=await db.prepare('UPDATE operation_audits SET hidden=? WHERE id=?').bind(b.hidden?1:0,id).run();
            }
            return result.meta.changes?json({ok:true}):fail('Operation not found.',404);
        }
        if (action === 'delete_operation_audit') {
            const id = b.id;
            if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1)
                return fail('Invalid operation reference.');
            const result = await db.prepare('DELETE FROM operation_audits WHERE id=?').bind(id).run();
            if (!result.meta.changes)
                return fail('This sealed operation has already been expunged.', 404);
            return json({ ok: true });
        }
        if (action === 'clear_all' || action === 'destroy_orbat') {
            if(b.confirmed!==true) return fail('Confirm the sealing checkbox before continuing.');
            const operation = await orbatId(), time = new Date().toISOString(), configuration = await operationConfig(), title = field(b.title, 100) || configuration.title;
            const dispositions=(await db.prepare("SELECT slot,user_id,created FROM assignments WHERE operation_id=? AND (slot LIKE 'reserve:%' OR slot LIKE 'tentative:%' OR slot LIKE 'absent:%') ORDER BY slot").bind(operation).all<any>()).results;
            if(dispositions.length && JSON.stringify(b.confirmedDispositions)!==JSON.stringify(dispositions)) return fail('Review and confirm the current reserve, tentative and absent members before sealing.',409);
            const tentative=dispositions.filter(a=>a.slot.startsWith('tentative:'));
            const attendance=b.tentativeAttendance as Record<string,boolean>;
            if(action==='clear_all' && tentative.some(a=>!attendance || typeof attendance[a.user_id]!=='boolean')) return fail('Confirm attendance for each tentative member.',400);
            // Capture current records inside the same transaction as clearing the ORBAT.
            // No private identifiers or OAuth references enter the permanent snapshot.
            await db.batch([
                ...(action === 'destroy_orbat' ? [] : [db.prepare("INSERT INTO operation_audits(title,actor,created,snapshot) SELECT ?,'Administrator',?,json_object('version',3,'sections',json(?),'configuration',json(COALESCE((SELECT value FROM settings WHERE key='operation_config'),'{\"title\":\"Regimental operation\",\"mode\":\"main\"}')),'roles',json(?),'personnel',json((SELECT json_group_array(json_object('id',id,'name',name,'rank',rank,'status',status)) FROM (SELECT id,name,rank,status FROM personnel ORDER BY name COLLATE NOCASE))),'assignments',json((SELECT json_group_array(json_object('slot',slot,'user_id',user_id,'created',created)) FROM (SELECT CASE WHEN slot LIKE 'tentative:%' THEN CASE WHEN json_extract(?, '$.' || user_id)=1 THEN 'reserve:' || user_id ELSE 'absent:' || user_id END ELSE slot END AS slot,user_id,created FROM assignments WHERE operation_id=? UNION ALL SELECT 'absent:' || id,id,? FROM personnel WHERE NOT EXISTS(SELECT 1 FROM assignments WHERE operation_id=? AND user_id=personnel.id) ORDER BY slot))),'countdown',json(COALESCE((SELECT value FROM settings WHERE key='countdown'),'null')))").bind(title, time, JSON.stringify((await layoutState()).layout.sections), JSON.stringify((configuration.mode === 'open' ? [] : await currentSlots()).map(s => ({ id: s.id, name: s.name, code: s.code, section: s.section }))), JSON.stringify(attendance || {}), operation, time, operation)]),
                db.prepare("INSERT INTO audit_log(operation_id,slot,event,before_name,after_name,actor,created) SELECT a.operation_id,a.slot,'cleared',p.name,'','Administrator / operation audit and reset',? FROM assignments a JOIN personnel p ON p.id=a.user_id WHERE a.operation_id=?").bind(time, operation),
                db.prepare('DELETE FROM assignments WHERE operation_id=?').bind(operation),
                db.prepare("DELETE FROM settings WHERE key LIKE 'slot_lock_%'"),
                db.prepare('DELETE FROM assignment_role_memory WHERE operation_id=?').bind(operation)
            ]);
            return json({ ok: true });
        }
        if (action === 'deregister') {
            const id = field(b.id);
            const person = await db.prepare('SELECT name FROM personnel WHERE id=?').bind(id).first<{
                name: string;
            }>();
            if (!person)
                return fail('This personnel record has already been removed.', 404);
            await db.batch([db.prepare("INSERT INTO audit_log(operation_id,slot,event,before_name,after_name,actor,created) SELECT operation_id,slot,'cleared',?,'','Administrator / personnel deregistration',? FROM assignments WHERE user_id=?").bind(person.name, new Date().toISOString(), id), db.prepare('DELETE FROM assignments WHERE user_id=?').bind(id), db.prepare('DELETE FROM personnel WHERE id=?').bind(id)]);
            return json({ ok: true });
        }
        if (action === 'save_user') {
            const id = field(b.id), name = field(b.name, 60), rank = field(b.rank, 40), status = field(b.status), enlisted = field(b.enlisted, 10), steam = field(b.steam_id, 30), discord = field(b.discord_id, 30);
            if (!id || name.length < 2 || !ranks.includes(rank) || !['active', 'retired', 'inactive', 'absent'].includes(status) || !/^\d{4}-\d{2}-\d{2}$/.test(enlisted) || isNaN(Date.parse(enlisted)))
                return fail('Check the name, rank, enlistment date and status.');
            if (steam && !/^7656119\d{10}$/.test(steam))
                return fail('Enter a valid SteamID64.');
            if (discord && !/^\d{17,20}$/.test(discord))
                return fail('Enter a valid Discord ID.');
            for (const k of ['steam_oauth_link', 'discord_oauth_link']) {
                const value = field(b[k], 500);
                if (value && !/^https:\/\//.test(value))
                    return fail('OAuth link references must use HTTPS.');
            }
            await db.prepare('UPDATE personnel SET name=?,steam_id=?,discord_id=?,steam_oauth_link=?,discord_oauth_link=?,rank=?,enlisted=?,status=? WHERE id=?').bind(name, steam, discord, field(b.steam_oauth_link, 500), field(b.discord_oauth_link, 500), rank, enlisted, status, id).run();
            return json({ ok: true });
        }
        if (action === 'phrase') {
            const requested = field(b.role), role = (await layoutState()).layout.slots.some(s=>s.phraseRole===requested) ? requested : phraseRole(requested);
            if (role !== 'admin' && !(await layoutState()).layout.slots.some(s=>s.phraseRole===role))
                return fail('Invalid clearance role.');
            const phrase = passphrase(b.phrase);
            if(!phrase.trim() || phrase.length>256) return fail('Enter a nonempty passphrase of at most 256 characters.');
            await db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(role === 'admin' ? 'admin_password' : 'phrase_' + role, await encode(phrase)).run();
            if (role === 'admin')
                await db.prepare('DELETE FROM admin_sessions').run();
            return json({ ok: true });
        }
        if (action === 'reset_phrase') {
            const requested = field(b.role), role = (await layoutState()).layout.slots.some(s=>s.phraseRole===requested) ? requested : phraseRole(requested);
            if (!(await layoutState()).layout.slots.some(s=>s.phraseRole===role))
                return fail('Invalid role.');
            await db.prepare('DELETE FROM settings WHERE key=?').bind('phrase_' + role).run();
            return json({ ok: true });
        }
        if (action === 'release') {
            const operation = await orbatId(), slot = field(b.slot), time = new Date().toISOString();
            if(assignmentActor!=='Administrator' && (!field(b.expected) || !field(b.created))) return fail('Refresh the assignment before clearing it.',409);
            const guard=assignmentActor==='Administrator'?'':' AND a.user_id=? AND a.created=?', params=assignmentActor==='Administrator'?[]:[field(b.expected),field(b.created)];
            const result = await db.batch([db.prepare("INSERT INTO audit_log(operation_id,slot,event,before_name,after_name,actor,created) SELECT a.operation_id,a.slot,'cleared',p.name,'',?,? FROM assignments a JOIN personnel p ON p.id=a.user_id WHERE a.operation_id=? AND a.slot=?"+guard).bind(assignmentActor,time,operation,slot,...params),db.prepare('DELETE FROM assignments AS a WHERE operation_id=? AND slot=?'+guard).bind(operation,slot,...params)]);
            if (!result[1].meta.changes)
                return fail('This assignment has already been cleared.', 409);
            return json({ ok: true });
        }
        if (action === 'edit_assignment') {
            const operation = await orbatId(), slot = field(b.slot), user = field(b.user), expected = field(b.expected);
            const prior = await db.prepare('SELECT a.user_id,p.name FROM assignments a JOIN personnel p ON p.id=a.user_id WHERE a.operation_id=? AND a.slot=?').bind(operation, slot).first<{
                user_id: string;
                name: string;
            }>();
            if (!prior || prior.user_id !== expected)
                return fail('This role has changed. Refresh the roster and try again.', 409);
            if (prior.user_id === user)
                return json({ ok: true });
            const time = new Date().toISOString();
            const results = await db.batch([db.prepare("UPDATE assignments SET user_id=?,created=?,withdrawal_hash='' WHERE operation_id=? AND slot=? AND user_id=? AND EXISTS(SELECT 1 FROM personnel WHERE id=? AND status='active')").bind(user, time, operation, slot, expected, user), db.prepare("INSERT INTO audit_log(operation_id,slot,event,before_name,after_name,actor,created) SELECT a.operation_id,a.slot,'edited',?,p.name,?,? FROM assignments a JOIN personnel p ON p.id=a.user_id WHERE a.operation_id=? AND a.slot=? AND a.user_id=? AND a.created=?").bind(prior.name, assignmentActor, time, operation, slot, user, time)]);
            if (!results[0].meta.changes)
                return fail('Select an active, unassigned member.');
            return json({ ok: true });
        }
        if (action === 'regenerate_phrase') {
            const requested = field(b.role), role = (await layoutState()).layout.slots.some(s=>s.phraseRole===requested) ? requested : phraseRole(requested);
            if (!(await layoutState()).layout.slots.some(s=>s.phraseRole===role))
                return fail('Invalid role.');
            const bytes = crypto.getRandomValues(new Uint8Array(18));
            const phrase = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
            await db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('phrase_' + role, await encode(phrase)).run();
            return json({ ok: true, phrase });
        }
        return fail('Unknown command.');
    }
    catch (e) {
        const message = String(e);
        if (message.includes('UNIQUE') || message.includes('PRIMARY KEY'))
            return fail('This key, SteamID or assignment is already in use.', 409);
        console.error(e);
        return fail('The archive could not save this request. Your input is preserved; please try again.', 503);
    }
}

export async function POST(req: Request) {
    const copy=req.clone();
    const admin=await isAdmin(req);
    let before:any=null;
    let previousSlot:any=null;
    let awardMedal:any=null, awardOperation:any=null;
    let requestBody:any={};
    try {
        requestBody=await copy.json();
        previousSlot=(await currentSlots()).find(s=>s.id===requestBody.slot);
        const id=field(requestBody.user || requestBody.id);
        before=id ? await database().prepare('SELECT id,name,rank,status FROM personnel WHERE id=?').bind(id).first() : null;
        if(requestBody.slot && !before) before=await database().prepare('SELECT p.id,p.name,p.rank,p.status FROM personnel p JOIN assignments a ON a.user_id=p.id WHERE a.slot=? AND a.operation_id=?').bind(field(requestBody.slot),await orbatId()).first();
        if(requestBody.action==='revoke_medal'){const award=await database().prepare('SELECT a.user_id,m.name FROM medal_awards a JOIN medals m ON m.id=a.medal_id WHERE a.id=?').bind(field(requestBody.id)).first<any>();if(award){before=await database().prepare('SELECT name FROM personnel WHERE id=?').bind(award.user_id).first();awardMedal=award;}}
        if(requestBody.action==='award_medal'){awardMedal=await database().prepare('SELECT name FROM medals WHERE id=?').bind(field(requestBody.medal)).first();awardOperation=await database().prepare('SELECT title FROM operation_audits WHERE id=?').bind(Number(requestBody.operation)).first();}
        if(['rename_operation','operation_visibility','delete_operation_audit'].includes(requestBody.action)) before=await database().prepare('SELECT title FROM operation_audits WHERE id=?').bind(requestBody.id).first();
    } catch { /* Invalid input is handled by the action handler. */ }
    const response=await handlePost(req);
    if(response.ok) {
        try {
            const b=requestBody, returned=await response.clone().json();
            const details:Record<string,unknown>={};
            for(const key of ['slot','user','id','role','name','rank','status','title','mode','enabled','hidden','tentativeAttendance','config','enlisted','resetLayout','medal','operation','description','comment','kind','reason','locked','historicalStatus','expectedAssignment'])if(b[key]!==undefined)details[key]=b[key];
            if(returned.id)details.id=returned.id;
            if(b.action==='correct_operation_membership'){details.previousAssignment=returned.previousAssignment;details.assignment=returned.assignment;}
            const slot=(await currentSlots()).find(s=>s.id===b.slot);
            const member=before?.name || field(b.name) || field(b.user) || 'Personnel';
            const position=(previousSlot || slot) ? `${(previousSlot || slot).name} (${(previousSlot || slot).code})` : /^(reserve|tentative|absent)/.test(field(b.slot)) ? field(b.slot).split(':')[0].replace('reserve','attending') : field(b.slot);
            const changes=[['name','name'],['rank','rank'],['status','service status']].filter(([key])=>b[key]!==undefined && before?.[key]!==b[key]).map(([key,label])=>`${label} changed from ${before?.[key] || 'N/A'} to ${b[key]}`);
            const descriptions:Record<string,string>={
                claim:`${member} signed up for ${position}.`,
                withdraw:`${member} withdrew from ${position}.`,
                register:`Registered ${field(b.name)} as ${field(b.rank) || 'Recruit'}.`,
                save_user:changes.length ? `Updated ${member}: ${changes.join('; ')}.` : `Updated ${member}’s personnel record.`,
                deregister:`Removed ${member} from the personnel registry.`,
                slot_role:`Changed the role at ${previousSlot?.code || position} from ${previousSlot?.name || 'its previous role'} to ${field(b.role)}. The assigned member was kept.`,
                slot_lock:`${b.enabled===false?'Disabled':'Enabled'} the passphrase lock for ${position}.`,
                clear_all:`Sealed operation “${field(b.title) || 'Regimental operation'}” and cleared the manifest.`,
                destroy_orbat:'Cleared the operation manifest without archiving it.',
                rename_operation:`Renamed operation “${before?.title || b.id}” to “${field(b.title)}”.`,
                operation_visibility:`${b.hidden?'Hid':'Restored'} archived operation “${before?.title || b.id}”.`,
                operation_config:(typeof b.locked==='boolean' ? (b.locked?'Locked the ORBAT for administrator editing only. ':'Unlocked the ORBAT. ') : '') + (b.resetLayout ? 'Restored the default SPEAR 1, SPEAR 2 and SHIELD layout. Members in removed slots moved to Attending.' : `Switched to ${b.mode==='open'?'the open personnel manifest':'the main ORBAT'}. Existing signups were preserved.`),
                add_warning:`Recorded a strike for ${member}: ${field(b.reason,1000)}`,
                add_strike:`Recorded a strike for ${member}: ${field(b.reason,1000)}`,
                remove_strike:`Removed a strike from ${member}’s record.`,
                revoke_medal:`Revoked “${awardMedal?.name || 'a medal'}” awarded to ${member}.`,
                update_medal:`Updated the medal type “${field(b.name)}”.`,
                delete_medal:'Removed a medal type from future awarding. Existing awards were preserved.',
                correct_operation_membership:`Corrected “${returned.operationTitle || b.id}”: changed ${returned.memberName || member} from ${returned.previousAssignmentLabel} to ${returned.assignmentLabel}. Reason: ${field(b.reason,1000)}`,
                create_medal:`Created the medal “${field(b.name)}”.`,
                award_medal:`Awarded “${awardMedal?.name || 'a medal'}” to ${member} ${awardOperation ? 'for “'+awardOperation.title+'”.' : 'outside an operation.'}`,
                countdown:`Set deployment for ${field(b.config?.localStart).replace('T',' ')} (${field(b.config?.timeZone)}), with weekly renewal ${b.config?.autoRenew?'enabled':'disabled'}.`,
                phrase:`Changed the access passphrase for ${field(b.role)==='admin'?'administrators':(await currentSlots()).find(s=>s.phraseRole===b.role)?.name || field(b.role)}.`, reset_phrase:`Reset the ${field(b.role)} access passphrase.`, regenerate_phrase:`Regenerated the ${field(b.role)} access passphrase.`,
                delete_operation_audit:`Deleted archived operation “${before?.title || b.id}”.`,
                login:'Administrator signed in.', logout:'Administrator signed out.'
            };
            details.description=descriptions[field(b.action)] || `${field(b.action).replaceAll('_',' ')}${field(b.name) ? ': '+field(b.name) : ''}${field(b.title) ? ': '+field(b.title) : ''}.`;
            const machine=req.headers.get('x-regiment-machine') || '';
            await database().prepare('INSERT INTO change_log(action,actor,details,ip,machine_id,created) VALUES (?,?,?,?,?,?)').bind(field(b.action),admin || b.action==='login'?'Administrator':'Public',JSON.stringify(details),field(runtimeClientAddress(req),100),/^[a-f0-9-]{36}$/i.test(machine)?machine:'',new Date().toISOString()).run();
        } catch(e) {console.error('Change logging failed',e);}
    }
    return response;
}
