import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, readdirSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { openDatabase } from '../db/sqlite.mjs';
const compile = source => stripTypeScriptTypes(source, { mode: 'transform' });
const url = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const regimentUrl = url(compile(readFileSync('lib/regiment.ts', 'utf8')));
const { defaultLayout, slotRoleOptions, canLockSlot } = await import(regimentUrl);

test('second command slot swaps GM/vox and shares GM signup and withdrawal clearance', async () => {
 const directory=mkdtempSync(join(tmpdir(),'second-gm-'));const db=openDatabase(join(directory,'db.sqlite'),resolve('drizzle'));globalThis.__secondGmDb=db;
 try {
  const raw=url('export const database=()=>globalThis.__secondGmDb;export const runtimeSecret=()=>"test-admin";export const runtimeOrigin=()=>"https://test.invalid";export const runtimeClientAddress=()=>"second-gm-test";');
  const source=readFileSync('app/api/regiment/route.ts','utf8').replace("'@/db/raw'",JSON.stringify(raw)).replace("'@/lib/regiment'",JSON.stringify(regimentUrl)).replace("'@/lib/countdown'",JSON.stringify(url(compile(readFileSync('lib/countdown.ts','utf8')))));
  const {GET,POST}=await import(url(compile(source)));let token='';
  const headers=admin=>({'Content-Type':'application/json',Origin:'https://test.invalid',...(admin&&token?{Authorization:'Bearer '+token}:{})});
  const post=async(body,admin=true,status=200)=>{const r=await POST(new Request('https://test.invalid/api/regiment',{method:'POST',headers:headers(admin),body:JSON.stringify(body)}));const d=await r.json();assert.equal(r.status,status,JSON.stringify(d));return d;};
  const get=async()=> (await GET(new Request('https://test.invalid/api/regiment',{headers:headers(true)}))).json();
  token=(await post({action:'login',key:'test-admin'})).sessionToken;
  const member=(await post({action:'register',name:'Second GM',rank:'Guardsman',status:'active'})).id;
  await post({action:'phrase',role:'gm',phrase:'gm-clearance'});
  const original=(await get()).layout.slots.find(s=>s.id==='gm2');
  assert.equal(original.section,'command');assert.equal(original.phraseRole,'gm');
  assert.deepEqual(slotRoleOptions(original),['Gamemaster','Vox Operator']);assert.deepEqual(slotRoleOptions({id:'gm',section:'command'}),[]);
  for(const role of ['Gamemaster','Vox Operator']) {
   await post({action:'slot_role',slot:'gm2',role});
   const slot=(await get()).layout.slots.find(s=>s.id==='gm2');
   assert.equal(slot.name,role);assert.equal(slot.phraseRole,'gm');assert.equal(slot.section,'command');assert.equal(canLockSlot(slot),false);
   await post({action:'claim',slot:'gm2',user:member,phrase:'incorrect'},false,403);
   await post({action:'claim',slot:'gm2',user:member,phrase:'gm-clearance'},false);
   const a=(await get()).assignments.find(a=>a.slot==='gm2');
   if(role==='Gamemaster'){await post({action:'slot_role',slot:'gm2',role:'Vox Operator'});assert.deepEqual((await get()).assignments.find(x=>x.slot==='gm2'),a);}
   await post({action:'withdraw',slot:'gm2',expected:a.user_id,created:a.created,phrase:'incorrect'},false,403);
   await post({action:'withdraw',slot:'gm2',expected:a.user_id,created:a.created,phrase:'gm-clearance'},false);
  }
  await post({action:'slot_role',slot:'gm',role:'Vox Operator'},true,400);
  await post({action:'slot_role',slot:'gm2',role:'Medicae'},true,400);
 } finally {db.close();delete globalThis.__secondGmDb;rmSync(directory,{recursive:true,force:true});}
});

test('saved layout gains gm2 once without changing existing assignments or sealed archives',()=>{
 const directory=mkdtempSync(join(tmpdir(),'gm-upgrade-')),prior=join(directory,'prior');mkdirSync(prior);
 for(const n of readdirSync('drizzle').filter(n=>n.endsWith('.sql')&&n!=='0015_second_gamemaster.sql'))copyFileSync(join('drizzle',n),join(prior,n));
 const path=join(directory,'db.sqlite');let db=openDatabase(path,prior);
 try {
  const old=defaultLayout();old.slots=old.slots.filter(s=>s.id!=='gm2');old.sections[0].eyebrow='CUSTOM HQ';
  db.sqlite.prepare('INSERT INTO settings(key,value) VALUES (?,?)').run('orbat_layout',JSON.stringify({revision:7,layout:old}));
  db.sqlite.prepare("INSERT INTO operations(id,title,created) VALUES ('op','Operation','now')").run();
  db.sqlite.prepare("INSERT INTO personnel(id,name,steam_id,enlisted) VALUES ('person','Member','steam','now')").run();
  db.sqlite.prepare("INSERT INTO assignments(operation_id,slot,user_id,created) VALUES ('op','gm','person','now')").run();
  const snapshot=JSON.stringify({roles:old.slots});db.sqlite.prepare("INSERT INTO operation_audits(title,actor,created,snapshot) VALUES ('Archive','Admin','now',?)").run(snapshot);
  db.close();db=openDatabase(path,resolve('drizzle'));
  let state=JSON.parse(db.sqlite.prepare("SELECT value FROM settings WHERE key='orbat_layout'").get().value);
  assert.equal(state.revision,8);assert.equal(state.layout.slots.filter(s=>s.id==='gm2').length,1);assert.equal(state.layout.slots.find(s=>s.id==='gm2').protected,true);
  assert.equal(state.layout.sections[0].eyebrow,'CUSTOM HQ');assert.equal(db.sqlite.prepare('SELECT slot FROM assignments').get().slot,'gm');assert.equal(db.sqlite.prepare('SELECT snapshot FROM operation_audits').get().snapshot,snapshot);
  db.close();db=openDatabase(path,resolve('drizzle'));state=JSON.parse(db.sqlite.prepare("SELECT value FROM settings WHERE key='orbat_layout'").get().value);
  assert.equal(state.revision,8);assert.equal(state.layout.slots.filter(s=>s.id==='gm2').length,1);
 } finally {db.close();rmSync(directory,{recursive:true,force:true});}
});
