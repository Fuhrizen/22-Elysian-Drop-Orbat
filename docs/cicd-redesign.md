# 22nd ORBAT — CI/CD redesign and implementation plan

Prepared 21 October 2026 for `Fuhrizen/22-Elysian-Drop-Orbat`.

Repository work completed: the history-reset workflow succeeded, creating parentless baseline `786cca8c41cbd7cd6ce24b07414513a8f22423bf`; `development` was removed, and all 60 application/database/migration/static-asset files were verified unchanged. The temporary reset workflow was then retired from the active workflow directory. Subsequent commits belong to this new history. The infrastructure setup and live migration below remain to be performed.

## 1. Target and boundaries

Build a new VM alongside the existing production VM, preserve the current production database, validate the replacement privately, then repoint Nginx Proxy Manager (NPM). The current production VM remains the rollback route during cutover. Do not attach both applications to one live SQLite database.

Accepted design inputs: public community application repository, `main` represents production, active PRs receive ephemeral LAN-only previews, Cloudflare DNS, NPM ingress, no VPN/local DNS server requirement, and an initial VM size of 2 vCPU / 4 GiB RAM. Use a fixed 4 GiB reservation initially; ballooning below the measured working set can cause failures. Start with an 80 GiB disk (40 GiB is a practical lower starting point with close disk monitoring), optionally 2 GiB swap for occasional peaks, and a static/reserved LAN address. Builds run on standard GitHub-hosted Ubuntu runners, so local CPU and memory go to production and previews.

The implementation delivered in this repository includes application CI, runtime packaging, trusted private-controller source, test review, migration/cutover instructions and an exact-SHA-guarded one-time history reset. VM provisioning, GitHub account settings, controller repository creation, DNS/NPM changes and the live data transfer require access to those systems; they are not performed by committing this source.

## 2. Architecture and why the runner is private

| Component | Location | Responsibility |
| --- | --- | --- |
| ORBAT source | Public application repository | PRs, reviews, CI, dependency updates, image publication |
| CI | Standard GitHub-hosted Ubuntu 24.04 | Locked install, essential tests, one Next production build, image packaging and disposable smoke check |
| Images | Public GHCR package `ghcr.io/fuhrizen/22-elysian-drop-orbat` | One tested tag `run-<run-id>-<attempt>`, deployed by digest |
| Controller | Separate private repository, suggested `22-orbat-deploy` | Trusted workflow and fixed Compose/controller code only |
| Deployment runner | New VM; registered ONLY with private controller repo | Outbound HTTPS connection to GitHub; pull images and reconcile targets |
| Production | New VM, independent stack/data directory | Latest successful CI build of current main |
| Preview gateway | New VM, stable private listener | Exact PR hostname → loopback preview container port |
| PR previews | New VM, at most two | Trusted active internal PRs, independent empty databases and internal networks |
| Public ingress | Existing NPM | Production hostname → production VM private port |
| Preview ingress | NPM wildcard with LAN-only access control | PR hostname → private preview gateway |

Registering a persistent runner to the public application repository is unsafe even if the intended deployment workflow has a restrictive `if`: a PR can change workflow YAML to request that runner. A private controller repository prevents public PR workflows from scheduling onto it. Previews still run application images on the shared VM; only explicitly trusted contributors qualify. Container controls reduce exposure but are not a VM security boundary. Fork/untrusted previews would require a separate disposable VM.

The private controller runs every five minutes and can be run manually. GitHub cron is best effort: this is eventual reconciliation, not an instantaneous event delivery guarantee. It reads the public repository, its active PRs and successful CI runs, checks exact source SHA/event/branch/repository, pulls the corresponding tested image, verifies its source/revision labels, resolves its digest, and rechecks the source before changing the target. No inbound SSH, PAT, cross-repository dispatch secret, Cloudflare API token or NPM password is needed for recurring deployments. Runner registration uses GitHub's short-lived setup token once; the runner then maintains its own outbound connection. The workflow's automatic `GITHUB_TOKEN` is short-lived, not a user-managed token.

If immediate deployment events become necessary later, add a GitHub App scoped to the private controller for dispatch. That is an optional speed improvement with an additional credential to manage; it is not needed for this plan.

## 3. GitHub Free versus environment features

GitHub environments and environment secrets in private repositories require a qualifying paid plan. Do not make the deployment controller public just to unlock them. Two controller workflow profiles are supplied:

1. **Zero-budget default:** `deploy/controller/.github/workflows/reconcile.yml`. Private controller, repository variables/secrets, names `ORBAT_PRODUCTION_<SETTING>` and `ORBAT_PREVIEW_<SETTING>`.
2. **Environment profile:** `deploy/controller/reconcile-environments.yml.example`. On a supporting plan, replace the default workflow with this file, saved as `.github/workflows/reconcile.yml`; create `production` and `preview` environments, with identical common setting names in each. Activate one profile only. Private required reviewers have separate plan restrictions; do not assume Pro enables that rule.

Public application CI on standard runners and self-hosted deployment jobs have no runner-minute charge under the documented model. While the application is still private, hosted CI consumes its account's included private minutes. Review billing/storage settings before enabling lots of image retention. No quota or subscription is changed by this work.

## 4. Repository and GitHub setup order

1. Freeze writes briefly for the history reset. Existing `main` and `development` initially point to `e8a9202afe5a211efcc16cf096f9cb4ea3042f2b`; there were no open PRs when inspected.
2. Commit the redesigned files. The one-time history workflow is guarded by that exact previous main SHA. It refuses unexpected branches/tags or concurrent ref changes, creates a parentless commit containing the full application tree, atomically replaces main and deletes the retired development branch, then explicitly dispatches CI on the new root. It has no production runner access.
3. Verify the reset workflow succeeded, main has one reachable commit, development is absent, and CI is running on the new root. If the reset fails, do not report history as purged: inspect its log and use the manual fallback in section 12. After verification remove the one-time reset workflow in a normal reviewed change; its exact old-SHA guard makes it inert meanwhile.
4. Before making the repository public, inspect tracked source and historical Actions logs/artifacts for secrets and operational data. The new baseline preserves the current application files, so it also preserves any current-source leak. Rotate any exposed credential. Rewriting branch history does not erase copies, caches, old run logs, fork refs or GitHub's retained unreachable objects. Use GitHub's sensitive-data removal process if actual secrets were present. Do not publish historical backup artifacts.
5. Stop/unregister the old self-hosted runner from the application repository before changing visibility. No persistent runner should remain available to its public workflows. The old production container can keep serving while its runner is stopped.
6. Change application repository visibility to public after the audit. Public repositories can be forked; GitHub cannot make public code fork-proof. Restrict write access, review/merge rights and preview eligibility instead.
7. Make the GHCR image package public separately. Public source does not automatically make an existing/new package public. Verify anonymous pull from the VM before enabling the controller.
8. Create the private controller repository and copy **the contents** of `deploy/controller/` into its root, including `.github`. Its scheduled workflow must be on its default `main` branch. Keep its collaborator list limited to deployment administrators.
9. Register the new runner only in the controller repository, using label `orbat-deploy-v2`, Linux x64 and the GitHub UI's current download/checksum/setup commands. Run under a dedicated service account such as `svc_orbat`, install as a systemd service, leave auto-updates enabled, and grant Docker access. Docker group access is effectively host-root authority; only trusted controller code reaches it. Do not reuse the old `orbat` label.
10. Configure settings below with all deployment-enabled flags `false` until the corresponding acceptance checks pass.

After the public conversion, enable a main branch ruleset: require PRs, required check **Essentials**, branches up to date before merge, conversation resolution, linear history, and block branch deletion/force pushes. Use squash merging and automatic branch deletion. Require code-owner review if another eligible reviewer exists; with one maintainer do not configure an impossible self-review requirement. Keep a deliberate admin recovery path. Branch protections must be applied after the one-time rewrite.

Keep `CODEOWNERS`, PR template and grouped monthly Dependabot updates. Enable dependency alerts and secret scanning/push protection where available. Default workflow token permissions should be read-only; workflow jobs elevate only what they need. Allow only the used action owners and prefer full SHA pins. Require approval of workflows from outside contributors. Do not use `pull_request_target` to check out or execute PR code. Do not add production secrets to the public source repository.

## 5. Complete settings inventory

Values containing `NEW_VM_LAN_IP`, `NPM_LAN_IP`, `LAN_CIDR` or a key are placeholders to replace. Do not enter placeholder strings as real addresses/secrets. These settings describe the **new** VM, never the current live VM.

Application repository variable:

| Name | Value | Purpose |
| --- | --- | --- |
| `ORBAT_PREVIEW_DOMAIN` | `22preview.ivenity.co.uk` | Shows the planned preview URL in PR CI job summaries |

No application repository deployment secret is required. GHCR publication uses GitHub's automatic job token, with `packages: write` limited to the CI job. Fork PRs cannot publish. Internal non-draft PRs can publish, but publication alone does not authorize deployment; the controller also checks the author allowlist.

Private controller repository variables shared by both profiles:

| Name | Value |
| --- | --- |
| `ORBAT_SOURCE_REPOSITORY` | `Fuhrizen/22-Elysian-Drop-Orbat` |
| `ORBAT_ROOT` | `/srv/orbat` |

**GitHub Free default — repository variables:**

| Name | Initial value | Final value/purpose |
| --- | --- | --- |
| `ORBAT_PRODUCTION_ENABLED` | `false` | `true` after migration rehearsal |
| `ORBAT_PRODUCTION_READY` | `false` | `true` after creating the local migration approval marker |
| `ORBAT_PRODUCTION_BIND_ADDRESS` | `NEW_VM_LAN_IP` | Production listener; firewall permits NPM only |
| `ORBAT_PRODUCTION_HOST_PORT` | `3000` | Production app port |
| `ORBAT_PRODUCTION_SITE_ORIGIN` | `https://22orbat.ivenity.co.uk` | Exact browser origin; no path/trailing slash |
| `ORBAT_PREVIEW_ENABLED` | `false` | `true` after LAN ingress acceptance |
| `ORBAT_PREVIEW_BIND_ADDRESS` | `NEW_VM_LAN_IP` | Private gateway listener |
| `ORBAT_PREVIEW_HOST_PORT` | `8081` | Stable gateway port |
| `ORBAT_PREVIEW_DOMAIN` | `22preview.ivenity.co.uk` | Generates `https://pr-123.22preview.ivenity.co.uk` |
| `ORBAT_PREVIEW_LIMIT` | `2` | At most two previews on the 4 GiB resource profile |
| `ORBAT_PREVIEW_AUTHORS` | `Fuhrizen` | Comma-separated approved GitHub usernames; explicitly add other trusted contributors |

**GitHub Free default — repository secrets:**

| Name | Value |
| --- | --- |
| `ORBAT_PRODUCTION_ADMIN_ACCESS_KEY` | Strong unique bootstrap admin key for production; preserve existing in-database admin credentials during migration |
| `ORBAT_PREVIEW_ADMIN_ACCESS_KEY` | Different strong key used only for disposable previews |

The bootstrap key does not replace an admin password already stored in an imported database. Manage live password changes inside the application. Do not use the same key for production and preview. Do not duplicate a secret as a variable.

**Environment profile — same common names, scoped independently:**

| Common name | `production` environment | `preview` environment |
| --- | --- | --- |
| Variable `ORBAT_ENABLED` | `false`, then `true` | `false`, then `true` |
| Variable `ORBAT_BIND_ADDRESS` | `NEW_VM_LAN_IP` | `NEW_VM_LAN_IP` |
| Variable `ORBAT_HOST_PORT` | `3000` | `8081` |
| Secret `ORBAT_ADMIN_ACCESS_KEY` | Production-only bootstrap key | Preview-only bootstrap key |
| Variable `ORBAT_SITE_ORIGIN` | `https://22orbat.ivenity.co.uk` | Not used; each PR origin is derived |
| Variable `ORBAT_PRODUCTION_READY` | `false`, then `true` | Not used |
| Variable `ORBAT_PREVIEW_DOMAIN` | Not used | `22preview.ivenity.co.uk` |
| Variable `ORBAT_PREVIEW_LIMIT` | Not used | `2` |
| Variable `ORBAT_PREVIEW_AUTHORS` | Not used | `Fuhrizen` |

In the environment profile restrict deployment branches to controller `main`. The public application's source branch does not select the private workflow's environment: the controller separately verifies main or PR metadata.

Runtime `SITE_ORIGIN`, `TRUST_PROXY`, database location, resource limits and auto-renew behaviour are generated by the controller's fixed Compose file. They are not arbitrary PR-supplied deployment variables. Preview weekly auto-renew is forced off. Production weekly auto-renew retains its existing application setting.

## 6. New VM provisioning

1. Install a supported Linux server distribution, security updates, Docker Engine and Compose v2 from their official installation instructions; install Python 3.10+, Git and CA certificates. Verify `docker compose version` supports `up --wait`.
2. Reserve the LAN IP, set the hostname/timezone to your normal homelab convention, and synchronise time. Keep firewall management reachable from your LAN.
3. Create `svc_orbat`, the runner service directory and `/srv/orbat`. Make `/srv/orbat` owned by the runner account with mode 0700. Provision at least `/srv/orbat/production` and `/srv/orbat/previews`. The controller creates target data directories, gives SQLite's directory to UID/GID 1000, and keeps other state private.
4. Install the private-repo runner as above. Verify it is online in the private repository and absent from the application repository.
5. Test outbound HTTPS to GitHub API, Actions endpoints and GHCR. Pull the tested public application image anonymously. No router port-forward or public SSH listener is added.
6. Permit new VM production TCP 3000 and preview gateway TCP 8081 only from `NPM_LAN_IP`; permit LAN management separately. Preview app ports 32001–32008 bind only to `127.0.0.1`. Docker-published ports can bypass simple UFW rules: enforce upstream ACLs and/or a tested Docker-compatible `DOCKER-USER`/nftables policy. Test actual traffic rather than assuming a host rule covers Docker NAT.
7. Leave enabled flags false. Run the controller workflow once and verify both jobs exit with deployment disabled. Check job logs contain no bootstrap keys.
8. Monitor free RAM, swap use, disk use, container restarts and runner health. Do not compile Next or run CI builds on this host. Increase RAM or lower preview count before reducing production headroom.

## 7. Cloudflare DNS, TLS and NPM

No per-PR DNS record or NPM API call is needed. One wildcard routes all previews to a stable gateway; the controller maintains exact active-host routes behind it.

1. Keep `22orbat.ivenity.co.uk` pointing at the existing public ingress. At cutover only its NPM upstream changes; production DNS need not change if NPM stays in place.
2. Add Cloudflare wildcard `A` record `*.22preview.ivenity.co.uk` → **NPM's private LAN IP**, with **DNS only** (grey cloud). Do not point it at a public/WAN IP or enable Cloudflare proxying for these LAN-only previews. A public DNS answer containing a private address provides name resolution without a local DNS server; it does not provide access control. Browser/router DNS-rebinding protection can block it, so verify a real LAN client. A hosts-file entry for an individual PR is the fallback if needed.
3. In NPM request a publicly trusted wildcard certificate for `*.22preview.ivenity.co.uk` using Let's Encrypt DNS challenge with a Cloudflare token scoped to the necessary zone/DNS permissions. This token stays in NPM; GitHub/controller do not need it. A wildcard certificate covers `pr-123.22preview.ivenity.co.uk`, not the parent name unless you also include that name.
4. Create one NPM wildcard proxy host for `*.22preview.ivenity.co.uk`, HTTPS enabled, forwarding HTTP to `NEW_VM_LAN_IP:8081`. Preserve the Host header. NPM must overwrite client-controlled `X-Forwarded-For` appropriately; the gateway preserves NPM's trusted forwarded chain. Enable Force SSL. Add a LAN-only NPM Access List permitting the actual client LAN subnet and denying all others. Prefer a LAN-only listener/IP with no WAN port-forward if your NPM deployment supports it.
5. Production NPM forwards to `NEW_VM_LAN_IP:3000` only at cutover, preserving Host/HTTPS forwarding and the configured production origin. Continue using the existing production certificate.
6. Acceptance: from LAN, preview DNS resolves to NPM's private address and HTTPS validates. From mobile data/outside LAN, requests must fail/deny. Also deliberately send a preview Host/SNI to your **public NPM address**: it must deny access. Private DNS alone does not prevent a crafted request to a shared public ingress. Verify no public AAAA/CNAME record bypasses this policy.
7. Unknown/closed PR hostnames return 404 from the gateway. Successfully served previews add `X-Robots-Tag: noindex, nofollow`; this is an indexing hint, not access control.

The gateway is a small Nginx container using host networking, listening only on the configured private IP/8081 and forwarding to loopback ports. Each application container retains its own internal network. Gateway configuration is validated with `nginx -t` and reloaded after state reconciliation. Pin the chosen supported Nginx/base-image digests in the private controller after validation and maintain them deliberately.

## 8. Production database migration and rehearsal

Do not copy a live SQLite main file alone: committed changes may still be in its WAL. Use the existing SQLite backup tool or stop every writer before copying the complete stopped data directory. Preserve the existing migrations and their hashes; **purging Git history must not renumber or squash the SQL migrations**.

### Inventory and dry run

1. On the old VM record the running image/revision, container/Compose project, mounted named-volume or bind path, env/origin, admin setup and all files in its data directory. Use `docker inspect` on the actual container; do not assume its volume is named `regiment_data`.
2. Take a consistent online rehearsal snapshot using the running container's `scripts/snapshot.mjs backup` or `scripts/backup.mjs`. Choose a destination accessible inside that container and copy it out with `docker cp`. Confirm the command succeeded and verify the copied snapshot with the snapshot tool. Keep backups private.
3. Transfer that snapshot plus any additional application data files over your existing LAN SSH/SCP route. This is a one-off admin operation; it does not require opening SSH to the Internet or storing an SSH credential in GitHub.
4. Rehearse the new image against a **copy**, in a separate temporary stack/data directory with a temporary origin and port accessible only on LAN. Do not point the recurring production controller at rehearsal data. Migration execution must succeed without editing the old SQL files. Never let a test startup migrate the only backup.
5. Verify SQLite integrity, `_regiment_migrations`, personnel counts, assignments, archive counts, medals/awards, strikes, layout/settings and existing admin login. Inspect representative records through the UI, including archive corrections and public signup/withdrawal rules. Keep a table of old versus restored counts as evidence. A healthy `/api/health` alone is insufficient.
6. Test the new image's own smoke checks on the rehearsal stack; test through NPM as well so origin handling and secure sessions are exercised. Exercise backup/restore on a disposable copy. Stop and remove the rehearsal stack after sign-off.

### Final copy and cutover

1. Schedule a short maintenance window; tell users signups will pause. Leave NPM pointed at old production initially.
2. Stop **all old writers**, including any second container/service/cron job that writes the same SQLite database. Do not restart them during the final transfer. Take one final verified snapshot while stopped, and archive the full stopped data directory for non-database files. Record its SHA-256 checksum, old image/revision and timestamp. Keep an off-VM copy.
3. Place the final database at `/srv/orbat/production/data/regiment.sqlite` on the new VM. Transfer any other required files to that same target data directory. Use an empty destination so no stale `-wal`/`-shm` files remain. A verified standalone backup does not need the old WAL sidecars. Check the transfer checksum and SQLite integrity before startup.
4. Ensure only this final copy is in production, create `/srv/orbat/production/.migration-approved`, and set `ORBAT_PRODUCTION_READY=true`. Set production enabled true, then manually run the private reconciliation workflow. Keep preview enabled false for this first cutover if you want maximum diagnostic headroom.
5. The first deployment backs up imported data before running migrations. Confirm it reports the exact successful main revision. Check health, admin login, known personnel/archives/medals/strikes and non-destructive public behaviour. Compare recorded counts again. Do not use a smoke script that writes test records into live data.
6. Change only the production NPM upstream from old VM to `NEW_VM_LAN_IP:3000`. Test from a normal external client and LAN: HTTPS, login/logout, origin handling, read pages and one controlled signup/withdrawal using a known test account if appropriate.
7. Keep the old VM's application **stopped** with its final snapshot. Do not allow concurrent writes to old and new databases. Observe the new VM before retiring the old one. Enable previews after production is stable.

Rollback before new writes are accepted: disable the new production controller, stop the new application, restore NPM's old upstream and start the old application against its unchanged final database. After new writes have been accepted, simply switching to the old VM would lose those writes: stop new writers, take a new consistent backup, assess schema compatibility and migrate the current data back or forward-fix. Never blindly start an older application on a database that a newer migration changed.

## 9. Preview lifecycle and resource policy

- An active preview is an open, non-draft PR targeting main, from this same repository and an author listed in `ORBAT_PREVIEW_AUTHORS`, with a successful CI run for its current exact head SHA.
- Drafts and fork PRs still get hosted validation. No fork image is deployed. To preview an external contribution, review it, bring the reviewed code onto a maintainer-controlled branch, and open a trusted PR; do not add an untrusted author just to bypass the boundary.
- The two most recently updated eligible PRs receive slots. Each hostname is `pr-<number>.22preview.ivenity.co.uk`. Branch renames do not change the URL. A third eligible PR waits/evicts the least recently updated eligible preview under the stated capacity policy.
- A preview starts with an empty independently migrated database, never a raw production clone. Use manual synthetic test records and the preview-only admin key. Within an active PR, redeployments retain its preview data and take a recovery snapshot. Closing, merging, converting to draft, removal from the author allowlist or capacity eviction stops its containers and deletes its target data/backups on the next successful reconciliation.
- API inventory failures do not trigger cleanup based on partial results. Failed CI retains the last working preview; logs explicitly state that it is waiting/stale. Before deploying a new revision the controller rechecks that the PR is still eligible and unchanged. A close occurring after that final check is corrected on the next poll.
- Production has 1280 MiB and 1 CPU; previews have 640 MiB and 0.35 CPU each. Limits leave room for the OS, runner and gateway on 4 GiB. These are starting allocations, not a guarantee about future application growth. The source controller refuses a preview count above two until the profile/code is reviewed and the VM resized.
- Runtime containers use a non-root user, read-only root filesystem, writable temporary filesystem, dropped capabilities, no privilege escalation, PID/log limits and separate internal networks. They receive only their own database and bootstrap key. No host Docker socket or deployment credentials are mounted.

PR CI summaries display the expected LAN URL when the public repository variable is set; they are not proof that deployment has completed. Private controller job summaries show the actually deployed revision/URL and errors. Public PR comments or public deployment-status writes would require a source-repository write credential; they are deliberately omitted from the token-free cross-repository design. On the paid environment profile, the private controller also has GitHub environment/deployment history.

## 10. Deploy safety, recovery and operations

The controller never executes checked-out PR scripts on the host. Its own Compose and maintenance tool are trusted code in the private repository. Images are selected from a successful exact-source CI run, pulled and launched by digest, with source/revision label checks. Docker helper operations use the fixed controller snapshot implementation rather than running application migrations.

For each changed target: recover any incomplete transaction; ensure at least 2 GiB free; stop the old writer; create a verified SQLite backup; save matching old image/configuration metadata; journal the candidate phase; start the candidate with `compose up --wait`; run non-mutating revision/origin/access smoke checks; atomically record success. On failure restore data before restarting the matching old image. On interruption the next enabled reconciliation recovers the journal. If rollback itself fails the journal remains for investigation and the job fails; do not erase it. On an initial deployment with no old image, a failed candidate leaves the imported database restored and the stack stopped.

The controller uses workflow concurrency without cancellation and a host file lock across both jobs. Ordinary updates do not cancel an in-progress database transaction. There is a short write outage during production update; this is not a zero-downtime SQLite deployment.

Routine operations:

1. Check controller failures and runner offline state; use manual Run workflow after fixing the cause. A disabled enabled-flag intentionally prevents all changes, including journal recovery.
2. Keep off-VM encrypted backups, with a defined retention policy (for example 7 daily + 4 weekly) and a monthly restore exercise. Deployment snapshots are local recovery points, not disaster-recovery backups. The controller does not automatically prune production backups. Set disk alerts (for example 70% warning/85% urgent) and review retention before deleting anything.
3. Retain current image digests and the images/metadata needed by your rollback window in GHCR. Avoid an indiscriminate `docker system prune --volumes`. Remove reviewed old preview image tags and stale unused local images, preserving current/rollback digests. Images created for every PR update need a retention policy even when container/data cleanup works.
4. Update the Linux VM, Docker, runner and the pinned action/base/gateway images periodically. The controller's standalone copy needs its own reviewed update process: later changes to the public `deploy/controller/` directory do not auto-update the private repository. Add the controller test command to its own PR checks using a hosted/private-minute budget if desired; never run its untrusted PRs on the deployment runner.
5. For manual rollback, disable automatic production reconciliation first, stop all target writers, choose a verified snapshot and its accompanying `.json` metadata, restore via the trusted `snapshot.mjs`, and restart the recorded old digest/config. Verify health and functional data before reopening ingress. Re-enable automation only after main represents the intended production release; otherwise it will redeploy the latest successful main.

## 11. Acceptance checklist and go-live gates

| Gate | Pass condition |
| --- | --- |
| History | Main is a new parentless baseline, development retired, source tree preserved; retained GitHub logs/caches assessed separately |
| CI | Exact revision passes all retained application/controller tests, production build/type validation and disposable image smoke check |
| Image | Correct revision/source labels, CI-run tag, digest recorded, public anonymous pull succeeds |
| Runner | New runner is online only in the private controller; source repo has no persistent runner |
| Settings | Correct profile for account plan, common naming pattern, separate admin keys, disabled until ready |
| Migration rehearsal | Verified backup restored; migrations pass; representative records and old/new table counts agree |
| Production cutover | Final copy taken with old writers stopped, new production verified, NPM upstream changed, old app remains stopped |
| Preview creation | Open trusted PR gets independent data and correct LAN HTTPS URL after CI/poll |
| Preview update | Head update deploys its exact tested revision; failed update retains last-good data/image |
| Preview cleanup | Closed/merged/draft/evicted PR loses container, route and database after successful poll |
| Exclusions | Fork/unapproved author cannot schedule deployment runner or create preview |
| LAN-only ingress | LAN works; outside-LAN and crafted public-ingress Host/SNI requests are denied |
| Recovery | Disposable startup/smoke failure restores old snapshot + image; interrupted transaction recovers |
| Capacity | Production remains responsive with two previews, no sustained swapping/restarts, adequate disk headroom |

## 12. History reset fallback and collaborator instructions

The one-time workflow performs the requested branch-history reset using Git on a hosted runner because the connected GitHub tool requires a parent for its commit-creation operation. Its main/development update uses explicit leases and an atomic push. If repository policies or workflow-token permissions reject that operation, the repository remains at the prepared redesign commit and history is **not** yet purged.

Manual fallback from a trusted admin machine with an authenticated Git client, after inspecting the current refs and freezing writes:

```bash
git clone https://github.com/Fuhrizen/22-Elysian-Drop-Orbat.git orbat-reset
cd orbat-reset
git fetch origin --prune --tags
# Inspect refs and save the two exact expected remote SHAs before proceeding.
git ls-remote --heads --tags origin
EXPECTED_MAIN=$(git rev-parse origin/main)
EXPECTED_DEV=$(git rev-parse origin/development)
ROOT=$(git commit-tree 'origin/main^{tree}' -m 'Initial import: ORBAT application and redesigned CI/CD')
git push --atomic \
  --force-with-lease="refs/heads/main:$EXPECTED_MAIN" \
  --force-with-lease="refs/heads/development:$EXPECTED_DEV" \
  origin "$ROOT:refs/heads/main" :refs/heads/development
# If any additional branches/tags exist, review and remove/rewrite their old-history refs too.
# Then manually run CI on main in GitHub Actions.
```

After a successful reset, collaborators should make a fresh clone. Save any uncommitted work as a patch first, then apply only needed changes to a branch from the new main. Do not merge or push an old clone's branches, tags or bundles back into the repository: that would reintroduce the retired history.

## 13. Sources for platform constraints

- [GitHub self-hosted runner security](https://docs.github.com/en/actions/reference/security/secure-use)
- [Adding a self-hosted runner and outbound connection requirements](https://docs.github.com/en/actions/reference/runners/self-hosted-runners)
- [Environments, secret scopes and plan availability](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
- [GitHub Actions billing](https://docs.github.com/en/billing/managing-billing-for-github-actions/about-billing-for-github-actions)
- [Visibility changes and public forks](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility)
- [Cloudflare wildcard DNS](https://developers.cloudflare.com/dns/manage-dns-records/reference/wildcard-dns-records/)
- [Cloudflare proxy status](https://developers.cloudflare.com/dns/proxy-status/)

See `docs/test-review.md` for test-level decisions, measured local timings and validation limits.
