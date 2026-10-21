import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readdirSync,copyFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {openDatabase} from '../db/sqlite.mjs';
test('medal upgrade consolidates duplicate operation awards and permits standalone awards',()=>{
 const dir=mkdtempSync(join(tmpdir(),'medal-upgrade-')),migrations=join(dir,'migrations');mkdirSync(migrations);let db;
 try{
  for(const name of readdirSync('drizzle').filter(n=>n.endsWith('.sql')&&Number(n.slice(0,4))<11))copyFileSync(join('drizzle',name),join(migrations,name));
  const path=join(dir,'test.sqlite');db=openDatabase(path,migrations);
  db.sqlite.prepare("INSERT INTO personnel(id,name,steam_id,enlisted,status) VALUES ('p','Test','','2026-01-01','active')").run();
  db.sqlite.prepare("INSERT INTO operation_audits(id,title,actor,created,snapshot) VALUES (1,'Test op','Admin','2026-10-08T20:00:00Z','{}')").run();
  db.sqlite.prepare("INSERT INTO medals VALUES ('m','Test medal','Test description','2026-10-08T20:00:00Z')").run();
  db.sqlite.prepare("INSERT INTO medal_awards(id,medal_id,user_id,operation_id,created) VALUES ('a','m','p',1,'2026-10-08T21:00:00Z'),('b','m','p',1,'2026-10-08T21:01:00Z')").run();
  db.close();db=openDatabase(path,resolve('drizzle'));
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM medal_awards').get().n,1);
  assert.throws(()=>db.sqlite.prepare("INSERT INTO medal_awards(id,medal_id,user_id,operation_id,created) VALUES ('c','m','p',1,'2026-10-08T21:00:00Z')").run(),/UNIQUE/);
  db.sqlite.prepare("INSERT INTO medal_awards(id,medal_id,user_id,operation_id,created) VALUES ('d','m','p',NULL,'2026-10-08T22:00:00Z')").run();
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM medal_awards').get().n,2);
 }finally{db?.close();rmSync(dir,{recursive:true,force:true})}
});
