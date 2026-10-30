import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { openDatabase } from '../db/sqlite.mjs';

test('configured origin rejects internal/sibling origins and previews cannot enable weekly renewal', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orbat-boundary-'));
  const adapter = openDatabase(join(directory, 'db.sqlite'), resolve('drizzle'));
  globalThis.__boundaryDb = adapter;
  process.env.ORBAT_DISABLE_AUTO_RENEW = 'true';
  try {
    const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
    const url = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
    const raw = url('export const database=()=>globalThis.__boundaryDb; export const runtimeSecret=()=>"test-key"; export const runtimeOrigin=()=>"https://preview.example.test"; export const runtimeClientAddress=()=>"test";');
    const source = readFileSync('app/api/regiment/route.ts', 'utf8')
      .replace("'@/scripts/medal-digest.mjs'",JSON.stringify(new URL('../scripts/medal-digest.mjs',import.meta.url).href)).replace("'@/db/raw'", JSON.stringify(raw))
      .replace("'@/lib/regiment'", JSON.stringify(url(compile(readFileSync('lib/regiment.ts', 'utf8')))))
      .replace("'@/lib/countdown'", JSON.stringify(url(compile(readFileSync('lib/countdown.ts', 'utf8')))));
    const { GET, POST } = await import(url(compile(source)));
    const origin = 'https://preview.example.test';
    const post = (body, source = origin, token = '') => POST(new Request('http://localhost:3000/api/regiment', {
      method: 'POST', headers: { Origin: source, 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body),
    }));
    for (const source of ['http://localhost:3000', 'https://production.example.test', 'https://invalid.example']) {
      assert.equal((await post({ action: 'login', key: 'test-key' }, source)).status, 403);
    }
    const login = await post({ action: 'login', key: 'test-key' });
    assert.equal(login.status, 200);
    assert.match(login.headers.get('set-cookie'), /Secure/);
    assert.doesNotMatch(login.headers.get('set-cookie'), /Domain=/);
    const { sessionToken } = await login.json();
    const state = await (await GET(new Request('http://localhost:3000/api/regiment'))).json();
    assert.equal(state.countdown.autoRenew, false);
    assert.equal((await post({ action: 'countdown', config: { localStart: '2030-01-04T19:30', timeZone: 'Europe/London', autoRenew: true } }, origin, sessionToken)).status, 200);
    assert.equal(JSON.parse(adapter.sqlite.prepare("SELECT value FROM settings WHERE key='countdown'").get().value).autoRenew, false);
    process.env.ORBAT_DEPLOYMENT_GUARD = join(directory, '.deployment-paused');
    writeFileSync(process.env.ORBAT_DEPLOYMENT_GUARD, '');
    assert.equal((await post({ action: 'register', name: 'Paused write' }, origin, sessionToken)).status, 503);
    assert.equal(adapter.sqlite.prepare('SELECT count(*) AS n FROM personnel').get().n, 0);
    assert.equal((await post({ action: 'login', key: 'test-key' }, 'https://invalid.example')).status, 403);
    rmSync(process.env.ORBAT_DEPLOYMENT_GUARD);
    assert.equal((await post({ action: 'register', name: 'Unpaused write' }, origin, sessionToken)).status, 200);
  } finally { delete process.env.ORBAT_DISABLE_AUTO_RENEW; delete process.env.ORBAT_DEPLOYMENT_GUARD; adapter.close(); delete globalThis.__boundaryDb; rmSync(directory, { recursive: true, force: true }); }
});

