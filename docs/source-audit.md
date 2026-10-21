# Source baseline and migration notes

The application's original import notes recorded that its real `.env` was excluded and no SQLite production database was imported into Git. Treat those as historical import notes rather than a new audit of every old commit.

The 21 October CI/CD redesign preserves the current application tree, static assets and all existing checksum-verified SQL migrations. It replaces the fixed DEV/PROD deployment implementation. Production data stays on the old VM until the final consistent backup, rehearsal and cutover in [the current plan](cicd-redesign.md).

The new deployment requires Nginx Proxy Manager, Cloudflare DNS and a new 2 vCPU / 4 GiB VM. Previews are independent empty databases, with weekly auto-renew forced off. The old DEV branch is retired during the requested history reset.

The current tracked tree contains `.env.example`, tests with synthetic keys, and no tracked `.env` or SQLite data file. Before public conversion, review current source plus historical Actions logs/artifacts and rotate any exposed credential. Rewriting Git branch history cannot revoke secrets or erase existing copies/caches.
