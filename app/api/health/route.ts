import { database } from '@/db/raw';
export const dynamic = 'force-dynamic';
export async function GET() { try {
    await database().prepare('SELECT 1 AS ok').first();
    return Response.json({ status: 'ok', revision: process.env.APP_REVISION || 'local' }, { headers: { 'Cache-Control': 'no-store' } });
}
catch {
    return Response.json({ status: 'unavailable' }, { status: 503 });
} }
