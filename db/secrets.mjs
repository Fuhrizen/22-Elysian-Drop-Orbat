import { readFileSync } from 'node:fs';

export function adminAccessKey(env = process.env) {
    if (env.ADMIN_ACCESS_KEY) return env.ADMIN_ACCESS_KEY;
    if (!env.ADMIN_ACCESS_KEY_FILE) return '';
    try {
        const key = readFileSync(env.ADMIN_ACCESS_KEY_FILE, 'utf8');
        if (!key) throw new Error('The secret file is empty.');
        return key;
    } catch (error) {
        throw new Error('Cannot load administrator key. Set ADMIN_ACCESS_KEY or mount a readable, nonempty file at ADMIN_ACCESS_KEY_FILE.', { cause: error });
    }
}
