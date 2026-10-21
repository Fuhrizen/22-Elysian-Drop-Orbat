# 22nd Elysian Drop Regiment ORBAT

Community operation signup and personnel records, built with Next.js and SQLite. Includes configurable ORBAT layouts/role keys, archives and historical attendance corrections, medals, personnel strikes, and administrator audit records.

## CI/CD and migration

The deployment design uses a public application repository, GitHub-hosted CI, GHCR images, and a separate private deployment controller with an outbound-only self-hosted runner. Production follows successful builds of `main`. Active trusted internal PRs receive disposable LAN-only previews through Nginx Proxy Manager.

- [Full implementation plan, settings, VM setup and production data migration](docs/cicd-redesign.md)
- [Test review and CI scope](docs/test-review.md)
- [Private controller source and setup](deploy/controller/README.md)

The new controller is disabled until provisioned and configured. It does not alter the existing production VM merely because these files are committed. See the full plan for the one-time repository history reset and the separate GitHub visibility/package settings.

## Local development

Use Node 24 and the pnpm version in `package.json`.

```bash
pnpm install --frozen-lockfile
cp .env.example .env
# Choose a unique ADMIN_ACCESS_KEY and an exact SITE_ORIGIN in .env.
pnpm dev
```

Application tests use temporary SQLite databases:

```bash
pnpm test
pnpm test:deploy
pnpm typecheck
pnpm build
```

The CI workflow runs the tests and one production build; Next's build includes TypeScript validation. It then packages the standalone output with `deploy/runtime.Dockerfile` and runs disposable container smoke checks. Fork PRs run on GitHub-hosted runners and never receive a homelab runner or production secrets.

For a standalone local Docker deployment, edit `.env` and use `docker compose up -d --build`. The root Compose file is a development/manual option; the private controller uses its own fixed Compose file. The current SQL migration files must remain intact and unchanged after application to a database.
