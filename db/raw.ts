import { adminAccessKey } from './secrets.mjs';
import { getDatabase } from './sqlite.mjs';
interface Statement {
    bind(...values: unknown[]): Statement;
    first<T = Record<string, unknown>>(): Promise<T | null>;
    all<T = Record<string, unknown>>(): Promise<{
        results: T[];
    }>;
    run(): Promise<{
        meta: {
            changes: number;
        };
    }>;
}
interface ArchiveDatabase {
    prepare(query: string): Statement;
    batch(statements: Statement[]): Promise<{
        meta: {
            changes: number;
        };
    }[]>;
}
export function database() { return getDatabase() as unknown as ArchiveDatabase; }
export function runtimeSecret() { return adminAccessKey(); }
export function runtimeOrigin() { return process.env.SITE_ORIGIN || ''; }
export function runtimeClientAddress(req: Request) { return process.env.TRUST_PROXY === 'true' ? req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'direct' : 'direct'; }
