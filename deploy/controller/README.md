# Private deployment controller

Copy the **contents of this directory**, including `.github`, into the root of a new **private** repository, suggested name `22-orbat-deploy`. Do not register the deployment runner with the public application repository.

The default `.github/workflows/reconcile.yml` works with repository secrets/variables on GitHub Free. All environment-specific names follow `ORBAT_PRODUCTION_<SETTING>` or `ORBAT_PREVIEW_<SETTING>`. The common controller variables are `ORBAT_SOURCE_REPOSITORY` and `ORBAT_ROOT`.

If your GitHub plan supports environments in private repositories, replace the default workflow with `reconcile-environments.yml.example`, saved as `.github/workflows/reconcile.yml`. Create environments `production` and `preview`, use the common names from the full plan, and restrict them to the controller's main branch. Do not activate both variants.

Requirements: Linux x64, Docker Engine + Compose v2 supporting `up --wait`, Python 3.10+, a runner with label `orbat-deploy-v2`, and outbound HTTPS. The source repository and its GHCR image package must be public before enabling reconciliation. `GH_TOKEN` is the automatic, short-lived GitHub Actions token, used only for authenticated reads of public API data. Docker pulls are anonymous. No PAT, SSH key, Cloudflare token or NPM credential is required by the recurring deployment path.

Defaults: production 1280 MiB/1 CPU; each preview 640 MiB/0.35 CPU; at most two previews. Previews use independent empty SQLite databases, independent internal Docker networks, loopback ports 32001–32008, and a fixed gateway on the chosen private VM address/port. Gateway configuration is generated from successfully deployed preview state. Only active non-draft PRs from explicitly allowlisted authors and the same source repository qualify. Fork PRs still get hosted CI; they do not deploy.

Changes are discovered approximately every five minutes. GitHub schedules are best effort and can be delayed. Manual Run workflow reconciles immediately when the runner is available. Closed/draft/excluded/evicted preview data is deleted on the next successful inventory reconciliation. The two most recently updated eligible PRs receive capacity; waiting PRs can be brought back by updating them or closing another preview. An eligible PR with failing/pending CI retains its previous working preview; the job log reports that it is stale.

Before enabling production, migrate and rehearse the database, create `/srv/orbat/production/.migration-approved`, and set `ORBAT_PRODUCTION_READY=true`. Enabling the production flag alone cannot create an empty replacement for an unapproved migration. The full provisioning, settings table, migration, cutover and rollback steps are in the application repository's `docs/cicd-redesign.md`.

Every changed release stops the target writer, saves a verified SQLite backup and matching old image/configuration metadata, starts the image by digest, and checks revision/readiness/access controls. Failed startup or smoke checks restore the snapshot and old image. A transaction journal allows the next run to recover after interruption. Initial imported data is also backed up; without an old image, a failed first release remains stopped for manual investigation. A process killed before the next scheduled recovery can leave a service temporarily down.

Do not build or check out PR source on the deployment VM. Do not mount the Docker socket, production database, host root, runner directory or deployment token into preview containers. The VM still shares a kernel: only allow trusted contributors' images. Put untrusted/fork previews on a separate disposable VM if you add them in future.

For local verification: `python3 -m unittest discover -s tests -v`. No Docker daemon or production data is used by these tests.
