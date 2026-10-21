import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {openDatabase} from '../db/sqlite.mjs';

test('historic membership corrections update sealed records and service history without changing the live ORBAT',async()=>{
 const temporary=mkdtempSync(join(tmpdir(),'regiment-history-'));
 const adapter=openDatabase(join(temporary,'regiment.sqlite'),resolve('drizzle'));
 try {
  const compile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  const url=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
  globalThis.__historyTestDb=adapter;
  const dbUrl=url('export const database=()=>globalThis.__historyTestDb;export const runtimeSecret=()=>"history-test-key";export const runtimeOrigin=()=>"";export const runtimeClientAddress=()=>"history-test-client";');
  const route=readFileSync('app/api/regiment/route.ts','utf8').replace("'@/db/raw'",JSON.stringify(dbUrl)).replace("'@/lib/regiment'",JSON.stringify(url(compile(readFileSync('lib/regiment.ts','utf8'))))).replace("'@/lib/countdown'",JSON.stringify(url(compile(readFileSync('lib/countdown.ts','utf8')))));
  const {GET,POST}=await import(url(compile(route)));
  let token='';
  const headers=admin=>({...admin&&token?{Authorization:'Bearer '+token}:{},'X-Regiment-Machine':'22222222-2222-4222-8222-222222222222'});
  async function get(query='',admin=true){const r=await GET(new Request('https://test/api/regiment'+query,{headers:headers(admin)}));return {status:r.status,data:await r.json()};}
  async function post(body,admin=true){const r=await POST(new Request('https://test/api/regiment',{method:'POST',headers:{'Content-Type':'application/json',...headers(admin)},body:JSON.stringify(body)}));return {status:r.status,data:await r.json()};}
  token=(await post({action:'login',key:'history-test-key'})).data.sessionToken;
  await get();
  async function register(name){const r=await post({action:'register',name,rank:'Recruit',status:'active'});assert.equal(r.status,200);return r.data.id;}
  const present=await register('Present member'),absent=await register('Missed member');
  await post({action:'claim',slot:'reserve',user:present});
  const live=(await get()).data.assignments;
  const seal=await post({action:'clear_all',title:'Historic operation',confirmed:true,confirmedDispositions:live.map(({slot,user_id,created})=>({slot,user_id,created})).sort((a,b)=>a.slot.localeCompare(b.slot))});
  assert.equal(seal.status,200);
  const id=(await get()).data.operationAudits[0].id;
  const missing=await register('Late registry entry');
  // Exercise an old snapshot with additional metadata and no configuration/sections.
  const original=(await get('?operation_audit='+id)).data;
  const legacy={...original.snapshot,version:1,legacyNote:{retain:'historical metadata'}};
  delete legacy.configuration;delete legacy.sections;
  legacy.personnel.find(p=>p.id===absent).rank='Corporal';
  adapter.sqlite.prepare('UPDATE operation_audits SET snapshot=? WHERE id=?').run(JSON.stringify(legacy),id);
  const correction={action:'correct_operation_membership',id,user:absent,slot:'trooper1',reason:'Confirmed against the operation roster.'};
  const beforeSnapshot=adapter.sqlite.prepare('SELECT snapshot FROM operation_audits WHERE id=?').get(id).snapshot;
  assert.equal((await post(correction,false)).status,401);
  assert.equal(adapter.sqlite.prepare('SELECT snapshot FROM operation_audits WHERE id=?').get(id).snapshot,beforeSnapshot);
  assert.equal((await post({...correction,reason:''})).status,400);
  assert.equal((await post({...correction,slot:'not-a-historical-role'})).status,400);
  assert.equal((await post({...correction,historicalStatus:'invalid'})).status,400);
  // Another administrator writes after this request reads the snapshot but before its CAS.
  const prepare=adapter.prepare;
  let intercepted=false;
  adapter.prepare=query=>{
   const statement=prepare(query);
   if(query==='UPDATE operation_audits SET snapshot=? WHERE id=? AND snapshot=?'){
    const bind=statement.bind.bind(statement);
    statement.bind=(...bindings)=>{
     const bound=bind(...bindings),run=bound.run.bind(bound);
     bound.run=async()=>{
      intercepted=true;
      const concurrent=JSON.parse(adapter.sqlite.prepare('SELECT snapshot FROM operation_audits WHERE id=?').get(id).snapshot);
      concurrent.concurrentNote='Retained concurrent administrator correction';
      adapter.sqlite.prepare('UPDATE operation_audits SET snapshot=? WHERE id=?').run(JSON.stringify(concurrent),id);
      return run();
     };
     return bound;
    };
   }
   return statement;
  };
  try{assert.equal((await post(correction)).status,409)}finally{adapter.prepare=prepare}
  assert.equal(intercepted,true);
  const afterConflict=JSON.parse(adapter.sqlite.prepare('SELECT snapshot FROM operation_audits WHERE id=?').get(id).snapshot);
  assert.equal(afterConflict.concurrentNote,'Retained concurrent administrator correction');
  assert.equal(afterConflict.assignments.find(a=>a.user_id===absent).slot,'absent:'+absent);
  assert.equal((await post(correction)).status,200);
  assert.equal((await post(correction)).status,409);
  assert.equal((await post({...correction,user:missing})).status,409);
  assert.equal((await post({...correction,user:missing,slot:'reserve'})).status,200);
  const corrected=(await get('?operation_audit='+id)).data;
  assert.equal(corrected.created,original.created);
  assert.deepEqual(corrected.snapshot.legacyNote,{retain:'historical metadata'});
  assert.equal(corrected.snapshot.personnel.find(p=>p.id===absent).rank,'Corporal');
  assert.equal(corrected.snapshot.personnel.find(p=>p.id===missing).name,'Late registry entry');
  assert.equal(corrected.snapshot.assignments.filter(a=>a.user_id===absent).length,1);
  assert.equal(corrected.snapshot.assignments.find(a=>a.user_id===absent).slot,'trooper1');
  assert.equal(corrected.snapshot.assignments.find(a=>a.user_id===missing).slot,'reserve:'+missing);
  const publicArchive=(await get('?public_archive='+id,false)).data;
  assert.deepEqual(publicArchive.snapshot,corrected.snapshot);
  assert.ok(!JSON.stringify(publicArchive).includes(correction.reason));
  assert.equal(corrected.snapshot.concurrentNote,'Retained concurrent administrator correction');
  assert.equal((await get('?public_archive=list',false)).data.operations[0].signup_count,3);
  const histories=(await get('?personnel_history=all',false)).data.histories;
  assert.equal(histories[absent][0].id,id);assert.notEqual(histories[absent][0].role,'Absent');
  assert.equal(histories[missing][0].id,id);
  const ledger=(await get('?ledger_days=30',false)).data.members;
  assert.ok(ledger.some(p=>p.id===absent));assert.ok(ledger.some(p=>p.id===missing));
  const current=(await get()).data;
  assert.equal(current.assignments.length,0);
  assert.equal(current.users.find(p=>p.id===absent).rank,'Recruit');
  const logs=adapter.sqlite.prepare("SELECT * FROM change_log WHERE action='correct_operation_membership' ORDER BY id").all();
  assert.equal(logs.length,2);assert.equal(logs[0].actor,'Administrator');
  assert.equal(JSON.parse(logs[0].details).reason,correction.reason);
  assert.equal((await post({...correction,id:999999})).status,404);

  // Corrections edit the archived ORBAT itself: present personnel may move, leave,
  // become absent/tentative, or return without altering their live personnel record.
  async function archived(){return (await get('?operation_audit='+id)).data.snapshot;}
  async function assignment(user){return (await archived()).assignments.find(a=>a.user_id===user)?.slot ?? null;}
  async function move(user,slot,expectedAssignment,extra={}){
   return post({action:'correct_operation_membership',id,user,slot,expectedAssignment,reason:'Roster preview correction.',...extra});
  }
  async function expectParticipation(user,participates,role){
   const ledger=(await get('?ledger_days=30',false)).data.members;
   const entry=ledger.find(p=>p.id===user);
   assert.equal(Boolean(entry),participates);
   if(entry)assert.equal(entry.operations,1);
   const history=(await get('?personnel_history=all',false)).data.histories[user] || [];
   if(role===null)assert.equal(history.length,0);
   else {assert.equal(history.length,1);assert.equal(history[0].id,id);if(role)assert.equal(history[0].role,role);}
  }
  const originalAssignmentCreated=(await archived()).assignments.find(a=>a.user_id===absent).created;
  assert.equal((await move(absent,'trooper1','trooper1')).status,409,'identical destination is a no-op');
  assert.equal((await move(absent,'trooper2','absent:'+absent)).status,409,'stale preview cannot move a newer assignment');
  assert.equal(await assignment(absent),'trooper1');
  assert.equal((await move(absent,'trooper2','trooper1')).status,200,'present members can change role');
  assert.equal(await assignment(absent),'trooper2');
  assert.equal((await archived()).assignments.find(a=>a.user_id===absent).created,originalAssignmentCreated,'moving preserves the archived assignment time');
  assert.equal((await move(missing,'trooper1','reserve:'+missing)).status,200,'moving frees the prior role');
  assert.equal((await move(absent,'trooper1','trooper2')).status,409,'occupied roles cannot be overwritten');
  assert.equal(await assignment(absent),'trooper2');
  assert.equal(await assignment(missing),'trooper1');
  await expectParticipation(absent,true);

  const beforeInvalid=JSON.stringify(await archived());
  for(const slot of ['tentative','unassigned']) {
   assert.equal((await move(absent,slot,'trooper2')).status,400,'sealed attendance must be confirmed');
   assert.equal(JSON.stringify(await archived()),beforeInvalid);
  }
  assert.equal((await move(absent,'absent','trooper2')).status,200);
  assert.equal(await assignment(absent),'absent:'+absent);
  await expectParticipation(absent,false,'Absent');
  assert.equal((await get('?public_archive=list',false)).data.operations[0].signup_count,2);
  assert.equal((await move(absent,'reserve','trooper2')).status,409,'stale assignments remain guarded');
  assert.equal((await move(absent,'reserve','absent:'+absent)).status,200);
  assert.equal(await assignment(absent),'reserve:'+absent);
  await expectParticipation(absent,true,'Reserve');
  assert.equal((await get('?public_archive=list',false)).data.operations[0].signup_count,3);

  const beforeStatusChange=JSON.stringify(await archived());
  for(const historicalStatus of ['active','absent','retired','inactive']) {
   assert.equal((await move(absent,'absent','reserve:'+absent,{historicalStatus})).status,400,'recorded service status cannot be overridden');
   assert.equal(JSON.stringify(await archived()),beforeStatusChange);
  }
  await expectParticipation(absent,true,'Reserve');
  // A member on leave at sealing keeps that service status while attendance is corrected.
  const leaveSnapshot=await archived();
  leaveSnapshot.personnel.find(p=>p.id===present).status='absent';
  adapter.sqlite.prepare('UPDATE operation_audits SET snapshot=? WHERE id=?').run(JSON.stringify(leaveSnapshot),id);
  assert.equal((await move(present,'absent',await assignment(present))).status,200);
  assert.equal((await archived()).personnel.find(p=>p.id===present).status,'absent');
  assert.equal((await move(present,'reserve','absent:'+present)).status,200);
  assert.equal((await archived()).personnel.find(p=>p.id===present).status,'absent');
  assert.equal((await get('?public_archive='+id,false)).data.snapshot.personnel.find(p=>p.id===present).status,'absent');
  const newMember=await register('Additional missed member');
  assert.equal((await move(newMember,'reserve',null)).status,200,'members registered after the seal can be added');
  await expectParticipation(newMember,true,'Reserve');
  assert.equal((await move(newMember,'absent','reserve:'+newMember)).status,200);
  await expectParticipation(newMember,false,'Absent');
  assert.equal((await archived()).personnel.filter(p=>p.id===newMember).length,1);
  assert.equal((await move(newMember,'trooper2','absent:'+newMember)).status,200,'returning members can take a freed archived role');
  await expectParticipation(newMember,true);
  const finalSnapshot=await archived();
  assert.deepEqual(finalSnapshot.legacyNote,legacy.legacyNote);
  assert.equal(finalSnapshot.concurrentNote,'Retained concurrent administrator correction');
  assert.equal(new Set(finalSnapshot.assignments.map(a=>a.user_id)).size,finalSnapshot.assignments.length);
  const liveAfter=(await get()).data;
  assert.equal(liveAfter.assignments.length,0);
  assert.equal(liveAfter.users.find(p=>p.id===absent).rank,'Recruit');
  assert.equal(liveAfter.users.find(p=>p.id===absent).status,'active');
  const publicAfter=(await get('?public_archive='+id,false)).data;
  assert.ok(!JSON.stringify(publicAfter).includes('Roster preview correction.'));
  assert.equal(publicAfter.created,original.created);
  const finalLogs=adapter.sqlite.prepare("SELECT details FROM change_log WHERE action='correct_operation_membership' ORDER BY id").all().map(row=>JSON.parse(row.details));
  assert.ok(finalLogs.some(log=>log.previousAssignment==='trooper1' && log.assignment==='trooper2'));
  assert.ok(finalLogs.some(log=>log.previousAssignment==='trooper2' && log.assignment==='absent:'+absent));
  assert.ok(finalLogs.some(log=>log.previousAssignment==='absent:'+absent && log.assignment==='reserve:'+absent));

 } finally {adapter.sqlite.close();rmSync(temporary,{recursive:true,force:true});delete globalThis.__historyTestDb;}
});
