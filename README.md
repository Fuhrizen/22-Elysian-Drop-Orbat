# 22nd Elysian Drop Regiment ORBAT

Community operation signup and personnel records, built with Next.js and SQLite. Includes configurable ORBAT layouts and role keys, operation archives, attendance corrections, medals, personnel management and administrator audit records.

## Development

Use Node 24 and the pnpm version pinned in `package.json`.

```bash
pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev
```

Choose an administrator bootstrap key and the exact local browser origin in `.env`.

```bash
pnpm test
pnpm typecheck
pnpm build
```

CI groups the essential checks into application/dependency verification and production image verification. The production build includes TypeScript validation; a disposable container checks readiness and access controls before publication.

SQLite migrations are applied transactionally and verified by checksum. Do not modify a migration after it has been applied to an existing database.
