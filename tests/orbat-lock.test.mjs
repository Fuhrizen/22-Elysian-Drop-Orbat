import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import ts from 'typescript';
import {openDatabase} from '../db/sqlite.mjs';

test('ORBAT lock blocks public and delegated changes, preserves admin control and survives restart/sealing',async()=>{
 const temporary=mkdtempSync(join(tmpdir(),'orbat-lock-')),dbPath=join(temporary,'test.sqlite');
 let adapter=openDatabase(dbPath,resolve('drizzle'));
 const key='__orbatLockDb';globalThis[key]=adapter;
 try{
  const compile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  const url=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
  const dbUrl=url(`export const database=()=>globalThis.${key};export const runtimeSecret=()=>"lock-test-key";export const runtimeOrigin=()=>"";export const runtimeClientAddress=()=>"lock-test";`);
  const route=readFileSync('app/api/regiment/route.ts','utf8').replace("'@/scripts/medal-digest.mjs'",JSON.stringify(new URL('../scripts/medal-digest.mjs',import.meta.url).href)).replace("'@/db/raw'",JSON.stringify(dbUrl)).replace("'@/lib/regiment'",JSON.stringify(url(compile(readFileSync('lib/regiment.ts','utf8'))))).replace("'@/lib/countdown'",JSON.stringify(url(compile(readFileSync('lib/countdown.ts','utf8')))));
  const {GET,POST}=await import(url(compile(route)));let token='';
  const headers=admin=>({'Content-Type':'application/json',...(admin&&token?{Authorization:'Bearer '+token}:{})});
  const post=async(body,admin=true)=>{const r=await POST(new Request('https://test/api/regiment',{method:'POST',headers:headers(admin),body:JSON.stringify(body)}));return {status:r.status,data:await r.json()}};
  const get=async(admin=false)=>{const r=await GET(new Request('https://test/api/regiment',{headers:headers(admin)}));assert.equal(r.status,200);return r.json()};
  const check=async(body,admin=true,status=200)=>{const r=await post(body,admin);assert.equal(r.status,status,JSON.stringify(r.data));return r.data};
  token=(await check({action:'login',key:'lock-test-key'})).sessionToken;
  assert.equal((await get()).configuration.locked,false);
  const member=(await check({action:'register',name:'Lock test member',rank:'Guardsman',status:'active'})).id;
  const other=(await check({action:'register',name:'Other test member',rank:'Guardsman',status:'active'})).id;
  await check({action:'phrase',role:'ic',phrase:'sl-clearance'});
  await check({action:'claim',slot:'trooper1',user:member},false);
  const assignment=(await get()).assignments[0];
  await check({action:'operation_config',mode:'main',locked:true},false,401);
  await check({action:'operation_config',mode:'main',locked:true});
  assert.equal((await get()).configuration.locked,true);
  const before=adapter.sqlite.prepare('SELECT * FROM assignments').all();
  for(const body of [
   {action:'claim',slot:'trooper2',user:other},
   {action:'claim',slot:'reserve',user:other},
   {action:'withdraw',slot:assignment.slot,expected:assignment.user_id,created:assignment.created},
   {action:'slot_role',slot:'trooper2',role:'Medicae',phrase:'sl-clearance',accessRole:'ic'},
   {action:'slot_lock',slot:'trooper2',enabled:true,lockPhrase:'slot-key',phrase:'sl-clearance'},
  ]){const result=await post(body,false);assert.equal(result.status,423,JSON.stringify(result));assert.match(result.data.error,/lock/i)}
  assert.deepEqual(adapter.sqlite.prepare('SELECT * FROM assignments').all(),before);
  await check({action:'withdraw',slot:assignment.slot,expected:assignment.user_id,created:assignment.created});
  await check({action:'claim',slot:'trooper1',user:member});
  await check({action:'slot_role',slot:'trooper2',role:'Medicae'});
  await check({action:'slot_lock',slot:'trooper2',enabled:true,lockPhrase:'slot-key'});
  await check({action:'operation_config',mode:'open'});
  assert.equal((await get()).configuration.locked,true);
  await check({action:'operation_config',mode:'main'});
  assert.equal((await get()).configuration.locked,true);
  adapter.close();adapter=openDatabase(dbPath,resolve('drizzle'));globalThis[key]=adapter;
  assert.equal((await get()).configuration.locked,true);
  await check({action:'clear_all',confirmed:true,confirmedDispositions:[],title:'Locked operation'});
  assert.equal((await get()).configuration.locked,true);
  assert.equal((await get()).assignments.length,0);
  await check({action:'claim',slot:'trooper1',user:member},false,423);
  await check({action:'operation_config',mode:'main',locked:false});
  await check({action:'claim',slot:'trooper1',user:member},false);
  const a=(await get()).assignments[0];
  await check({action:'withdraw',slot:a.slot,expected:a.user_id,created:a.created},false);
  await check({action:'slot_role',slot:'trooper2',role:'Guardsmen',phrase:'sl-clearance'},false);

  // Counts follow public visibility and revocation, while retired types retain earned honours.
  const medal=(await check({action:'create_medal',name:'Badge test honour',description:'A retained service honour.'})).id;
  const visibleOperation=(await get(true)).operationAudits[0].id;
  const firstAward=(await check({action:'award_medal',medal,user:member,operation:null})).id;
  await check({action:'award_medal',medal,user:member,operation:null});
  await check({action:'award_medal',medal,user:member,operation:visibleOperation});
  const count=async(admin=false)=>(await get(admin)).users.find(p=>p.id===member).medal_count;
  assert.equal(await count(),3);
  await check({action:'operation_visibility',id:visibleOperation,hidden:true});
  assert.equal(await count(),2);
  assert.equal(await count(true),2);
  await check({action:'revoke_medal',id:firstAward});
  assert.equal(await count(),1);
  assert.equal(await count(true),1);
  await check({action:'delete_medal',id:medal});
  assert.equal(await count(),1);
  await check({action:'operation_visibility',id:visibleOperation,hidden:false});
  assert.equal(await count(),2);

  // Simulate an administrator locking between initial authorization and the write transaction.
  const originalBatch=adapter.batch.bind(adapter);
  const lockBeforeNextBatch=()=>{
   adapter.batch=async statements=>{
    adapter.batch=originalBatch;
    adapter.sqlite.prepare("UPDATE settings SET value=json_set(value,'$.locked',json('true')) WHERE key='operation_config'").run();
    return originalBatch(statements);
   };
  };
  const auditCount=()=>adapter.sqlite.prepare('SELECT count(*) AS n FROM audit_log').get().n;
  let priorAudit=auditCount();
  lockBeforeNextBatch();
  assert.notEqual((await post({action:'claim',slot:'trooper1',user:member},false)).status,200);
  assert.equal((await get()).assignments.length,0);
  assert.equal(auditCount(),priorAudit);
  await check({action:'operation_config',mode:'main',locked:false});
  await check({action:'claim',slot:'trooper1',user:member});
  const currentAssignment=(await get()).assignments[0];
  priorAudit=auditCount();
  lockBeforeNextBatch();
  assert.notEqual((await post({action:'withdraw',slot:currentAssignment.slot,expected:currentAssignment.user_id,created:currentAssignment.created},false)).status,200);
  assert.deepEqual((await get()).assignments,[currentAssignment]);
  assert.equal(auditCount(),priorAudit);
 }finally{adapter.close();delete globalThis[key];rmSync(temporary,{recursive:true,force:true})}
});
