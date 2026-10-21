import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
export function openDatabase(path = process.env.SQLITE_PATH || './data/regiment.sqlite', migrations = process.env.MIGRATIONS_DIR || resolve('drizzle')) {
    if (path !== ':memory:')
        mkdirSync(dirname(resolve(path)), { recursive: true });
    const sqlite = new DatabaseSync(path);
    sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;');
    sqlite.exec('CREATE TABLE IF NOT EXISTS _regiment_migrations (name TEXT PRIMARY KEY,hash TEXT NOT NULL,applied TEXT NOT NULL)');
    try {
        sqlite.exec('BEGIN IMMEDIATE');
        for (const name of readdirSync(migrations).filter(n => /^\d+.*\.sql$/.test(n)).sort()) {
            const sql = readFileSync(resolve(migrations, name), 'utf8'), hash = createHash('sha256').update(sql).digest('hex');
            const prior = sqlite.prepare('SELECT hash FROM _regiment_migrations WHERE name=?').get(name);
            if (prior) {
                if (prior.hash !== hash)
                    throw new Error('Applied migration changed: ' + name);
                continue;
            }
            sqlite.exec(sql);
            sqlite.prepare('INSERT INTO _regiment_migrations VALUES(?,?,?)').run(name, hash, new Date().toISOString());
        }
        sqlite.exec('COMMIT');
    }
    catch (error) {
        sqlite.exec('ROLLBACK');
        sqlite.close();
        throw error;
    }
    class Statement {
        constructor(query, params = []) { this.query = query; this.params = params; }
        bind(...params) { return new Statement(this.query, params); }
        async first() { return sqlite.prepare(this.query).get(...this.params) || null; }
        async all() { return { results: sqlite.prepare(this.query).all(...this.params) }; }
        runSync() { return { meta: { changes: Number(sqlite.prepare(this.query).run(...this.params).changes) } }; }
        async run() { return this.runSync(); }
    }
    return { sqlite, prepare: query => new Statement(query), async batch(statements) {
            // Do not await between statements: other requests cannot enter this transaction.
            sqlite.exec('BEGIN IMMEDIATE');
            try {
                const results = statements.map(s => s.runSync());
                sqlite.exec('COMMIT');
                return results;
            }
            catch (error) {
                sqlite.exec('ROLLBACK');
                throw error;
            }
        }, close: () => sqlite.close() };
}
export function getDatabase() { return globalThis.__regimentSQLite ??= openDatabase(); }
