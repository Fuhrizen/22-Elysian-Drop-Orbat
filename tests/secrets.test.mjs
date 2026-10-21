import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { adminAccessKey } from '../db/secrets.mjs';

test('administrator key works with env only, missing file fallback and file-only mounts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'regiment-secrets-'));
    try {
        const file = join(dir, 'key');
        writeFileSync(file, 'mounted-key');
        assert.equal(adminAccessKey({ ADMIN_ACCESS_KEY: 'environment-key' }), 'environment-key');
        assert.equal(adminAccessKey({ ADMIN_ACCESS_KEY: 'environment-key', ADMIN_ACCESS_KEY_FILE: join(dir, 'missing') }), 'environment-key');
        assert.equal(adminAccessKey({ ADMIN_ACCESS_KEY_FILE: file }), 'mounted-key');
        assert.equal(adminAccessKey({}), '');
        assert.throws(() => adminAccessKey({ ADMIN_ACCESS_KEY_FILE: join(dir, 'missing') }), /Set ADMIN_ACCESS_KEY/);
        writeFileSync(file, '');
        assert.throws(() => adminAccessKey({ ADMIN_ACCESS_KEY_FILE: file }), /nonempty/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});
