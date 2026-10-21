import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
const target = resolve(process.argv[2] || './data/backups/regiment-' + new Date().toISOString().replaceAll(':', '-') + '.sqlite');
mkdirSync(dirname(target), { recursive: true });
const db = new DatabaseSync(process.env.SQLITE_PATH || './data/regiment.sqlite', { readOnly: true });
try {
    await backup(db, target);
    console.log(target);
}
finally {
    db.close();
}
