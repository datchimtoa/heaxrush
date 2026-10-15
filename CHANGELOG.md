# Hexa Rush changes

Based on Hextris `master`, commit `8872ec47d694628e2fe668ebaa90b13d5626d95f`.
Original authors and GPLv3-or-later licensing are retained.

## chore: prepare the source repository for owner-managed deployment

- The owner authorized committing and pushing the game/service source to
  `https://github.com/datchimtoa/heaxrush`. Preserve upstream history and keep
  legacy ad removal in its separately labeled commit. No force push or hosting
  provisioning is part of this request.
- Added the modified-source link to player-accessible credits and portable clone
  instructions. Documented manual Render Web Service setup, private environment
  configuration and the blueprint's new-database warning; the blueprint itself
  is unchanged. Deployment and Telegram URL configuration remain owner-managed.
- Private `.env`, dependencies, preview state/logs and test artifacts stay ignored.
  The separate design-document repository is not included. Coin issuance and
  gameplay/auth/referral/schema/reward behavior are unchanged.

Validation: 191 tests passed, 2 disposable-PostgreSQL suites skipped; standalone
gameplay 15/15, JavaScript syntax and normal/genuine reduced-motion Firefox passed
against the Node preview. Browser identities/referrals remain transport fixtures,
not real Telegram launches. Candidate source passed the private-value/secret scan.
Private configuration and protected source checksums are preserved. Evidence is
in ignored `.test-artifacts/github-publish-*`. GitHub authentication is required
to upload; local commits alone do not establish remote publication or deployment.

## feat: Phase 2E local release checks and 00:00 UTC preview maintenance

- Added read-only release checks for configured migrations/disabled issuance and
  public/frontend/account/private-path/Origin boundaries. No real launches or
  synthetic players are submitted. Stable Render, backup/data selection,
  disposable integration and genuine Telegram/device tests remain open gates.
- Added development-only safe quick-tunnel renewal and one local **00:00 UTC**
  watcher. It validates a candidate before switching APP_ORIGIN, preserves other
  private bytes/0600, identifies owned processes, stores URL/state in ignored
  `.preview/`, and checks the restarted preview before stopping the old tunnel.
  A failed attempt restores the prior preview where possible; failures remain
  evidence, not successes. Concurrent renewals/watchers are rejected.
- Commands: `check:release`, `preview:renew`, `preview:watch`, `preview:status`.
  The watcher requires this host awake/running online; it is not a reboot service
  or guarantee against early tunnel expiry. No bot settings are automatically
  changed: the owner must update Telegram Main Mini App/menu URLs after rotation.
- Added the release operations runbook and scope/rule update in the master
  addendum. No gameplay, schema, auth/referral/reward-policy or Git changes.

Validation: 191 tests passed, 2 disposable-database suites skipped; 6 operations
and 15/15 standalone gameplay passed. A parallel rerun hit an HTTP fixture
timeout; sequential rerun passed. Normal and genuine reduced-motion Firefox
passed with fresh profiles after an initial startup failure. No live Telegram
launches or synthetic active-database records were used. All 22 public endpoint
checks passed with READ ONLY migration readiness; private/operations files stay
404 and the obsolete Origin returns 403. Syntax/whitespace/protected checks passed.

The initial preflight failed; another attempt hit preview shutdown timeout and
required manual recovery. The recovery gap/wait were corrected and a full renewal
then passed. Failed evidence remains under `.test-artifacts/phase2e-ops-*`.
New preview: `https://utils-friends-kept-documented.trycloudflare.com`.
Only APP_ORIGIN changed in private `.env`; other bytes/0600 preserved. The old
tunnel stopped after success. A single watcher is active with next renewal
2026-10-16 00:00 UTC, conditional on this host staying awake/online; no actual
future midnight or reboot persistence has been validated. Latest URL/state/logs
are in `.preview/`. Owner-managed BotFather URLs still need updating; stable
release gates and disabled issuance are unchanged. No commits/pushes.

## fix: use the owner's numeric Telegram ID in invitations

- The user clarified Telegram ID, not internal account UUID. New display links
  use `startapp=ref_<telegram-user-id>` from the authenticated owner's stored
  identity, including accounts with earlier published invites.
- Signed numeric launches resolve through `users.telegram_id` joined to a published
  invite. Old UUID/random-code links remain supported; stored codes and migration
  006 are unchanged. No new migration or historical referral rewrite.
- Client/Copy/Share validation and fixtures use numeric links and reject malformed
  or unsafe integers. Publication, new-account-only attribution, account isolation
  and signed launch validation stay intact. The shareable URL exposes its owner's
  Telegram ID by explicit request, never invitee identities or private histories.
- This supersedes the account-ID format described in earlier entries below.
  No earning or gameplay changes.

Validation: 185 tests passed, 2 disposable-PostgreSQL suites skipped; 19 focused
referral checks and 15/15 standalone gameplay passed. Normal and genuine
reduced-motion Firefox passed with numeric invite, full-link, Copy/Share and
account-isolation fixtures. Screenshots use a fixture ID/counts, not live players.
READ ONLY PostgreSQL checks covered current published owners, numeric/UUID/legacy
lookups, self exclusion and EXPLAIN without ANALYZE. No synthetic live data or
schema changes. Syntax/whitespace and protected-file checks passed. Only the
identified preview restarted; private configuration and the tunnel were unchanged.
Brief startup connection/502 responses recovered; local health/current assets are
200, unauthenticated referrals 401 and tested private paths 404. The retained
commission-fuel-labs-optimum tunnel has since expired (Tunnel not found, readiness
503, zero connections); public access is not restored. Evidence is under
`.test-artifacts/telegram-id-referrals-*`. Genuine Telegram invite checks and
stable hosting remain open; issuance stays false and no Git operations occurred.

## fix: make the full account-ID invite visible

- Rechecked current invite generation: published legacy-code accounts also receive
  UUID-based links, without rewriting stored codes or invalidating old invitations.
- Replaced the clipped single-line invite field with a wrapping, read-only field
  so the complete link is readable on phones. Copy/Share keep the exact URL.
- Added HTTP coverage for an existing legacy publication and exact UUID/link
  checks for normal/reduced-motion browser layouts and Telegram Share.

Validation: 184 tests passed, 2 disposable-PostgreSQL tests skipped; 15/15 gameplay.
Normal and genuine reduced-motion Firefox passed at phone/small-phone/landscape
sizes, with exact full-link and field-overflow assertions. The real published
invites were checked read-only without printing account IDs: legacy/new rows both
resolve to account-ID URLs. Browser referral counts remain transport fixtures.
The old tunnel had expired again; a registered/ready replacement is
`https://commission-fuel-labs-optimum.trycloudflare.com`. Only APP_ORIGIN changed
in private config; other bytes/0600, stored codes, schema, reward policy and
gameplay are preserved. The identified preview restarted; owner-managed Telegram
URL updates and genuine signed-invite validation remain necessary. Evidence is
under `.test-artifacts/referral-recheck-*`. Earning remains disabled; no Git actions.

## feat: account-ID invites and gameplay-oriented player wording

- New Telegram invite links use `startapp=ref_<internal-account-uuid>` instead of
  a separately generated random code. No Telegram IDs or unsigned `ref=` login
  fields are accepted. Explicit publication, signed new-account attribution,
  owner locks, existing-account exclusion and aggregate-only progress stay intact.
  Old shared codes still resolve; migration 006 and stored codes are preserved.
- Replaced player-facing verification, flag/backfill/entitlement and setup-policy
  explanations with short gameplay copy in Referrals, Tasks, Profile, About,
  pause and results. Loading is temporary; successful results say Score saved to
  your account, while failures say Score not saved and offer Retry saving.
- Friends joined / Played 3 games replace account-review labels. Invite share
  text focuses on playing together without promising rewards. Short inactive
  reward notices remain; draft Coin allowances are hidden while earning is off.
  Backend validation, scoring, privacy, reward policy and GPL access are unchanged.

Validation: 183 tests passed, 2 disposable-PostgreSQL suites skipped with
`TEST_DATABASE_URL` unset; 15/15 standalone gameplay and 12/12 final focused
referral/copy checks. Normal and genuine reduced-motion Firefox passed against
the updated Node preview at phone/small-phone/landscape sizes. A default-profile
recheck timed out at `session.new`; fresh separate profiles/ports passed, sequentially,
and test browsers were closed. Failed evidence is retained, not reported as success.
Authenticated browser data are transport fixtures, not real Telegram launches.
Actual summary/SELECT-only CTE progress passed in READ ONLY PostgreSQL; UUID and
legacy attribution/publication SQL passed EXPLAIN without ANALYZE. An initial
read-only check used the wrong migration-column name; the corrected check passed.
No test accounts/referrals/rewards were inserted, and no schema migration ran.
Syntax/whitespace/protected checks passed. The identified preview restarted;
private `.env`/0600 and the tunnel stayed unchanged. Local/public health/assets
are 200, unauthenticated owner APIs 401, tested private/backend/test/claim paths 404.
Evidence: `.test-artifacts/player-copy-*`. Earning remains false; no commits/pushes.
Real signed new/existing-account invites, device/audio and stable hosting remain
release gates; endpoint/fixture checks are not live Telegram or uptime validation.

## docs: proposed Phase 2E release readiness and temporary tunnel renewal

- Added a proposed next phase to the master delivery addendum: stable single-service
  Render hosting, database/backup selection, disposable integration tests and real
  Telegram login/invite/device/visual/motion/audio checks. Hosting/data/test access
  and consenting device testers are prerequisites, not assumed approvals. The
  Render blueprint's new database must not silently replace or split active data.
  No ads, wallets, reward activation, claims or new app features are implemented.
- Replaced the expired quick tunnel with
  `https://acquired-plates-election-base.trycloudflare.com`. Registered/readiness
  checks passed. Only APP_ORIGIN changed in private `.env`; `alodvipbot`, unrelated
  private bytes and 0600 permissions stayed intact. Only the identified Node
  preview was restarted; the obsolete tunnel was stopped after the new one passed.
  Read-only PostgreSQL confirms 001–006 already applied; no new migration needed.
- Public game/health/assets 200, unauthenticated owner APIs 401, foreign/old-Origin
  writes 403 and tested private/backend/package/test/artifact/claim paths 404.
  Empty launch data is rejected before writes. An earlier local health 503 passed
  on recheck; cause unestablished. No live login/new-account referral/device or
  uptime guarantee is claimed from these endpoint checks. No synthetic live
  writes, earning changes, commits or pushes. Runtime source is unchanged.
- Owner must update Telegram/BotFather's app/menu URL. Temporary access is not
  the stable Render release gate. Original product content/Answers/GPL/ad-removal
  entry are preserved; `next.md`, reward/Coins/replay source are unchanged.
  Evidence: `.test-artifacts/phase2e-tunnel-20261014-*`.

## chore: deploy approved non-paying referrals to the active preview

Explicit approval in `/home/devroom/hetris/next.md` authorized migration 006,
`TELEGRAM_BOT_USERNAME=alodvipbot` and the identified preview restart. The additive
migration and repeat migration passed; referral tables started empty. Migration
counts/constraints and actual owner-only summary SQL were checked read-only.
Existing account/auth/streak/game/Coin/entitlement counts were unchanged during
migration. No historical relationships, synthetic accounts, referral codes,
Coin payouts or entitlements were inserted. Earning issuance remains false,
unchanged; the reward policy/Coins/gameplay/replay modules were not edited.

Only the approved username was added to private `.env`; all other bytes and 0600
permissions were preserved. The initial preview start failed with a generic
dependency/configuration message; configuration and repeat migration checks
passed independently and a start retry succeeded. The cause was not established.
Local health returns 200 and referrals now returns 401 rather than the old 404
when unauthenticated; foreign-origin code creation returns 403. Private/backend/
test/artifact paths and claim routes remain 404. One later health request timed
out, then passed on recheck; failed evidence is not reported as success.

The full fixture suite was rerun: 179 passed, 2 disposable-PostgreSQL tests skipped
with `TEST_DATABASE_URL` unset; standalone gameplay 15/15. Never run the synthetic
integration/reward suites on active player data. Active schema/read SQL passed;
real attribution/code-creation statements were planned with EXPLAIN without
ANALYZE, not executed to create test relationships. Real signed-link attribution
for a genuinely new Telegram account remains unverified and needs a device test.
Normal and genuine reduced-motion Firefox passed again against the restarted
Node preview, using transport fixtures for authenticated referral/progress data.
Reviewed phone/small-phone/landscape screenshots, syntax and whitespace checks
passed. These do not establish live Telegram attribution or human verification.

The retained `affected-bold-suites-gratis.trycloudflare.com` quick tunnel now
reports `Unauthorized: Tunnel not found`, readiness 503 and zero connections;
public host resolution failed. The tunnel and APP_ORIGIN were intentionally
unchanged, so this is a working local backend deployment, not restored public
Telegram access. Renewal/stable Render hosting and owner-managed BotFather setup
remain separate. Evidence is under `.test-artifacts/referrals-deploy-20261014-*`.
No commits or pushes.

## feat: Phase 2D non-paying referrals (implementation checkpoint)

- Added empty migration 006 for one opaque random 128-bit invite code per owner
  and one prospective relationship per new invitee. The winning login upsert's
  generated UUID distinguishes new inserts from existing/concurrent accounts.
  Signed `start_param` is returned only after HMAC/age/identity validation and
  attribution shares the auth/streak transaction. No existing-account attachment,
  replacement, historical backfill, unsigned URL attribution or replay bypass.
- Added active-owner-only `POST /api/referrals/code` (exact Origin, `{}`, no query
  fields, 5/account/minute) and read-only `GET /api/referrals` (no query fields,
  20/account/minute). Codes are explicit/idempotent under the owner-row lock.
  One uncached snapshot recomputes active invited accounts and the lifetime
  three-game milestone from post-attribution unflagged current-rules finishes.
  No invitee names, IDs, game details or public account/code lookup are exposed.
- Referrals now has Create/Copy/Share, aggregate counts, selectable copy fallback,
  honest guest/loading/empty/error/retry states and stale/account isolation.
  Small-screen statistic labels wrap without horizontal overflow. Menus preserve
  safe areas, reduced motion, practice storage and gameplay/replay separation.
  Telegram links use the owner-confirmed `alodvipbot` environment setting, not
  preview origins. Main Mini App setup and signed invite delivery need device checks.
- No referral Coin amounts, claims, entitlements, payouts, risk qualification or
  future reward promises. Existing earning policy/Coins/rewards are unchanged;
  issuance remains false. No ads, wallets, withdrawals or Git operations.

Validation: 179 tests passed, 2 disposable-PostgreSQL tests skipped with
`TEST_DATABASE_URL` unset; 15/15 standalone gameplay tests. Normal and genuine
reduced-motion Firefox passed against the existing Node preview with transport
fixtures at 390×844, 320×568 and 568×320. Screenshots were reviewed. Earlier
browser attempts caught nowrap overflow; the narrow CSS fix was rechecked.
Actual summary SQL and SELECT-only eligibility/boundary fixtures passed inside
a READ ONLY PostgreSQL transaction. No synthetic live accounts/referrals or
reward data were written. Real concurrent-login/code/migration/rollback tests
are added but unrun; never point the disposable suite at active player data.

JS/CJS/MJS syntax and whitespace checks passed. Protected checksums preserve
private `.env`/0600, earning policy, replay/rules, next.md and original master
content/Answers. Evidence is under `.test-artifacts/referrals-*`. Migration 006
has NOT been applied to the active database, `TELEGRAM_BOT_USERNAME` has NOT been
added to private config and the preview/tunnel were NOT restarted. Real invites
remain unavailable pending separate deployment approval. Local/public health and
new static asset are 200; live referral API is still absent, not a tested success.
Only owned test browsers were stopped. Real Telegram launch/visual/motion/audio
checks and stable Render deployment remain open; earning gates are unchanged.

## feat: Phase 2C daily quest progress and validated-launch streaks

- Added authenticated, owner-scoped, uncached `GET /api/daily`, limited to
  20/account/minute. One snapshot derives 3 completed games, 800 points in one
  game and chain level 3 from today's finished, unflagged, current-rules runs
  of active accounts. Server finish time determines half-open 00:00 UTC days.
  Chain level 3 retains the existing 2× multiplier, not a 3× points multiplier.
- Added initially empty migration 005 for per-account login streak state.
  Validated Telegram login transactions record the day; validated same-cookie
  launch retries lock the active account and deduplicate with an atomic upsert.
  Consecutive days extend the streak; missed days reset the next visit to one.
  Older in-flight dates cannot roll state back. No historical visits are copied.
  Cookie/profile/Tasks reads, failed launches and guests do not record a visit.
- Tasks now offers Daily/Achievements sections with labeled native progress,
  login streaks, UTC reset labels, safe text and guest/loading/error/retry states.
  Account changes, hidden tabs and navigation clear daily reset timers and stale
  data. The visible reset uses server time and monotonic request latency, not the
  device calendar. Practice records/preferences and the arcade/gameplay UI remain.
- Quest/streak rewards are explicitly inactive. No claim/check-in endpoints,
  Coin payouts, reward entitlements or future rewards are promised. Existing
  gameplay/achievement earning remains disabled and unchanged, as requested.
  Reward-day UTC/payout/cap/human-bot risk approvals remain separate. No ads,
  referrals, wallets, private configuration changes, commits or pushes.

Validation: 162 tests passed, 1 disposable-PostgreSQL test skipped with
`TEST_DATABASE_URL` unset; 15/15 standalone gameplay tests. Normal and genuine
reduced-motion Firefox passed against the restarted Node preview, including
Daily/Achievements, UTC reset/visibility, account isolation, accessible progress,
streak controls and unchanged replay parity at 390×844, 320×568 and 568×320.
Screenshots were reviewed. Browser accounts/progress/streaks are transport
fixtures, not real Telegram launches. One reduced-motion browser session startup
timed out; a fresh-profile rerun passed. Failed logs remain separate.

Migration 005 and repeat migration passed without adding historical visits,
players, scores, Coins or entitlements; the streak table started empty. Actual
progress SQL and SELECT-only CTE fixtures passed in a read-only PostgreSQL
transaction. EXPLAIN without ANALYZE planned the real streak upsert; SELECT-only
transition fixtures passed. Disposable concurrent-upsert tests are added but
remain unrun on this host, never executed against the active player database.
Syntax/whitespace and protected checksums passed, preserving original master
content/Answers, private `.env` bytes/0600 and earning/replay configuration.

Only the identified Node preview was restarted after schema readiness; the
tunnel/private environment were unchanged. Local/public health/title/new assets
are 200; unauthenticated daily/achievements/standings/Coins are 401; tested
private/backend/package/test/artifact/claim/check-in paths are 404. Evidence:
`/home/devroom/hetris/hextris/.test-artifacts/phase2c-*`. Real Telegram-device
launch/streak/visual/motion/audio checks and stable Render deployment remain
outstanding. Earning stays disabled; reward-day/payout/cap/human-bot approval
gates are unchanged. No commits or pushes.

## feat: Phase 2B read-only verified achievement progress

- Added authenticated, uncached, per-account-rate-limited `GET /api/achievements`,
  with no account-selection fields or write/claim endpoints. One owner-scoped SQL
  snapshot reads finished, unflagged, current-rules sessions of active accounts;
  progress uses existing 500/1,000/2,000 score and chain-level-4 definitions.
- Tasks now presents readable milestone names, accessible progress bars and
  Reached/In progress states, plus loading/guest/error/retry handling. Only verified
  runs count, never device practice. Names/descriptions use safe text. Account
  changes clear progress, discard stale responses and reload if Tasks is open.
- Reached progress is not a saved reward entitlement and promises no payout.
  Progress recomputes after trusted flags. Historical reads never backfill rewards.
  No bonuses, claims, entitlement writes, schema changes or Coin activation.
  Daily tasks/streaks, referrals, ads and wallets remain outside this slice.

Validation: 145 tests passed, 1 disposable-PostgreSQL test skipped with
`TEST_DATABASE_URL` unset; 15/15 standalone gameplay tests. Normal and genuine
reduced-motion Firefox smoke passed against the Node preview; screenshots were
reviewed at 390×844, 320×568 and 568×320. Checks cover accessible progress,
decimal/exact thresholds, reached/zero/error/guest states, scrolling/control
reachability, safe text, account/stale-response isolation and replay parity.
Authenticated browser values are transport fixtures, not live Telegram logins.
Actual owner-scoped SQL and SELECT-only CTE fixtures passed in a read-only
PostgreSQL transaction without player, score, entitlement or Coin writes.
JS/CJS/MJS syntax and tracked diff whitespace checks passed. Original master
document/Answers, `next.md`, private configuration and reward-policy bytes were
preserved. Evidence is under `.test-artifacts/achievements-*`. Real Telegram
device/audio validation and stable Render deployment remain outstanding; payout,
reward-day and human/bot risk policy gates are unchanged. No commits or pushes.

Only the identified Node preview was restarted for the new API. Local health/new
assets are 200; unauthenticated achievements/standings are 401; claim and tested
private/backend/package/test/artifact paths are 404. Public quick-tunnel access
could not be reverified (connection unavailable). The existing tunnel process,
private configuration, schema, gameplay/replay and reward policy were unchanged.

## fix: game-style leaderboards and consistent Telegram usernames

- Replaced tiny leaderboard footnotes and oversized empty decoration with a compact
  trophy heading, Daily/Weekly selector, medal-colored ranks, readable names/scores,
  a highlighted You standing and a reachable refresh control. Ranking/reset/no-prize
  details remain available in Profile → Options → About. Practice records remain in
  Profile; no dashboard cards or gameplay overlays were added.
- Added shared display-only identity formatting for Profile, Connection and own
  standings. Confirmed Telegram `@username` takes priority; accounts without a
  username use their name privately. Other players see public usernames or stable
  anonymous fallbacks, never personal names, Telegram IDs or profile links.
- Leaderboard reads join current server-stored usernames in the same SQL snapshot.
  Signed login already updates handles; tests now cover changes/removal, fallback,
  safe text, account switching, outside-top identity and readable small-screen UI.

No scoring/replay, schema, Coin policy, private configuration or reward activation
changes. No commits or pushes.

Validation for this follow-up: 135 tests passed, 1 disposable-PostgreSQL test
skipped with `TEST_DATABASE_URL` unset; 15/15 standalone gameplay tests. Normal
and genuine reduced-motion Firefox smoke passed against the actual Node preview,
with screenshots reviewed at 390×844, 320×568 and 568×320. Checks cover verified
handles, private name fallbacks, safe text, account switching, own rank
inside/outside the slice, empty/error states, reachable controls and replay parity.
Authenticated browser scenarios use transport fixtures, not real Telegram logins.
Actual username-join SQL and SELECT-only CTE fixtures passed in a read-only
PostgreSQL transaction without writing records. JS/CJS/MJS syntax and whitespace
checks passed. Local health/frontend assets return 200, unauthenticated standings
401, and tested private paths 404. Only the identified Node preview was restarted;
the existing tunnel/configuration were unchanged. Evidence is under
`.test-artifacts/leaderboard-ui-*`. Real Telegram-device checks remain outstanding;
Coin issuance stays disabled. The 131-pass result below is the earlier baseline.

## feat: Phase 2A read-only verified leaderboards

- Added authenticated Daily top 50 (best score) and Weekly top 100 (total score)
  using server-finished, unflagged, current-rules sessions of active accounts.
  Rank/top rows use one database snapshot. UTC days and Monday-based weeks count
  by server finish time; ties share a rank with deterministic display ordering.
- Added an own-rank result outside the bounded top slice, stable anonymous player
  labels, per-account request limits and strict query validation. No Telegram
  identities, submitted scores or account-selection parameters enter standings.
- Replaced the unavailable Leaderboards screen with Daily/Weekly controls,
  loading/guest/empty/retry states, safe-text rows and account/request isolation.
  Practice storage, the plum game-first shell, safe areas and menu hiding remain.
- Updated the master product document with delivery status, the first retention
  slice, acceptance criteria and remaining retention/release gates. `next.md` was
  not used or modified for this continuation.

This slice has no leaderboard Coin prizes or earning-policy changes. No schema,
private environment, gameplay/replay or live player data changes; no backfill,
ads, quests, streaks, referrals, wallets, withdrawals, commits or pushes.

Validation: 131 tests passed, 1 disposable-PostgreSQL test skipped with
`TEST_DATABASE_URL` unset; 15/15 standalone gameplay tests. Normal Firefox smoke
passed against the actual Node preview, including leaderboard API fixtures,
safe text, own-rank/account isolation, empty/retry states, small-screen controls
and replay parity. Separate real reduced-motion smoke passed at 390×844, 320×568
and 568×320. Actual SQL and SELECT-only CTE fixtures passed in a read-only
PostgreSQL transaction; no synthetic active-database data was inserted. Syntax
and whitespace checks passed. Local/public health and frontend assets returned
200, unauthenticated standings 401, and tested private paths 404. Only the
identified Node preview was restarted; the existing tunnel/configuration were
unchanged. Evidence is under `.test-artifacts/phase2-*`. Device visual/motion/audio
checks and stable Render deployment remain outstanding; earning stays disabled.

## feat: plum-and-berry palette, colored icons and tab transitions

- Replaced the blue/navy presentation with a plum-and-berry backdrop, deep-plum
  board, pink borders and cohesive menu, result and pause surfaces. Browser theme
  metadata and supported Telegram native chrome match the `#301441` surround.
  Gold Play/score accents and all five gameplay colors, including purple, remain.
- Added colorful, locally drawn SVG navigation and feature icons, a pink Profile
  smiley and distinct Options, practice-records and Account Coins action icons.
  Wallet stays a separate, explicitly unavailable destination linked to read-only
  account Coins; no wallet, task, referral or earning features were activated.
- Added immediate navigation with 180 ms panel entrances and a 240 ms active-icon
  settle. Rapid switches cancel old panel motion; Home only fades so Play targets
  do not move. Reduced motion disables panel/icon animation and tab transitions;
  hidden documents do not start panel entrances. No new framework or remote assets.
- Extended navigation isolation tests, native-chrome expectations and responsive
  Firefox assertions. Added a separate reduced-motion Firefox profile using a
  real preference, and bounded state waits for asynchronous auth/Coins fixtures
  instead of fixed sleeps. Early-return cleanup still closes the browser/server.

This refresh is presentation-only. Gameplay rules, fixed ticks, replay, stored
records/preferences, backend/schema and earning policy remain unchanged;
`issuanceEnabled: false` is preserved. GPL credits and the separately labeled
original ad-removal entry remain intact. No commits or pushes were made.

Validation: 121 tests passed, 1 disposable-PostgreSQL test skipped with
`TEST_DATABASE_URL` unset; all 15 standalone gameplay tests passed. Normal Firefox
smoke passed against the actual Node preview using a fresh external test profile
after two default-profile startup timeouts. Separate reduced-motion smoke passed
at 390×844, 320×568 and 568×320, including early-return cleanup. Responsive
screenshots were reviewed for Home/Profile, feature menus, gameplay, pause and
results; small-screen Profile/Connection reachability and safe areas passed.
Native chrome/auth/Coins scenarios use API fixtures, not a new device login or
live reward test. All JS/CJS/MJS syntax and tracked diff whitespace checks passed.
Both local and current public preview health/pages/styles return 200; tested
private/backend/test/artifact paths return 404. No server/tunnel restart, player
data changes, earning activation or Git writes were made during this refresh.
Real Telegram-device visual/motion checks and audible playback remain outstanding.

## feat: Mini App navigation and player Profile

- Replaced the title's Records action with a separate Leaderboards destination;
  unavailable global rankings are labeled honestly, never populated from device
  history. Preserved all practice records under Profile → My practice records.
- Moved Options into Profile, alongside safely rendered authenticated identity,
  verified/practice best labels, device practice count, Connection/retry and Coins.
  Sound/music/haptics, Controls and player-accessible About/GPL credits remain.
- Added the requested Home/Tasks/Referrals/Wallet/Profile bottom navigation with
  labeled local SVG icons, current-page state, keyboard focus and 44px targets.
  Reserved safe-area-aware menu space; gameplay/pause/results have no bottom bar.
  Start now restores the full gameplay canvas before constructing the hexagon,
  avoiding menu-sized geometry on the first frame without changing replay rules.
- Tasks, Referrals and Wallet are explicitly unavailable destinations only. No
  task rewards, referrals, TON connection, withdrawals or fake balances/rankings.
  Wallet can open the existing read-only Coins view; Back returns to its parent.
- Added navigation/hierarchy/isolation tests and responsive Firefox checks for
  bottom bar bounds, all destinations, Profile/Options, stored practice history,
  safe-area sheets and uninterrupted deterministic replay. No backend/schema,
  earning-policy, live player data or Git operations changed in this UI pass.

Validation: 119 passed, 1 disposable-PostgreSQL test skipped with
`TEST_DATABASE_URL` unset; 15 standalone gameplay tests passed. Firefox passed
against the actual Node preview, including small-screen Profile actions and
Connection scrolling, visible-heading focus, pause/results bar hiding,
Wallet → Coins → Back, safe-area fixtures and deterministic replay parity.
JS syntax and diff whitespace checks passed; local health is 200 and private
paths are 404. Telegram/auth/Coins browser scenarios use fixtures; a real-device
menu check remains. Public tunnel health could not be reverified (fetch failed).
Live earning remains disabled; no server restart, commit or push was performed.

## feat: guarded gameplay earning accounting (activation blocked)

- Migration 004 adds explicit new-run eligibility, flag/reversal metadata,
  session-linked ledger entries and persistent one-time achievement entitlements.
  Old runs remain ineligible; no historical Coins or milestone backfill.
- Atomic verified-finish completion accounting credits exactly 10 with user/session
  locks, idempotent retries and ledger/balance/score rollback together. Exact
  achievement thresholds are tracked once; x4 is chain level, not a new points
  multiplier. No approved achievement payout policy exists yet, so no bonus payouts.
- Every backend earn checks the 200 all-source daily cap; gameplay/achievement
  sources share the 100 cap. Draft UTC gross earning totals never reopen after a
  debit/reversal. Old/disabled, invalid, flagged and blocked runs cannot earn.
- Trusted backend flagging appends idempotent reversals of linked earnings and
  invalidates the run's achievement entitlements, including on blocked accounts.
  No player mutation/moderation endpoint or admin dashboard was added.
- Options → Coins shows server-owned daily earnings and both remaining allowances,
  explicitly draft while issuance is disabled, with account-change cleanup and
  reversal-aware result text. Arcade play and practice isolation are preserved.
- Added reward/cap/reversal fixtures and browser display checks; expanded the
  disposable PostgreSQL integration suite without running it on active players.

Activation remains blocked: bonuses of 150/500 cannot fit the 100 gameplay cap.
Carry-forward, truncation/forfeiture or exemptions and the day boundary are not
approved. `server/REWARD_POLICY.md` documents implemented rules and open decisions.
No ads, wallet, withdrawals, referrals, leaderboard rewards or Git operations.

Validation: 113 passed, 1 disposable-PostgreSQL test skipped; 15 standalone
gameplay tests passed; Firefox passed against the Node preview; JS syntax and
diff whitespace passed. Migration 004 and its repeat check succeeded. Read-only
active-database checks confirmed no Coins/achievement entries or eligible runs.
The preview was restarted, tunnel left untouched; local health/private-file
blocking passed. Public health is unverified due to host DNS failure. No live
reward credits or disposable integration writes were made to player data.

## feat: Phase 1 Coins ledger foundation (issuance disabled)

- Migration 003 adds available/reserved balances, saved run awards and append-only
  ledger history with source/reference/reason and before/after balances. Existing
  accounts, runs and local records are preserved; no backfilled or welcome Coins.
- Backend-only earn/spend/hold/release/reverse operations use user-row locks,
  atomic insert/balance updates, bounded integer arithmetic and idempotency keys.
  Conflicting retries, insufficient balances and blocked accounts fail closed.
- Authenticated read-only Coins API has owner-scoped keyset pagination and one
  snapshot for balance/history. There is no client-facing mutation/claim route.
- Options → Coins adds an on-demand account balance/history menu, safe plain-text
  transaction rendering, refresh/older-history actions and account-change cleanup.
  Verified results show server-owned Coins; practice results do not. Arcade title,
  sound/music preferences and gameplay/replay are preserved; no dashboard added.
- Automatic issuance stays disabled: no exact completion rule/daily limit or
  additional human/bot risk controls are approved. No ads, wallets, purchases,
  withdrawals, achievements, quests, referrals or leaderboard rewards were added.

Real Telegram players and finished official runs are present in PostgreSQL
(checked read-only without exposing identities/scores). This is not a security
audit or proof of human play. Test rewards use fixtures only.

## fix: Telegram launch detection and verified account connection

- Recognize Telegram launch version/platform markers and official SDK-restored
  same-tab parameters instead of silently leaving those launches as guests.
  Empty initData explains supported bot launch buttons; no unverified profile
  is displayed or used for authorization.
- Keep concurrent login retries on one request. Confirm the matching server
  cookie session before showing the authenticated name, Telegram ID and username.
- Distinguish missing backend configuration, app-origin mismatch, invalid/expired
  launch data, cookie failure, SDK/network errors and rate limits in Connection.
  No raw initData, bot tokens or database credentials appear in diagnostics.
- Pending/failed Telegram login offers explicit device-only play rather than
  silently starting practice. Existing local records/preferences remain separate.
- HTTPS previews use secure partitioned cookies, not local-HTTP cookie settings.
  Health reports unconfigured if either the bot token or PostgreSQL is missing.
- Added launch/reload, signed-data forwarding, session confirmation, error/retry,
  cookie/origin and explicit-practice regression coverage, with Firefox fixtures.

PostgreSQL is now connected and migrations 001/002 passed, including a repeat
idempotency check. The active private configuration is the game-directory `.env`,
not the workspace-root `.env`; both files have owner-only permissions. The
current HTTPS preview origin and bot token are configured, and the preview server
has been restarted to load them. Live Telegram login/scoring remains unvalidated.
No test accounts or fabricated scores were inserted. No Coins, rewards, commits
or pushes were added.

## fix: device-review rendering, first-play guide and quieter menus

- Reviewed the two Telegram screenshots from the product repository. Removed
  title practice/help/microcopy clutter and the gameplay login-warning overlap.
  Connection details stay in Options; run verification status stays in Pause
  and results. No bottom navigation or account/reward feature was added.
- Replaced the per-frame full-screen gradient/stars with a static CSS backdrop;
  removed tile blur/clipping/gradients while retaining colored bevels. Capped
  canvas density at 2× and stopped rewriting unchanged HUD values. Rotation
  easing now follows elapsed presentation time, not frame rate or rush speed.
- Added a dismissible first-Play guide that responds to rotation and matching,
  expires after unpaused play time and persists dismissal on this device.
  Removed repeating beginning-of-run text; Controls remain available on demand.
- Clearly labeled persistent Vibration and Music switches in Options and Pause.
  Vibration now defaults off for new players, alongside sound and music; saved
  choices and completed records are preserved. Music-off survives resume/reload.
- Added regression coverage for first-run persistence, quiet defaults, paused
  controls, reduced-motion/refresh-rate easing, cheap tile rendering, mobile
  safe-area layouts and unchanged deterministic server replay.

This is not a real-device performance guarantee or live authentication/database
validation. No gameplay/scoring rules, Coins, GPL notices, commits or pushes changed.

## fix: stronger arcade contrast and Telegram preview layout

- Replaced the muted blue-purple skin with saturated arcade blue, a dark navy
  board, white scores and gold accents. Reduced broad pale tile highlights and
  removed the faded outer title ring while keeping the five gameplay colors,
  including purple `#9b59b6`. Official Block Blast! store screenshots informed
  contrast/hierarchy only; no third-party artwork or assets were copied.
- Matched supported Telegram native chrome colors, handled stable viewport
  changes, and combined device/content safe areas on all four edges. Canvas
  scaling and tap coordinates use the visible board bounds, not screen edges.
  Native listeners are installed once across authentication retries; optional
  color methods are version-gated and cannot block authentication on failure.
- Added presentation unit tests and Firefox native-API layout fixtures, and
  documented allowlisted temporary tunnels and current BotFather setup.

This is presentation/preview work, not live Telegram/PostgreSQL validation.
Scoring, seeded RNG, fixed ticks, completed records and GPL attribution remain
unchanged. No Coins, rewards, commits or pushes were added.

## feat: jewel-arcade polish and optional original music

- Added softly lit, beveled jewel blocks, a blue-purple arcade backdrop, warm
  dimensional buttons, bolder title lettering and cohesive menus/results.
- Added bounded clear sparkles, short combo callouts, a score pop and rotation
  glow, without using gameplay RNG or changing rules, scoring or fixed ticks.
  Reduced motion suppresses particles/glows/shakes and keeps callouts stationary.
  Pausing/help clears effects; title/menu animation never advances gameplay.
- Added original locally synthesized Chill and Rock music, an explicit selector
  and volume control in Options, independent of sound effects. Both audio modes
  default off. Existing sound/haptics preferences and practice records survive.
- Music requires a user interaction and runs only during gameplay; it stops on
  pause, instructions, hidden tabs, results and title. Oscillators/timers are
  released, and delayed schedulers do not burst old notes. No music files,
  streaming, external dependencies or third-party tracks were added.
- Extended audio/preferences/effects tests and desktop/mobile Firefox checks,
  including deterministic Firefox/server replay with presentation enabled.

Live Telegram/PostgreSQL integration remains unconfigured and unvalidated.
No Coins, rewards, commits, pushes or deployment are part of this pass.

## chore: remove original Hextris ad script

- Removed the `https://hextris.io/scripts/a.js` script tag from `index.html`.
- Removed the dynamic `http://hextris.io/a.js` loader from `js/main.js`.
- No replacement ads or reward integrations were added.

This removal was applied separately before the gameplay and interface edits.
No Git commits or pushes have been made.

## feat: begin Hexa Rush playable remake

- Rebranded the game and replaced the menus, help, HUD, and result screen.
- Removed the inherited `hextris.io` GitHub Pages domain configuration; no
  deployment domain is configured for Hexa Rush yet.
- Added purple (`#9b59b6`) as the fifth gameplay color.
- Applied the approved group scores and capped combo multipliers.
- A chain consists of clears less than five gameplay seconds apart. Its entire
  accumulated base score uses the highest combo multiplier reached; each clear
  awards only the difference from the previous chain total. A gap of five or
  more gameplay seconds resets the chain. Paused time does not count.
- Saved scores use separate Hexa Rush storage keys so old Hextris scores are
  not mixed with the new scoring model.
- Removed inherited analytics and the external score-submission request.
- Added dependency-free Node.js tests and a Firefox WebDriver BiDi smoke test.

This is an offline practice client. Telegram authentication, authoritative
server scoring, PostgreSQL, and the Coins ledger are not implemented yet.

## feat: Telegram authentication foundation

- Replaced the author list in the help screen with a compact Credits & license
  link. All authors and original copyright/license notices remain accessible
  in `credits.html`, the README, and the GPL license; no relicensing occurred.
- Added Node.js/Express and PostgreSQL authentication, versioned migrations,
  environment configuration, and a Render blueprint for one web service plus
  its PostgreSQL database. No deployment or GitHub push was performed.
- Validates Telegram `initData` HMAC, timestamp freshness, and signed user
  data server-side. Reused launch data cannot mint a second login session.
- Stores random login-session token hashes, not plaintext tokens; enforces
  expiry, revocation, account status, request limits, and same-origin writes.
- Production session cookies are Secure/HttpOnly, SameSite=None and Partitioned
  for Telegram Web embedding, with explicit Origin checks for state changes.
- The Node server exposes only frontend assets, not backend files or secrets.
- Replaced one vendored jQuery event-support probe with property detection so
  it does not inject inline event handlers blocked by Content Security Policy.
  The original library copyright is preserved; no unsafe-inline script bypass
  was added to the policy.
- Ordinary browsers remain local practice and do not load the Telegram SDK.
  In a Telegram launch, the official SDK is loaded and raw `initData` is sent
  to the same-origin API. Failed authentication does not stop practice play.

This milestone implements identity only, not server-authoritative game sessions,
official scoring, or Coins. Live Telegram login still requires a bot token,
PostgreSQL database, HTTPS deployment, and testing in real Telegram clients.
The real-PostgreSQL test is opt-in with `TEST_DATABASE_URL`; mocked store/HTTP
tests must not be mistaken for a live database integration test.

## feat: player hub and run feedback

- Replaced the single-screen introduction with Home, Activity, and Settings.
  Added an illustrated play card, real local stats, recent runs, connection
  status, help access, and a compact navigation bar. No fake wallets, Coin
  balances, leaderboards, or reward screens were added.
- Kept bottom navigation outside the scrolling content, so it does not cover
  stats, settings, or legal links on small and landscape screens.
- Tracks the last 20 completed practice runs and lifetime local aggregates.
  Results include blocks cleared and unpaused run duration, which is unaffected
  by the rush key. Duplicate result rendering does not record a run twice;
  restarts, refreshes, and abandoned runs do not create completed records.
- Preserves existing personal bests. History and preferences use separate
  Hexa Rush keys and do not read upstream Hextris data. Blocked/full storage
  displays a session-only warning while keeping the game playable.
- Added optional short Web Audio cues and supported-device haptics, with
  persistent switches. Sound is off by default and activated by user gesture;
  no remote audio, assets, or new libraries are required.
- Displays only API-verified Telegram profile information using text, never
  HTML. Login errors clear the profile display and offer retry; local records
  are never associated with that identity or considered official.
- Added player-record/audio tests and expanded the Firefox smoke test for
  real pointer navigation, populated/empty history, preference persistence,
  focus restoration, mobile layouts, blocked storage, and safe account names.

This is a player-experience pass, not a completed live rewards product. No
server-authoritative gameplay, scoring, Coins, deployment, or Git operations
were added in this change. GPL notices and the earlier ad-removal entry remain.

## feat: game-first arcade presentation

- Replaced the Home/Activity/Settings dashboard cards and bottom tabs with a
  full-screen title scene: HEXA RUSH, a gently rotating five-color hexagon,
  personal best, and one prominent Play button. No framework or remote assets.
- Records and Options are secondary game menus. Existing run history, totals,
  preferences, and connection status are preserved. Back/Escape returns to
  Play; the pause menu can abandon a run and return to the title without saving.
- Simplified the HUD to scores and circular game controls; updated Pause and
  Game Over styling to match the arcade title scene.
- Removed legal links from the title screen, playfield, and instructions.
  Credits & license are still accessible to all players in Options → About;
  no admin-only restriction, removal of notices, or license change was made.
- The title animation is decorative, does not simulate a real run, stops in
  menus/hidden tabs, and honors reduced-motion preferences. Tests check that
  it cannot change scores, clocks, spawns, or completed-run counts.
- Expanded Firefox checks for title/menu bounds, tiny landscape screens,
  About access, pause-to-title, and existing persistence/controls regressions.

This changes presentation, not the backend milestone. Scores remain local
practice, no official gameplay sessions or Coins were implemented, and no
commits, pushes, deployment, or admin panel were created.

## feat: authoritative game sessions and scoring

- Added versioned 60 Hz fixed-tick simulation and seeded spawn generation shared
  by browser prediction and Node replay. Physics now uses logical coordinates,
  independent of viewport size/render rate. Moved block initialization/deletion
  progress out of rendering; corrected inward collision projection and applied
  the same five-tick rotation limit on all devices. Kept approved scoring.
- Added PostgreSQL migration `002_game_sessions.sql` for session lifecycle,
  input logs, idempotent batches, server-owned checkpoints, and official user
  aggregates. Existing practice records/preferences are preserved and separate.
- Added authenticated start/events/finish/abandon APIs. Server issues seeds,
  replays only accepted inputs, validates ownership/order/timing/rate/lifetime,
  and permits a finish only after simulated overflow. Clients cannot submit a
  score, reward, spawn, seed, or snapshot. Finishes/totals are transactional and
  idempotent, including concurrent finish retries.
- Connected Telegram Play to official sessions; guests remain local practice.
  Official results are provisional until API confirmation. Connection failure
  pauses play, retains exact batches for retry, and never silently fabricates a
  verified result. Local and official bests are not mixed.
- Added replay, SQL-fixture, HTTP, and client transport tests; expanded the
  opt-in real PostgreSQL test for migrations/finish concurrency. Firefox tests
  compare an actual browser run with Node replay and exercise official client
  batching using transport fixtures, not production credentials.

No real Telegram token or PostgreSQL is configured; live authentication/database
and Render integration still need validation. Replay is not bot detection: the
visible seed and valid event stream can be automated. No Coins ledger/rewards,
ads, wallet, withdrawals, referral/leaderboard rewards, or Git operations were
implemented. GPL notices and the separately labeled ad-removal entry remain.