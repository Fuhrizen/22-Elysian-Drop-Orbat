import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

test('backup includes committed WAL data; restore discards later writes and rejects corrupt snapshots', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orbat-snapshot-'));
  const path = join(directory, 'live.sqlite'), snapshot = join(directory, 'snapshot.sqlite');
  const run = (mode, file = snapshot) => spawnSync(process.execPath, [resolve('scripts/snapshot.mjs'), mode, file], { env: { ...process.env, SQLITE_PATH: path }, encoding: 'utf8' });
  let db;
  try {
    db = new DatabaseSync(path);
    db.exec("PRAGMA journal_mode=WAL; CREATE TABLE records(value TEXT); INSERT INTO records VALUES ('before release');");
    const backup = run('backup');
    assert.equal(backup.status, 0, backup.stderr);
    db.exec("INSERT INTO records VALUES ('after release');");
    db.close(); db = undefined;
    assert.equal(run('restore').status, 0);
    db = new DatabaseSync(path);
    assert.deepEqual(db.prepare('SELECT value FROM records').all().map(r => r.value), ['before release']);
    db.close(); db = undefined;
    const bad = join(directory, 'corrupt.sqlite'); writeFileSync(bad, 'invalid database');
    assert.notEqual(run('restore', bad).status, 0);
    db = new DatabaseSync(path);
    assert.equal(db.prepare('SELECT count(*) AS n FROM records').get().n, 1);
  } finally { db?.close(); rmSync(directory, { recursive: true, force: true }); }
});
