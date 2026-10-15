# Phase 2E: release readiness and preview operations

This is operations tooling, not a completed production release. Coin issuance
remains disabled. Never run disposable integration suites against active players.

## Available checks

From `/home/devroom/hetris/hextris`:

```sh
env -u TEST_DATABASE_URL npm test
node --test /home/devroom/hetris/hextris/tests/game.test.cjs
npm run check:release -- https://your-approved-origin.example
```

The release checker reads configuration privately, uses a READ ONLY PostgreSQL
transaction to require all local migrations already applied, and checks health,
public assets, unauthenticated account APIs, exact-Origin rejection and private
paths. Its only POSTs contain deliberately empty invalid launch data, which must
fail before account/streak/referral writes. It sends no player cookie, bot-token
API calls, authentic launch data, reward claims or synthetic users. No migration
or reward activation is performed. Results are automated boundaries, not device,
human/bot, backup or uptime validation.

## Disposable PostgreSQL CI

`.github/workflows/release-checks.yml` runs on pushes to `main`, pull requests
and manual dispatch. Its Node 22 job runs fixtures/gameplay, syntax and commit
whitespace checks. A separate Ubuntu job creates a fresh PostgreSQL 16 service,
waits for `pg_isready`, then runs both real database suites sequentially. Each
suite creates a random schema, applies/repeats all migrations and drops its schema
in `finally`. GitHub removes the job's service afterward. There are no persistent
volumes, production secrets, Render connections or deployment steps. The public
`local_ci_only` password authenticates only this throwaway test service.

`npm run test:postgres` does not load `.env`, and fails rather than silently
skipping when `TEST_DATABASE_URL` is missing. It refuses remote hosts, query-string
connection overrides, other database/user names, or populated `DATABASE_URL` or
`TELEGRAM_BOT_TOKEN`. It accepts only a deliberately created loopback database
named `hexa_rush_ci`, accessed by user `hexa_rush_ci`. This name/host check is a
safety guard, not proof of isolation: never point it at an existing player database.
No local PostgreSQL/Docker installation or active database is used to emulate CI.

The workflow uses `contents: read`, SHA-pinned official checkout/setup actions,
no persisted checkout credentials, no secrets/variables or privileged PR trigger,
and a ten-minute job limit. It never starts the production server or enables
rewards. Database fixtures explicitly exercise accounting in an isolated store;
passing them does not approve live Coin issuance or human/bot controls.

Verify the **Disposable PostgreSQL integration** job for the exact pushed commit
in GitHub Actions. A workflow file, local fixture pass or skipped database test
is not an integration pass. Failures must remain visible and be fixed, not hidden
by weakening production constraints. This slice also records the previously
unrun referral fixture's flag reason to satisfy migration 004's paired flag fields.

### Verified automated gate — 2026-10-15

[GitHub Actions run 38735513217](https://github.com/datchimtoa/heaxrush/actions/runs/38735513217)
completed successfully for `ede1930ee0094524678a48c61d3f8de3143a830a`:

- **Disposable PostgreSQL integration:** both real suites passed (2 passed,
  0 failed, 0 skipped). They cover repeated migrations, auth/streak lifecycle,
  authoritative scoring/read models, ledger concurrency and rollback, and
  competing referral logins/publication, compatibility and flagged progress.
- **Node 22 unit, gameplay and syntax:** unit/fixture tests, 15 standalone
  gameplay tests, JavaScript syntax and actual commit whitespace all passed.
- Fresh local validation passed 196 tests, with only the two disposable suites
  skipped locally; standalone gameplay passed 15/15 and all 71 JS/CJS/MJS files
  passed syntax checks. Local Node is 24; CI uses the pinned Node 22.22.0.
- The public Render boundary check passed 22 endpoints using no player cookie
  or valid launch data. No active player database was used for integration tests.

The initial [run 38733727302](https://github.com/datchimtoa/heaxrush/actions/runs/38733727302)
for `90a299a` passed PostgreSQL/unit/gameplay but failed whitespace because the
default shallow checkout treated inherited files as a root-tree addition. The
unit checkout now fetches two commits; local shallow-clone reproduction confirms
depth 1 fails and depth 2 checks the actual change successfully. The failure is
retained, not reclassified as a successful full run. No inherited source cleanup
or production constraint changes were needed.

This closes the previously unrun disposable integration gate, not Phase 2E's
remaining real-device, production database/backup or sustained-uptime gates.
Validate each later publication's exact-commit run too. CI has no deployment
step; GitHub publication alone does not confirm a new Render deployment. Coin
issuance, earning-policy approvals and human/bot risk controls are unchanged.

The owner reports `https://hexarush.onrender.com` and **@hexarushbot**; the
Referrals redesign is publicly visible and health returns 200. This confirms
public delivery only. Production private configuration, database continuity,
backups, sustained operation and genuine Telegram/device evidence remain separate.
Do not copy the older local preview's bot token or tunnel origin into Render.

## Automated Firefox gate and genuine-device handoff

The Release checks workflow also runs **Firefox normal and reduced motion** on
an Ubuntu 24.04 hosted runner with Node 22.22.0 and the image's Firefox version
(printed in the log). It runs the full normal smoke suite followed by the real
`ui.prefersReducedMotion=1` suite, sequentially on their separate profiles. The
temporary Node service uses the actual frontend allowlist/security headers but
has empty database/token/username settings; it starts directly without `.env`
loading. The shell exit trap stops only that job's server. No live credentials,
player data, production origin, schema changes or service restarts are involved.

Both modes must pass without suppressing errors. The job uses Bash pipefail so
writing logs with `tee` cannot hide a failed test. Only top-level fixture PNGs
and the named normal/reduced/service logs are uploaded, including after failure,
with seven-day retention. The upload explicitly includes the hidden artifact
directory, **not** its browser profile subdirectories or arbitrary private files.
Do not broaden it to upload `.test-artifacts/`, `.preview/` or the repository.

Local pre-publication validation passed both modes sequentially against the
isolated Node service, 197 unit/fixture tests (two disposable database suites
skipped locally), 15 standalone gameplay tests and all 71 JavaScript syntax
checks. Fixture screenshots were reviewed. Managed browser profiles are fresh
per invocation, and cleanup waits for the owned child to close. A missing-browser
failure-path check also confirmed an error exit, not a wait on a nonexistent PID.

Verify the exact pushed commit's third job; workflow presence or a local pass is
not proof of hosted Firefox success. Screenshots and API values use synthetic
fixtures, not real Telegram launches/referrals. Offline Web Audio samples do not
verify device speakers. See [TELEGRAM_ACCEPTANCE.md](TELEGRAM_ACCEPTANCE.md) for
the controlled genuine-new-account invite, existing-account exclusion, login,
score-saving, UTC/multi-day streak and device/motion/audio checks, plus private
evidence and database/backup/uptime sign-off. Those gates remain pending until
actually observed and approved. Coin issuance and all earning blockers remain.

## Temporary quick-tunnel renewal

```sh
npm run preview:renew
npm run preview:status
```

`scripts/preview-tunnel.cjs` manages **only this development preview on port 8001**.
The first run adopts the already identified server/tunnel from their recorded PID
files; `/proc` start time, arguments and working directory prevent unrelated PID
reuse. Subsequent operations use ignored `.preview/state.json`. Operation locks
reject concurrent renewals/watchers. Never edit this state to point at another app.

Renewal verifies config/database readiness first, opens a candidate tunnel, checks
its readiness/public boundaries, changes only APP_ORIGIN in the 0600 `.env`,
restarts the identified preview and rechecks public boundaries. The old tunnel
is stopped only after success. Failure before activation restores the prior
origin/server where possible and leaves failure evidence; failed cleanup needs
manual review, never a blanket process kill. No new schema or fake player data.

Successful state and URL are saved in:

- `/home/devroom/hetris/hextris/.preview/state.json`
- `/home/devroom/hetris/hextris/.preview/current-url.txt`
- Dated server/tunnel logs in the same ignored, non-public directory.

These files and all scripts remain outside the frontend allowlist. Never publish
private logs, configuration or process state through a generic root static server.

## User-requested 00:00 UTC rule

Run one persistent local watcher:

```sh
cd /home/devroom/hetris/hextris
nohup node scripts/preview-tunnel.cjs watch > .preview/watcher.log 2>&1 < /dev/null &
```

The watcher renews at **00:00 UTC**, regardless of the host's local timezone.
A persisted successful renewal date prevents extra renewals during the same UTC
day. Missing a day while asleep triggers one catch-up on wake; failed attempts
retry after five minutes. This is a foreground/background host process, **not**
cron, systemd, a cloud schedule, a wake lock or a reboot service. The host must
stay awake/running with network access. It cannot operate while this machine is
off, and a reboot requires restarting the watcher. Early tunnel expiry can still
require `npm run preview:renew`; daily recreation is not an uptime guarantee.

To stop it, identify the watcher using its `.preview/watch.lock` PID and exact
command before sending SIGTERM; never kill all Node/cloudflared processes.

Every new quick URL still needs the owner to update **@alodvipbot's Main Mini
App URL in BotFather**, plus the menu button URL, and reopen the Mini App. The
watcher does **not** change Telegram configuration, send messages, or claim that
regenerating a tunnel automatically makes an old bot button usable. Referral
links remain `https://t.me/alodvipbot?startapp=ref_<telegram-user-id>`; they do not
embed the changing preview hostname. Existing open app tabs/runs can disconnect
during origin rotation; don't schedule this on a production service.

## Pending stable release gates

1. **Hosting approval/access:** select one Render Web Service, stable HTTPS origin
   and service/project access. No Render credentials or service are assumed.
2. **Data/backup approval:** choose the existing database or explicitly approve a
   migration and backup/restore plan. `render.yaml` declares a new database; do
   not blindly apply it and split/replace existing players. Select DATABASE_URL
   privately and retain verified TLS. No data export/transfer/restore is approved.
3. **Disposable integration:** require a successful isolated PostgreSQL CI job for
   the release commit, covering migration, concurrency and rollback suites. If CI
   cannot run, supply a separately approved disposable database. A skipped/failed
   test is still a pending gate. Never aim synthetic tests at active players.
4. **Genuine Telegram testers:** an existing player and a consenting never-before-
   registered account must check signed numeric invites, immutable new-account-only
   attribution and post-attribution three-game aggregate progress. Do not delete
   users or manufacture signed launch data to simulate this.
5. **Device/operations evidence:** real login, scoring/retries, streak day changes,
   safe areas, reduced motion and audible music checks, plus approved stable-host
   restart and rollback procedures. Browser fixtures cannot close these gates.

No ad integrations, wallet/withdrawals, reward claims, earning changes or Git
operations follow automatically from this phase. Resolve the separate cap/payout,
reward-day and fraud decisions in `server/REWARD_POLICY.md` first.