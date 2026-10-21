# Test review — 21 October 2026

The application tests are worth keeping. They execute the real API handlers against temporary SQLite databases with the actual migrations. TypeScript source is transpiled for direct handler calls; only runtime configuration/database wiring is substituted. They are not browser tests and do not prove the UI renders correctly, browser cookie behaviour, or proxy networking.

| Suite | Decision | Reason |
| --- | --- | --- |
| integration | Keep in every CI run | Authentication, assignments, conflict checks, archive/reset transactions, deletion, personnel data and persistence. Broad coverage of the highest-cost failures. Its large single test is harder to diagnose; splitting it is a later maintenance task. |
| history-correction | Keep | Checks sealed records, attendance/service history, concurrency conflicts and preservation of live personnel status. |
| medal-management | Keep | Editing/retiring medal types must preserve existing awards and logs. |
| medal-migration | Keep | Real upgrade from older migrations, duplicate awards and uniqueness constraints. Important for migrating existing production data. |
| orbat-lock | Keep | Public/delegated write protection and persistence of locks. |
| deployment-boundaries | Keep | Actual origin rejection, host-only cookies, preview auto-renew suppression and maintenance guard. Rename the descriptive test later; its behaviour applies to PR previews as well as DEV. |
| secrets | Keep | Bootstrap secret-file and environment handling. Cheap regression protection. |
| snapshot | Keep | Uses real SQLite WAL, backup, restore and corrupt-backup rejection. |
| deployment-recovery | Replace | Tested the retired branch/local-registry shell implementation using a fake Docker CLI. Useful intent, obsolete execution path. New controller recovery tests cover the replacement. |
| github-config | Remove | Tested configuration generation for the retired fixed DEV/PROD scripts. No remaining caller. |
| controller Python tests | Add | Exact CI-run identity, fork/draft/author exclusions, API pagination failure, backup failure, failed candidate startup, failed smoke checks, interrupted deployment recovery and commit-before-interruption. Real orchestration with Docker calls substituted; live Docker still needs deployment acceptance checks. |

Measured in the available workspace with Node 24: original 18 tests passed in 10.10 seconds; retained 8 tests passed in 2.09 seconds; replacement controller tests take about 0.01 seconds excluding interpreter startup. These are local measurements, not GitHub runner performance promises.

CI now installs locked dependencies, runs the retained application and controller tests, runs `next build` once (including TypeScript validation), packages its standalone output, and smoke-tests the resulting container with a disposable database. There is no duplicate standalone typecheck, no second Next build inside Docker, no browser install, no matrix, and no production database in CI. The smoke script exercises health/revision, the home page, API, origin rejection, unauthenticated write rejection, login/cookie attributes and logout.

The source Dockerfile remains usable for local development and runs the production build. CI uses `deploy/runtime.Dockerfile` with its own allowlist Docker context to package the already-validated build.

Security scans and dependency changes should not add minutes to every app change. Dependabot groups monthly dependency/action updates. Enable dependency alerts and public-repository secret scanning/push protection in Settings where available. Review alerts; neither those controls nor a history reset substitute for rotating any leaked secret.
