// Maintenance tool: never opens the application adapter or runs migrations.
import { DatabaseSync, backup } from 'node:sqlite';
import { existsSync, copyFileSync, unlinkSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';

const [mode, argument] = process.argv.slice(2);
const path = process.env.SQLITE_PATH || '/app/data/regiment.sqlite';
const snapshot = resolve(argument || '/backup/database.sqlite');
function verify(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const rows = db.prepare('PRAGMA integrity_check').all();
    if (rows.length !== 1 || Object.values(rows[0])[0] !== 'ok') throw new Error('SQLite integrity check failed');
  } finally { db.close(); }
}
if (mode === 'backup') {
  if (!existsSync(path)) throw new Error('No database found; refusing an empty backup');
  const db = new DatabaseSync(path, { readOnly: true });
  try { await backup(db, snapshot); } finally { db.close(); }
  chmodSync(snapshot, 0o600);
  verify(snapshot);
} else if (mode === 'restore') {
  // Caller must have stopped every writer before invoking restore.
  verify(snapshot);
  copyFileSync(snapshot, path + '.restore');
  chmodSync(path + '.restore', 0o600);
  const { renameSync } = await import('node:fs');
  renameSync(path + '.restore', path);
  for (const suffix of ['-wal', '-shm']) if (existsSync(path + suffix)) unlinkSync(path + suffix);
  verify(path);
} else if (mode === 'verify') verify(snapshot);
else throw new Error('Usage: snapshot.mjs backup|restore|verify /backup/database.sqlite');

