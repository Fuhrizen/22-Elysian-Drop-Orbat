import { existsSync } from 'node:fs';
import { adminAccessKey } from '../db/secrets.mjs';
import { openDatabase } from '../db/sqlite.mjs';
const db = openDatabase();
const configured = db.sqlite.prepare("SELECT 1 FROM settings WHERE key='admin_password'").get();
if (!configured && !adminAccessKey()) {
    db.close();
    throw new Error('Set ADMIN_ACCESS_KEY or ADMIN_ACCESS_KEY_FILE before first startup.');
}
db.close();
const bundled = new URL('../server.js', import.meta.url);
if (existsSync(bundled))
    await import(bundled.href);
else {
    const { spawn } = await import('node:child_process');
    const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '0.0.0.0', '--port', process.env.PORT || '3000'], { stdio: 'inherit' });
    for (const signal of ['SIGTERM', 'SIGINT'])
        process.on(signal, () => child.kill(signal));
    child.on('exit', code => process.exit(code ?? 0));
}
