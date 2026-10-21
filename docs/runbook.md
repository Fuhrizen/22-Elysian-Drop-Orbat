# Deployment runbook

The previous two-static-branch/local-registry deployment has been retired from source. Follow [the CI/CD redesign](cicd-redesign.md) for the current complete runbook, settings inventory, new VM provisioning, NPM/Cloudflare configuration, migration, cutover, recovery and acceptance checks.

Do not run retired `deploy/adopt.sh`, `deploy/release.sh` or fixed development/main scripts from an old clone. Do not attach a public repository runner to the production VM. The replacement controller source is in `deploy/controller/` and must live in a separate private repository.

Existing production is not automatically migrated by a source update. Preserve the live VM and data until the replacement has passed the final-copy and cutover gates.
