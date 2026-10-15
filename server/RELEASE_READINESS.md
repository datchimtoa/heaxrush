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
3. **Disposable integration:** supply an isolated TEST_DATABASE_URL for migration,
   concurrency and rollback suites. A skipped test is still a pending gate. Never
   temporarily aim these synthetic tests at the active database.
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