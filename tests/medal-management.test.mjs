import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import ts from 'typescript';
import {openDatabase} from '../db/sqlite.mjs';

test('medal types can be edited and removed without losing awarded honours',async()=>{
 const temporary=mkdtempSync(join(tmpdir(),'medal-management-'));
 const adapter=openDatabase(join(temporary,'test.sqlite'),resolve('drizzle'));
 const key='__medalManagementDb';globalThis[key]=adapter;
 try{
  const compile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  const url=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
  const dbUrl=url(`export const database=()=>globalThis.${key};export const runtimeSecret=()=>"medal-test-key";export const runtimeOrigin=()=>"";export const runtimeClientAddress=()=>"medal-test";`);
  const route=readFileSync('app/api/regiment/route.ts','utf8').replace("'@/scripts/medal-digest.mjs'",JSON.stringify(new URL('../scripts/medal-digest.mjs',import.meta.url).href)).replace("'@/db/raw'",JSON.stringify(dbUrl)).replace("'@/lib/regiment'",JSON.stringify(url(compile(readFileSync('lib/regiment.ts','utf8'))))).replace("'@/lib/countdown'",JSON.stringify(url(compile(readFileSync('lib/countdown.ts','utf8')))));
  const {GET,POST}=await import(url(compile(route)));let token='';
  const headers=admin=>({'Content-Type':'application/json',...(admin&&token?{Authorization:'Bearer '+token}:{})});
  const post=async(body,admin=true)=>{const r=await POST(new Request('https://test/api/regiment',{method:'POST',headers:headers(admin),body:JSON.stringify(body)}));return {status:r.status,data:await r.json()}};
  const get=async(query,admin=false)=>{const r=await GET(new Request('https://test/api/regiment'+query,{headers:headers(admin)}));assert.equal(r.status,200);return r.json()};
  token=(await post({action:'login',key:'medal-test-key'})).data.sessionToken;
  const member=(await post({action:'register',name:'Medal recipient',rank:'Guardsman',status:'active'})).data.id;
  const medal=(await post({action:'create_medal',name:'Original honour',description:'Original description.'})).data.id;
  const award=(await post({action:'award_medal',medal,user:member,operation:null})).data.id;
  for(const action of ['update_medal','delete_medal'])assert.equal((await post({action,id:medal,name:'Changed',description:'Changed description.'},false)).status,401);
  assert.equal((await post({action:'update_medal',id:medal,name:' ',description:'Missing name.'})).status,400);
  assert.equal((await post({action:'update_medal',id:'missing',name:'Valid',description:'Valid.'})).status,404);
  assert.equal((await post({action:'delete_medal',id:'missing'})).status,404);
  assert.equal((await post({action:'update_medal',id:medal,name:'Revised honour',description:'Revised description.'})).status,200);
  const updated=(await get('?medals=1&user='+member)).awards.find(a=>a.id===award);
  assert.equal(updated.name,'Revised honour');assert.equal(updated.description,'Revised description.');
  assert.equal((await post({action:'delete_medal',id:medal})).status,200);
  for(const admin of [false,true]){
   const records=await get('?medals=1&user='+member,admin);
   assert.ok(!records.medals.some(m=>m.id===medal));
   assert.equal(records.awards.find(a=>a.id===award).name,'Revised honour');
  }
  assert.equal((await post({action:'award_medal',medal,user:member,operation:null})).status,400);
  assert.equal((await post({action:'update_medal',id:medal,name:'Revived',description:'Cannot revive.'})).status,404);
  assert.equal((await post({action:'delete_medal',id:medal})).status,404);
  assert.equal((await get('')).users.find(p=>p.id===member).medal_count,1);
  assert.equal((await post({action:'revoke_medal',id:award})).status,200);
  assert.equal((await get('?medals=1&user='+member)).awards.length,0);
  assert.equal((await get('')).users.find(p=>p.id===member).medal_count,0);
  assert.ok((await get('?medals=1&user='+member,true)).awards.find(a=>a.id===award).revoked_at);
  const log=await get('?change_log=1&q=medal',true);
  assert.ok(log.records.some(r=>r.action==='delete_medal'));
 }finally{adapter.close();delete globalThis[key];rmSync(temporary,{recursive:true,force:true})}
});

