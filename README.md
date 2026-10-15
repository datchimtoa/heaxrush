Hexa Rush
==========

A five-color hexagon puzzle remake of Hextris. **Rotate. Match. Earn.**

Source: <https://github.com/datchimtoa/heaxrush>. This is the game/service
repository; private environment files, preview state and test artifacts are not
included. Original Hextris attribution and GPLv3-or-later licensing are retained.

## Play locally

```sh
git clone https://github.com/datchimtoa/heaxrush.git
cd heaxrush
npm ci
npm start
```

Open <http://localhost:8001>. No frontend build is required. Without a database
and bot token, the Node server serves practice mode and disables authentication.
Use the Node server rather than serving the entire repository: backend files
and any local `.env` must not be exposed through a generic static server.

- Click **Play**, or press Enter from the title screen.
- Rotate with left/right arrows, A/D, the onscreen buttons, or by tapping either
  side of the board. Hold down-arrow/S to accelerate; Space/P pauses.
- Match three or more touching blocks; do not overflow the outer hexagon.
- Use **Play again** after a run. Best scores are saved on this device.

## Current scope

This version supports **local practice** and **authenticated, server-verified
runs**. It includes five colors (purple `#9b59b6`), revised scoring, combos,
an arcade title screen, and a results screen. Verified play requires Telegram
authentication and a configured PostgreSQL backend. An account Coins ledger
is implemented; automatic Coin earning is deliberately disabled.
The next earning phase adds guarded completion accounting, achievement tracking,
cap checks and flag/reversal support. It is not activated: achievement payouts
conflict with the daily gameplay cap and require an explicit policy decision.
See the reward policy section below.
Refreshing ends the current run. Old Hextris storage is not read or changed.

### Game menus and feedback

- **Title screen:** the hexagon playfield is visible immediately, with a large
  Play button, personal-best score and Leaderboards button. A five-tab bottom bar
  provides **Home, Tasks, Referrals, Wallet, Profile**. There are no dashboard cards;
  the bar hides completely during play, pause, help-from-play and results. The
  decorative board rotates gently without spawning blocks,
  advancing gameplay clocks, or recording runs. It stops rotating when reduced
  motion is enabled and stops redrawing in menus or hidden tabs.
- **Leaderboards:** authenticated, read-only Daily (best score, top 50) and Weekly
  (total score, top 100) standings from finished, unflagged, current-rules server
  sessions of active accounts. Own rank appears even outside the top slice. UTC
  days and Monday-based weeks use server finish time; ties share a rank. Public
  Telegram usernames identify players, with stable anonymous labels if unavailable;
  private names/Telegram IDs/profile links are never exposed to other players. Guests, empty periods and failed
  loads have honest states, never practice history or fabricated ranks. No Coin
  prizes, settlement jobs or reward claims are enabled.
- **Profile:** verified Telegram `@username` (full-name fallback) and verified best, or explicit guest
  identity/practice best. Device practice counts remain labeled and isolated.
  Profile contains Options, My practice records, Account Coins and Connection/retry.
  The same display-name helper powers Profile, Connection and your own leaderboard
  rows. Names are safe text from the authenticated API, never `initDataUnsafe`.
  Leaderboards use bold rank badges, segmented Daily/Weekly controls, larger scores
  and a highlighted You row. Technical ranking/reset/no-prize details live in
  Profile → Options → About, not in tiny footnotes on the game screen.
- **Profile → My practice records:** the last 20 completed practice runs, with score, blocks cleared,
  best combo, date, and unpaused time played. Aggregate totals include older
  completed runs, even after they leave the 20-entry history.
- **First Play:** a small, dismissible live guide reacts to the first rotation
  and match, then disappears. It never repeats on later runs or reloads on this
  device. If storage is blocked, dismissal lasts for this visit only. Controls
  remain available on demand in Options or Pause; no repeated title/HUD prompts.
- **Profile → Options:** persistent sound, music and vibration switches, an optional Chill/Rock
  soundtrack and music volume, instructions and expandable About.
  Credits & license remain player-accessible
  through **Profile → Options → About**, not on the title screen, HUD, or instructions
  and not restricted to an admin. Sound, music and vibration default to off for
  new players. Existing explicit choices are preserved; vibration depends on
  device/browser support. Connection warnings live in Profile, not over the score.
- **Profile → Account Coins** (also Options → Coins): authenticated account balance and paginated transaction
  history, fetched on demand from the server. Guests see launch guidance, not a
  fabricated zero balance. There is no functional wallet or dashboard.
  Server-owned gross earnings and remaining gameplay/all-source allowances are
  shown with a draft UTC day label; disabled allowances are not claimable rewards.
- **Tasks → Achievements:** account-only, read-only progress toward scores of
  500/1,000/2,000 in one verified run and chain level 4 (2.5× points, not a 4×
  multiplier). Finished, unflagged, current-rules sessions of active accounts
  determine progress; device practice never counts. Progress is recomputed on
  opening/refresh and can decrease after a flag. Guests see Telegram launch
  guidance, not invented progress. Reached milestones are display-only: no
  saved reward entitlement, bonus amount, claim or future payout is promised.
- **Tasks → Daily:** server-derived progress for 3 completed verified games,
  800 points in one game, and chain level 3 (the existing 2× multiplier).
  Daily/Achievements controls keep both views in the existing game-first shell.
  Quest days reset at 00:00 UTC by server finish time. A server-relative reset
  refreshes visible progress; returning from a hidden tab reloads it. Only
  finished, unflagged, current-rules runs of active accounts count, never practice.
  Login streaks count one validated Telegram launch per UTC day. Same-day launches
  are idempotent; consecutive days extend it and a missed day resets the next
  visit to day 1. Tracking starts at release, with no reconstructed past visits.
  A clear notice states quest/streak rewards are inactive, progress is not
  claimable and no entitlement is created. Existing earning configuration is
  preserved: gameplay/achievement Coin issuance is currently disabled, unchanged.
- **Referrals:** authenticated invite creation, Copy/Share and private aggregate
  counts for active new invited accounts and accounts reaching 3 verified games.
  Only signed first-login launch data can attach a new account to one referrer.
  Existing accounts cannot be attached later. No rewards, claims or backfill.
- **Wallet:** unavailable; no TON connection, withdrawals, conversion promises
  or reward activation. Wallet links to the
  existing read-only account Coins screen, without equating Coins with money.
- **Game Over:** score, personal best, highest combo, blocks cleared, and time
  played, with replay and return-to-title actions. A run is recorded once on
  overflow. Restarted, abandoned, and refresh-ended runs are not counted.
  Official runs show a provisional result until the server confirms the score.
  Failed verification has an explicit retry, not a successful-looking result.
- The jewel-arcade skin adds beveled blocks, a plum-and-berry backdrop (`#301441`
  surround and matching Telegram chrome), a deep-plum playfield, gold dimensional
  buttons, clear sparkles, score pops and combo callouts. Colored local SVG icons
  distinguish Home (gold), Tasks (mint), Referrals (peach), Wallet (cyan) and
  Profile (pink smiley), with matching feature and Profile-action icons.
  Effects are bounded and presentation-only: they never consume gameplay RNG,
  modify scores, or advance simulation ticks. Reduced motion disables sparkles,
  rotation glows and shakes; callouts fade without moving. Pausing/help clears
  transient effects, and a new run always starts clean.
- Menu changes show one destination immediately, with a 180 ms entrance and a
  240 ms active-icon settle. Rapid switching cancels the previous panel animation;
  Home only fades, never moving Play targets. Reduced motion disables panel/icon
  animations and tab transitions, and hidden documents do not start panel motion.
  Wallet stays separate from read-only account Coins; no unfinished feature or
  reward policy is activated by the refresh.
- Rendering uses a static CSS backdrop, blur-free beveled tiles, a 2× maximum
  canvas pixel ratio, and HUD writes only when values change. Rotation easing
  uses elapsed time, independent of display refresh rate and the rush key.
  Fixed simulation ticks, scoring and replay remain unchanged. This reduces
  client rendering work; smoothness still needs checking on real Telegram devices.
  A temporary HTTPS tunnel can delay initial loading/API requests, but each
  gameplay animation frame runs locally, without a network round trip.
- Sound uses short, locally synthesized Web Audio cues after user activation.
  Haptics use Telegram's supported API or browser vibration when available.
  Neither needs remote assets, and unsupported devices still play normally.
- Music defaults to **off**, independently of sound effects. In **Profile → Options →
  Your soundtrack**, choose **Chill · mellow keys** (82 BPM) or **Rock · power
  pulse** (112 BPM), with a separate volume slider. These are original procedural
  instrument loops in `js/music.js`, not recorded third-party tracks.
  They need no downloads or additional libraries. Music starts only after a
  player interaction and only during a run, stops on pause/help/results/title
  or when hidden, and restarts on resume. Reloading never autoplays music.
  Headless hosts without working audio output exercise lifecycle using an offline
  Web Audio destination fixture and check rendered samples for silence/clipping;
  this is not a substitute for listening on a phone or desktop with speakers.
- Menus, results, the game HUD, and Play adapt to small phones, landscape,
  desktop, and device/Telegram safe-area insets. Profile's records and Options scroll
  independently; the title screen is a full-screen game scene, not a webpage.
  Back/Escape returns to the parent menu: records and Options return to Profile,
  Coins returns to Profile, Options or Wallet according to its entry point, and
  top-level menus return to Home with Play focus restored. The pause menu
  supports resume, restart, return-to-title, Controls, and music/sound/vibration
  switches without abandoning the run. Turning music off stays off on resume
  and reload; abandoned runs are not saved.

Local keys are `hexaRush.practice.highscores.v1`,
`hexaRush.practice.player.v1`, and `hexaRush.preferences.v1`. These are
browser/device records, not tied to a Telegram identity and not synced across
devices. Authentication never upgrades local records into verified scores.
Clearing browser data removes them. If storage is blocked or full, the UI
explains that changes last only for this visit, and playing still works.

This is not a completed production Telegram rewards application. Authentication,
authoritative scoring and the Coins ledger are implemented; earlier device tests
recorded real connected players and finished official runs. This visual refresh
uses fixtures for authenticated browser checks and still needs a real Telegram
device review. Live earning remains disabled. Without credentials a preview
serves practice only.

Base scores are 10/18/30 for groups of 3/4/5, and `30 + 12 * (size - 5)` for
larger groups. Consecutive clears less than five unpaused gameplay seconds apart
form a chain. The chain's accumulated base points use its highest multiplier:
1/1.5/2/2.5/3 for levels 1/2/3/4/5+, capped at 3. Each clear awards the increase
in that total, so earlier chain points are upgraded, not counted twice. The
combo timer is not accelerated by the rush key.

Difficulty increases with cleared blocks after the first 60 blocks, rather than
automatically becoming harder while waiting. Purple is included in all spawn
patterns and color/tint mappings.

Telegram authentication and server-authoritative gameplay sessions/scoring are
implemented with Express/PostgreSQL. Authenticated Play starts a verified run;
ordinary browser Play stays local practice. Official and local records are
separate. The Coins ledger is implemented with earning disabled. Ads, wallets, withdrawals,
referral rewards, and leaderboard rewards remain out of scope.

## Authoritative game sessions

The browser cannot submit a score, best score, reward, balance, seed, spawn, or
engine snapshot. It sends only tick-indexed rotations and rush on/off inputs.
The server issues a random seed and rules version, reproduces spawns, matching,
gravity, chains, and overflow using the same game scripts, and computes the
result independently. Only an actual overflow can be finished officially.

- The simulation advances at 60 fixed ticks per unpaused second. Display size,
  device pixel ratio, rendering frequency, and resizing do not change physics.
  Rendering no longer advances deletion fades or block initialization. Turns
  are limited to one per 5 gameplay ticks (about 83 ms), on every device.
- Version `hexa-rush-v1` keeps five colors and the approved group/chain scoring.
  Rush accelerates block motion/spawning by four, not the combo clock. Falling
  blocks and gravity now use normalized logical coordinates. Existing local
  best scores/history remain intact; no local result is imported officially.
- Sessions have a 30-minute wall-clock lifetime and a 108,000-tick ceiling.
  Pauses consume lifetime but not ticks. Client lag is not simulated as a burst
  of unplayed time. Reaching the time limit requires returning to the title;
  it does not fabricate a game-over score.
- Inputs upload about every 5 played seconds, with a maximum of 600 ticks and
  200 events per batch, and 20,000 events total. Input batches must be contiguous
  and ordered. Ticks cannot run more than 1 second ahead of server wall time.
- Start uses a UUID idempotency key. A new Play abandons the prior active run;
  a same-key retry returns the existing descriptor. A partial unique index and
  user-row transaction lock serialize concurrent starts and finishes.
- The server stores event logs, batch hashes, and **server-created** simulation
  checkpoints in PostgreSQL. Each batch replays at most 600 ticks rather than
  starting from the beginning. Browser snapshots are never accepted. State
  survives service restarts; the client does not resume after a refresh.
- Exact batch retries are safe. Conflicting retries, gaps, impossible turns,
  redundant rush changes, expired/abandoned runs, post-overflow input, and
  cross-account session access are rejected. Repeated finish returns the
  original run result without incrementing totals twice.
- Finishing atomically persists score, highest combo, cleared blocks, duration,
  and the user's official best/total/game count. No Coins change while issuance
  is disabled; the result includes the saved award (zero) and current account
  balance. Title/result official bests come from the API, never local storage.
  Profile's My practice records currently lists
  local practice history only; an account-linked history UI is not yet built.
- Network failure pauses official play and retains the unacknowledged batch.
  Game Over stays unverified until replay succeeds, with Retry verification.
  Returning to the title or restarting abandons the run. Failed starts offer
  an explicit local-practice choice, never silent official-to-practice success.

**Security limit:** replay verification proves that the submitted inputs follow
the versioned game rules, not that a human produced them. The seed is visible
to the client; bots, offline planning, and account farming require additional
fraud controls before monetary rewards. Neither these tests nor a replayed
score constitute a production security audit. Keep rewards disabled.

## Coins ledger (Phase 1 foundation)

Migration `003_coins_ledger.sql` adds integer available/held balances, the saved
session award, and append-only transaction records: player, earn/spend/hold/
release/reverse type, positive amount, before/after available and held balances,
source, reference ID, reason and timestamp. Constraints enforce nonnegative
safe-integer balances and valid arithmetic; triggers reject edits, deletes and
truncation. Corrections must be separate entries, not rewritten history.

`server/coins.cjs` has a **backend-only** transactional operation. It locks the
same user row as game finalization, inserts the ledger entry and updates both
balances atomically. A unique player/source/reference/type key makes identical
retries safe; conflicting retries fail. Available Coins cannot be overspent,
reserved Coins cannot be over-released, and blocked accounts cannot mutate.
No HTTP endpoint permits earning, spending, holding, releasing or reversing.

`GET /api/coins` authenticates the cookie and always uses its player ID. It reads
balance and the latest 20 transactions in one database snapshot. `?before=UUID`
reads older entries; other query fields are rejected. Foreign cursors
reveal no history. Responses are not cached. The client never reads/writes Coin
balances in local storage, never imports practice scores, and clears account
data when authentication changes. Refresh failures explicitly mark stale data.

**Live issuance is disabled:** the previously approved earning slice specifies
10 per completion and daily caps. Guarded completion accounting is implemented;
achievement payouts remain blocked by the cap conflict described below. There
is no score-to-Coin conversion, welcome grant or historical backfill. Risk policy
and live issuance validation are still required. Existing users and old runs
receive no fabricated ledger entries. Coins are in-game points, not money; no
conversion value, transfers, purchases or withdrawals are shown.

Fixture tests cover arithmetic, rollback, conflicting/idempotent retries,
authentication and client isolation. The opt-in disposable PostgreSQL test
also checks concurrent credit/debit, append-only triggers and pagination. Never
set `TEST_DATABASE_URL` to the active player database without explicit approval.

The original ad scripts, analytics, and external score-submission request have
been removed. Fonts and game scripts are served locally; the official Telegram
SDK loads only on Telegram launches. See
`/home/devroom/hetris/hextris/CHANGELOG.md` for the separately labeled ad removal.

## Non-paying referrals (Phase 2D)

The owner approved the documented progress-only rules and supplied `@alodvipbot`.
The owner now reports the Render deployment at <https://hexarush.onrender.com>
and the current bot **@hexarushbot**. Set `TELEGRAM_BOT_USERNAME=hexarushbot`
in Render's environment, alongside the matching bot's private token and existing
database. It is optional: missing configuration disables the referral
API and attribution, without breaking normal login/streaks. `render.yaml` declares
the setting. Following explicit approval in `/home/devroom/hetris/next.md`, the
local preview was configured with the previous bot and migration 006 applied.
The UI uses the authenticated API's link, never a hardcoded bot username; this
visual update does not change Render or local private environment settings.
The Main Mini App must be configured in BotFather. Invitations use
`https://t.me/hexarushbot?startapp=ref_<telegram-user-id>`, using the owner's
numeric Telegram ID, not the application's UUID or a quick-tunnel address.
The owner explicitly requested this public link format; sharing the link exposes
the referrer's Telegram ID. Telegram carries `startapp` into
signed launch data; an unsigned `ref=` URL query is not used for attribution.
Verify real signed `start_param` delivery on a Telegram device before release.

Referrals uses a compact friends hero, one invite panel, a primary **Share invite**
action and secondary **Copy link** action. The complete link stays selectable and
wraps on phones. Two crew tiles show **Friends joined** and **Played 3 games** only
after account data loads; the three-step guide and rewards-inactive notice remain
visible to guests. Loading, retry, copy fallback and account-change clearing are
preserved. This is a presentation update, not a reward or referral-policy change.

Migration `006_referrals.sql` creates initially empty code/relationship tables.
New display links use the owner's server-stored Telegram ID, not a generated code.
Explicit Create invite still publishes the invite under the owner-row lock;
summary reads never publish it. The existing code table retains old random codes
for previously shared links and stores UUID-derived publication markers for new
invites, within migration 006's format. No schema migration or backfill is needed.
Old random-code and UUID links continue to work. Create/Copy/Share and summary
return numeric Telegram-ID links, including for old publication rows. Signed
numeric launches look up `users.telegram_id` joined to an existing publication;
unpublished accounts cannot receive attribution. A Telegram ID is not an
authentication token or a way to access another account. One relationship belongs
to each invitee. Owner ID exposure is limited to the deliberately shareable invite;
invitee identities and private histories remain absent from the aggregate API.
New-account login uses the winning
upsert's generated UUID to distinguish insert from existing/concurrent logins.
Attribution joins the same transaction as the auth session and login streak; any
failure rolls it all back. Existing accounts, same-cookie retries, invalid codes,
self referrals and inactive referrers never gain or replace a relationship.
Invalid signed launches fail as before. No historical relationships are inferred.

`POST /api/referrals/code` requires an authenticated active owner, the exact app
Origin and `{}` with no query fields; it publishes/reuses the stable invite under the
user-row lock, limited to 5/account/minute. `GET /api/referrals` is an authenticated,
owner-only, uncached snapshot with no query fields, limited to 20/account/minute.
It never publishes invites or records visits. Only aggregate counts/link are returned,
not invitee identities, game details or the referral graph. The lifetime three-game
milestone counts finished, unflagged, current-rules games with server finish time
at/after attribution from active invitees/referrers. Flags and account blocks can
reduce counts; client/practice totals cannot contribute.

The Referrals menu has explicit create/copy/share actions, safe validated Telegram
links, a wrapping read-only field that shows the entire Telegram-ID link and
selectable copy fallback, guest/loading/empty/error/retry states
and account/stale-response isolation. Sharing is never automatic or required to
play. Menus now use gameplay-oriented wording: Friends joined, Played 3 games,
Loading during start, Saving score while finishing and Score saved to your account
only after the backend succeeds. Save failures keep an explicit retry. Technical
validation/reward-policy notes stay in developer documentation, not player menus.
Inactive Coin allowances are hidden rather than offered as available rewards;
short rewards-inactive notices remain. Progress is **not** human verification or reward qualification; there are
no Coin amounts, claims, entitlements or future payout promises. Issuance remains
false and the reward policy is unchanged. The approved additive migration and
repeat migration passed; the identified preview was restarted and local health
returns 200. Unauthenticated referral API requests return 401, and foreign-origin
code creation returns 403. No synthetic live accounts/referrals are used for
validation. The full fixture suite and read-only active-database checks passed;
this is not a live signed-link/new-account Telegram test. A subsequent requested
tunnel renewal restored public preview access and updated only `APP_ORIGIN`;
the owner must update Telegram's Main Mini App/menu-button URL. Quick tunnels
can expire; stable Render hosting and real-device validation remain pending.
The master document's proposed Phase 2E defines those release gates without
enabling ads, Coins or wallet features. Disposable integration tests
require `TEST_DATABASE_URL`; never point it at active player data.

## Read-only achievements (Phase 2B)

`GET /api/achievements` derives the owner from the authenticated cookie, accepts
no query fields, is uncached and limits reads to 20 per account per minute.
`server/achievements.cjs` aggregates verified best score and chain level in one
PostgreSQL snapshot. The four milestone thresholds come from the existing reward
definitions, but this view does not use `reward_eligible` or create
`user_achievements` entries. Historical verified runs can describe display progress
only; disabled/old runs remain ineligible for rewards, now or after activation.
Flags, unfinished runs, old rules and blocked accounts are excluded.

`js/achievements.js` uses safe-text names/descriptions, accessible native progress
bars, reached/in-progress states and explicit loading/guest/error/retry states.
Account changes clear progress immediately and discard stale responses. Login
finishing while Tasks is open reloads the correct account. No local storage,
gameplay RNG/ticks, result accounting, schema or earning policy changes are made.
No achievement claim endpoint, settlement job or payout code is added. Coin
issuance remains disabled; see `server/REWARD_POLICY.md` for approval gates.

## Daily progress and login streaks (Phase 2C)

Authorization: `/home/devroom/hetris/next.md` and the accepted Phase 2C proposal.
`GET /api/daily` is authenticated, owner-scoped, uncached and limited to
20/account/minute. It accepts no submitted account/day/progress fields. One SQL
snapshot reads the three daily quest metrics and the account's login streak.
Quest progress is display-only, clamped to its targets and recomputed after flags.
Existing valid runs within today's UTC window may describe progress but gain no
reward eligibility. Quest and streak rewards have no claim/check-in route,
Coin payouts, reward entitlements or future payout promise.

Migration `005_login_streaks.sql` adds an initially empty per-account date/count
table. New signed Telegram logins record a visit inside the auth transaction;
same-launch, same-cookie POST retries revalidate launch data and record the day
under the active-account row lock. The atomic upsert deduplicates concurrent
same-day launches and cannot roll state back for an older date. The day is taken
from server time after locking. Auth cookie reads, Tasks GETs, browser guests,
failed/expired launches, replay without the matching cookie and blocked accounts
never record visits. A GET can show yesterday's still-continuable streak until
today is validated; after a missed day it shows zero until the next launch starts
at one. No historical auth sessions are used to backfill visits.

`js/daily.js` clears progress/streaks on account change and ignores stale responses.
It schedules the visible UTC reset from server time minus monotonic request
latency, not the device calendar. Navigation, hidden tabs and account changes
clear the timer; returning to Daily reloads. Accessible native progress bars,
safe text, guest/loading/error/retry states and the inactive-reward notice remain
usable on small phones and landscape. No gameplay/replay, scoring, Coins ledger,
achievement earning policy or private configuration changes are part of this slice.
UTC is approved for retention progress only; reward-day accounting and the
existing payout/cap/human-bot activation gates are still unresolved.

Phase 2C validation: **162 tests passed, 1 disposable-PostgreSQL test skipped**
with `TEST_DATABASE_URL` unset, plus **15/15** standalone gameplay tests. Normal
and genuine reduced-motion Firefox runs passed against the Node preview at
390×844, 320×568 and 568×320, covering Daily/Achievements, streak/UTC reset,
account isolation, accessible controls and unchanged replay parity. Account and
progress data in browsers are transport fixtures, not live Telegram logins.
One reduced-motion browser session startup timed out; a fresh-profile rerun
passed, with failed and successful logs kept separate.
Migration 005 was applied non-destructively and repeat migration passed. The
initial streak table remained empty, with no historical backfill or player,
score, Coin or entitlement entries added. Actual daily SQL and SELECT-only CTE
fixtures passed in a read-only PostgreSQL transaction. The actual upsert was
planned with EXPLAIN (without ANALYZE); transition SELECT fixtures passed.
Real concurrent upsert tests are added to the disposable suite but remain
unrun here; never run that suite against active player data.

Only the identified Node preview was restarted, after schema readiness. Local
and retained public-tunnel health/title/new assets return 200; unauthenticated
daily/achievements/standings/Coins return 401, and tested private/backend/package/
test/artifact/claim/check-in paths return 404. The private `.env`, earning policy,
Coins/rewards modules, fixed-session rules and original master content/Answers
were preserved. GPL/player-accessible credits and the labeled original-ad-removal
entry remain. No commits or pushes. The quick tunnel remains temporary;
Telegram URL setup is user-managed. Real Telegram-device launch/streak,
visual/motion/audio checks and stable Render deployment still remain.

## Tests

Node.js 22+ is required for the browser smoke test's built-in WebSocket client.

```sh
node --test /home/devroom/hetris/hextris/tests/game.test.cjs
cd /home/devroom/hetris/hextris && env -u TEST_DATABASE_URL npm test
node /home/devroom/hetris/hextris/tests/browser-smoke.mjs
# Run separately after the normal smoke test, never concurrently on the same port:
SMOKE_REDUCED_MOTION=1 node /home/devroom/hetris/hextris/tests/browser-smoke.mjs
```

The browser test also requires Firefox, launches its own fresh headless test profile
and temporary local server, and writes ignored screenshots to
`/home/devroom/hetris/hextris/.test-artifacts`. Set `FIREFOX_BIN` if Firefox is
not on PATH, or `FIREFOX_BIDI_PORT` to use an already-running test instance.
`SMOKE_REDUCED_MOTION=1` uses a separate Firefox profile with the real
`ui.prefersReducedMotion=1` preference and checks static panels/icons, rapid
navigation, three viewport sizes and gameplay isolation. An external Firefox
instance must already have that preference when using `FIREFOX_BIDI_PORT`.
Managed profiles are unique per invocation; cleanup waits for the owned browser
to close before another mode starts. Profiles remain ignored and are not CI artifacts.
The gameplay/browser suites remain dependency-free. Backend tests need `npm ci`
for Express and pg. Authentication tests exercise signed fixture launch data,
HTTP cookies, CSRF/origin checks, expiry, replay prevention, and private-file
blocking using a test-only store, not a live Telegram account or database.

To test against a disposable real PostgreSQL database, set `TEST_DATABASE_URL`
and run `npm test`. The integration test creates and drops an isolated test
schema and requires permission to do so; without this variable it is explicitly
skipped. Set `SMOKE_BASE_URL=http://localhost:8001` to run the browser suite
against the running Node service (including its security headers) instead of
the smoke test's temporary static server.

### Automated release checks

[Release checks](https://github.com/datchimtoa/heaxrush/actions/workflows/release-checks.yml)
uses Node 22.22.0 for unit/gameplay/syntax checks and a separate, fresh PostgreSQL
16 service for the two real integration suites. It runs on pushes to `main`,
pull requests and manual dispatch, with read-only repository permissions and no
production secrets or deployment steps. PostgreSQL fixtures run sequentially,
create/drop their own schemas and never connect to the Render/player database.
A third job runs the full normal Firefox smoke suite, then the real reduced-motion
suite, against a temporary allowlisted Node service with database/bot configuration
empty. It never loads `.env` or connects to the deployed app. Firefox comes from
the Ubuntu 24.04 runner image; its version is recorded in the job log.

The browser job retains only fixture PNG screenshots and three named test/service
logs for seven days, even on failure. Browser profiles/cookies, private files and
runtime state are not uploaded. Check all three jobs for the **exact release
commit**. Browser authentication, referrals and account progress use transport
fixtures; headless audio uses rendered samples when needed, not audible output.
Real Telegram login, new/existing-account invite and device checks still need
consenting testers: follow [the acceptance checklist](server/TELEGRAM_ACCEPTANCE.md).

`npm run test:postgres` is the strict CI entry point: an explicit disposable
loopback database/user named `hexa_rush_ci` is required; production database/token
variables must be unset. It never loads `.env` and fails if misconfigured rather
than silently skipping. The workflow's public test-only credentials are not app
credentials. Do not create this database on a production server or override the
guard to reach active players. See `server/RELEASE_READINESS.md` for isolation and
acceptance boundaries. A green exact-commit database job is required; committed
automation alone is not proof of a successful run, real Telegram login, backups
or sustained Render uptime. Coin issuance remains disabled.

Latest visual-refresh checks: **121 passed, 1 disposable-PostgreSQL test skipped**
with `TEST_DATABASE_URL` unset; **15/15** standalone gameplay tests. Normal smoke
passed against the Node preview using a fresh Firefox test profile after two
default-profile startup timeouts; the separate real reduced-motion profile
passed at 390×844, 320×568 and 568×320. Syntax and tracked diff whitespace checks
passed, and responsive Home/Profile/features/gameplay/pause/results screenshots
were reviewed. Authentication/Coins/native chrome checks are fixtures, not a
real Telegram-device or live earning test. Local/public health and frontend
checks passed; tested private paths remain 404. Device motion, native chrome and
audible playback still need hands-on validation; earning remains disabled.

Latest Phase 2A checks: **131 passed, 1 disposable-PostgreSQL test skipped** with
`TEST_DATABASE_URL` unset; **15/15** standalone gameplay tests. Normal Firefox
passed against the Node preview, including populated daily/weekly standings,
outside-top own rank, safe text, empty/error/account-isolation states, responsive
control reachability and replay parity. A separate real reduced-motion run passed
at 390×844, 320×568 and 568×320, including Leaderboards navigation. Browser account
and standings values are transport fixtures, not a live Telegram-device test.
Actual SQL and SELECT-only CTE fixtures passed in a read-only PostgreSQL transaction
without adding players, scores or Coins. Syntax/whitespace checks passed. Local
and public health/assets returned 200, unauthenticated standings returned 401,
and tested private paths returned 404. The identified Node preview was restarted;
the tunnel, private configuration, schema and earning policy were unchanged.
Logs and exit markers are in `.test-artifacts/phase2-*`. Real Telegram-device
visual/motion/audio checks and stable Render deployment remain outstanding.

Latest Phase 2B achievement checks: **145 passed, 1 disposable-PostgreSQL test
skipped** with `TEST_DATABASE_URL` unset; **15/15** standalone gameplay tests.
Normal and genuine reduced-motion Firefox smoke passed against the Node preview,
with achievement screenshots reviewed at 390×844, 320×568 and 568×320. Accessible
progress, threshold/decimal/reached/zero/error/guest states, safe text, scrolling,
account changes and stale responses are covered alongside gameplay/replay parity.
Browser account/achievement data are transport fixtures, not live Telegram logins
or rewards. Actual SQL and SELECT-only CTE fixtures passed in a read-only
PostgreSQL transaction without live records or entitlements being written.
Syntax/whitespace checks passed. Original master-document/Answers and protected
policy/private files were preserved. Evidence: `.test-artifacts/achievements-*`.
Coin issuance remains disabled; live Telegram-device/audio and stable Render
release checks, exact payout/cap/day policy and human/bot risk gates remain open.
Only the identified Node preview was restarted. Local health/new assets return
200, unauthenticated achievements/standings 401, and claim/private paths 404.
Public quick-tunnel access could not be reverified (connection unavailable);
the tunnel process and private configuration were not changed.

## Telegram authentication setup

For Phase 2E read-only release checks, safe preview renewal and the user-requested
**00:00 UTC** local watcher, see `/home/devroom/hetris/hextris/server/RELEASE_READINESS.md`.
Commands are `npm run check:release`, `npm run preview:renew`, `npm run preview:watch`
and `npm run preview:status`. State/new URLs live in ignored `.preview/`.
The watcher requires this host to stay awake/running; it does not update Telegram
URLs or survive shutdown by itself. Stable Render/data/backup/disposable-test and
genuine-device release gates remain open; earning stays disabled.

1. Copy `/home/devroom/hetris/hextris/.env.example` to
   `/home/devroom/hetris/hextris/.env` locally; this file is Git-ignored.
   `npm start` loads this game-directory file, not `/home/devroom/hetris/.env`.
2. Set `DATABASE_URL` to PostgreSQL and `TELEGRAM_BOT_TOKEN` to the token from
   BotFather. Do not paste real credentials into code, commits, or public logs.
3. Set `APP_ORIGIN` to the exact app origin, for example
   `https://your-service.onrender.com`, with no path. For local tests the
   default is `http://localhost:8001`; alternate hosts require matching config.
4. Run `npm start`. Migrations run transactionally at startup. They can also
   be applied with `npm run migrate`. Existing migrations are not rerun.
5. For Render, connect `https://github.com/datchimtoa/heaxrush`, branch `main`,
   as **one Node Web Service**, with the repository root as the application root.
   Build: `npm ci --omit=dev`. Start: `npm start`. Health check: `/api/health`.
   Set `NODE_ENV=production`, `NODE_VERSION=22.22.0`, `TELEGRAM_BOT_TOKEN`,
   `TELEGRAM_BOT_USERNAME=hexarushbot`, and the approved `DATABASE_URL` privately
   in Render. `APP_ORIGIN` defaults to `RENDER_EXTERNAL_URL`; if set explicitly,
   it must be the exact stable HTTPS origin, not a temporary preview URL.
   **Do not blindly apply `render.yaml`: it provisions a new database.** To keep
   current players, use the approved existing database and confirm its backup
   plan first. Startup applies any pending migrations, so approve the database
   and backup before the first deploy. Never copy `.env` into GitHub or paste
   credentials into build commands. No frontend build or static-site service is
   needed. After deployment, update Telegram's Main Mini App/menu URLs and reopen.
6. Configure the HTTPS Mini App URL as the bot's **Main Mini App** or **menu
   button** in BotFather, then launch that button in Telegram. A normal HTTPS
   link opened in Telegram's browser is not an authenticated Mini App launch.

### If Telegram shows device-only play

Open **Profile → Connection**. The client forwards raw `Telegram.WebApp.initData`
to the server, which validates its signature and age before creating the account.
It then checks the session through `/api/auth/me` before showing the verified
name, Telegram ID and optional username. `initDataUnsafe`, device records and
locally cached names are never accepted as account identity.

- **Telegram launch data missing:** reopen via the bot's Main Mini App, menu
  button, or an inline `web_app` button under a bot message. Telegram documents
  empty init data for reply-keyboard and inline-mode launches; a normal web link
  also does not provide signed identity. No permission dialog can manufacture it.
- **Telegram login not configured:** set both `TELEGRAM_BOT_TOKEN` and
  `DATABASE_URL` privately on the server, then restart. A frontend preview alone
  cannot verify Telegram accounts or save official scores.
- **Telegram app URL mismatch:** set `APP_ORIGIN` to the exact current HTTPS
  origin and restart, especially after a tunnel URL changes. Do not disable
  origin validation or add a wildcard.
- **Telegram launch expired or invalid:** close and reopen from the bot for fresh
  signed data. Check privately that the configured token belongs to that bot.
- **Telegram session unavailable:** the login response did not produce a usable
  matching session. Check cookie restrictions and reopen from the bot; the UI
  does not claim successful login based on an unconfirmed POST response.
- **SDK/service unavailable or too many attempts:** check connectivity and server
  health, or wait a minute before retrying. Raw launch data and tokens are not
  logged or included in displayed diagnostics.

Telegram SDK loading also recognizes launch version/platform markers and the
official SDK's same-tab restored parameters. These are only loading hints, not
authentication. Ordinary browsers make no SDK/auth requests. Pending/failed
Telegram login does not silently start practice: Play offers an explicit
**Play on this device instead** choice. Existing local records stay separate.

See Telegram's [initialization and launch-data documentation](https://core.telegram.org/bots/webapps#initializing-mini-apps).

### Temporary HTTPS preview in Telegram

Keep the allowlisted Node server running on port 8001, then start a temporary
Cloudflare Quick Tunnel (requires an installed `cloudflared`):

```sh
cloudflared tunnel --url http://127.0.0.1:8001 --protocol http2 --no-autoupdate
```

Use the generated `https://….trycloudflare.com` URL, not the localhost URL.
Quick Tunnels have no uptime guarantee and the URL changes on restart. Never
tunnel a generic static server exposing the repository root. Before sharing,
check that `/` and `/js/auth.js` return 200 and `/.env`, `/server/config.cjs`,
`/package.json`, and `/.test-artifacts/` return 404. `/api/health` returns 503
with `status: unconfigured` until both PostgreSQL and the bot token are configured; this does not block
visual/practice testing.

In the official [@BotFather](https://t.me/BotFather):

1. Send `/setmenubutton`, select your bot, and set its Mini App URL to the
   tunnel's HTTPS URL and button text to **Play Hexa Rush**.
2. For a profile **Launch app** button and `https://t.me/<bot_username>?startapp`,
   configure **Main Mini App** under `/mybots` → your bot → **Bot Settings** →
   **Configure Mini App**. Set the same HTTPS URL.
3. Open the bot's Mini App button in Telegram, not just the URL in an external
   browser. Send title/play/results screenshots with your device, OS and
   Telegram version when reporting layout issues. Redact private information.

See the official [menu button](https://core.telegram.org/bots/webapps#launching-mini-apps-from-the-menu-button)
and [main Mini App](https://core.telegram.org/bots/webapps#launching-the-main-mini-app)
documentation. `/setdomain` belongs to the separate Telegram Login Widget;
it is not a substitute for setting the Mini App HTTPS URL.

Visual testing needs no bot token on this server. **Authenticated testing still
needs PostgreSQL and a bot token stored only in the ignored local `.env`.**
Set `APP_ORIGIN` to the exact generated HTTPS origin and restart the Node server
before testing login. HTTPS origins enable Secure/HttpOnly, SameSite=None and
Partitioned cookies even for development previews; local HTTP uses SameSite=Strict.
For deployment use `NODE_ENV=production`, which requires HTTPS and both
credentials. Do not weaken origin checks
or cookie protections to make a tunnel test pass. Use a dedicated test bot and
database, not a production rewards account.

Telegram launches match supported native header/background/bottom bar colors
to the plum surround (`#301441`). The UI uses the last stable native viewport and combines
device and Telegram content safe areas on all four edges. Native methods are
version-gated; plain browser practice stays local and loads no Telegram SDK.
API fixture/browser tests do not replace real Telegram iOS/Android/Web testing.

Only the official Telegram SDK is loaded on Telegram launches. Raw
`Telegram.WebApp.initData` is verified using the
[official HMAC algorithm](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app).
`initDataUnsafe` is not trusted. Launch data must be at most five minutes old
(30 seconds future clock skew allowed). Login sessions last 24 hours, can be
revoked with logout, and store SHA-256 token hashes. Reopen the Mini App for
fresh launch data if a stale/replayed login is rejected. No fake development
login bypass exists.

API endpoints:

| Endpoint | Behavior |
| --- | --- |
| `POST /api/auth/telegram` | `{ "initData": "..." }` only; validates identity, creates/updates user, sets cookie |
| `GET /api/auth/me` | Returns the authenticated profile, official aggregates, and configured gameplay mode |
| `POST /api/auth/logout` | Revokes the current session and clears the cookie |
| `GET /api/health` | Returns 200 only with a reachable configured database, otherwise 503 |
| `POST /api/game/start` | `{ "requestId": "UUID" }`; returns server session, seed, and rules version |
| `POST /api/game/:id/events` | `{ "fromTick": 0, "toTick": 300, "events": [...] }`; replays inputs only |
| `POST /api/game/:id/finish` | `{}` only; persists/returns server-calculated result after overflow |
| `POST /api/game/:id/abandon` | `{}` only; abandons a run without recording a score |
| `GET /api/coins` | Authenticated balance, held Coins, issuance status, daily gross earnings/allowances and latest 20 entries; optional `?before=UUID` |

POST authentication and game requests require `Origin` to match `APP_ORIGIN`. The API
does not accept scores, Coin awards, or balances. Production startup requires
HTTPS, the bot token, and a database URL. Cookies are Secure/HttpOnly with
SameSite=None and Partitioned support for Telegram Web; cross-site writes are
blocked with explicit origin validation. Test real Telegram Web/native clients
before release, including browser third-party-cookie restrictions.

The limiters are in-process and assume the selected single Render instance:
20 login attempts/IP/minute and 60 game requests/authenticated user/minute.
Do not scale to multiple instances without a shared limiter. Launch replay
protection is PostgreSQL-enforced. TLS uses pg's normal verification; for a
custom database CA set `DATABASE_SSL_CA_FILE`, not `rejectUnauthorized: false`.

The frontend's **Profile → Options → About** contains a compact **Credits & license** link to
`/home/devroom/hetris/hextris/credits.html`. All attribution and original
copyright/license notices remain intact. No closed-source license was added.

## Guarded gameplay reward accounting

The previously approved earning slice authorized this work; the current
`/home/devroom/hetris/next.md` instead confirms progress-only Phase 2C. Migration 004 and
`server/game-rewards.cjs` implement atomic 10-Coin completion accounting,
one-time score 500/1,000/2,000 and chain-level x4 entitlement tracking, and trusted
flag/reversal handling. Daily earn checks enforce **100 gameplay Coins including
achievements**, and **200 Coins from all sources**, per unique Telegram account.
The API accepts no client score, award, balance, achievement or moderation action.
Disabled/old sessions are never retrospectively rewarded. Finishes that hit the
cap are saved at zero and cannot claim again on another day.

**This phase is not fully activated.** The 150- and 500-Coin bonuses conflict with
the 100 gameplay cap. No carry-forward, partial/forfeited payout or cap exemption
has been selected, and there is no achievement payout/claim job. Entitlements are
not credited Coins. `server/reward-policy.cjs` remains disabled with no environment
switch; the constructor's enabled argument is for tests only. UTC day boundaries
are a draft requiring approval. Daily gross earning totals are computed from
ledger earn entries, not balances: reversals do not reopen earning allowance.

For trusted moderation, `createGameStore(pool).flag(userId, sessionId, reason)`
locks the account/session, appends idempotent linked-earn reversals, saves the
first flag reason and invalidates entitlements from that run. Blocked accounts
can be reversed. An insufficient available balance fails the whole transaction,
not a partial debit; debt/held-balance recovery must be designed before any future
spending feature. There is no player flag endpoint, admin dashboard or wallet.
The full policy, activation blockers and test boundaries are in
`/home/devroom/hetris/hextris/server/REWARD_POLICY.md` (backend-only, not served).
Replay-valid inputs can still be automated; this is not human/bot verification.

## Original Hextris project and attribution

Based on `https://github.com/Hextris/hextris`, branch `master`, commit
`8872ec47d694628e2fe668ebaa90b13d5626d95f`. Hexa Rush interface and gameplay
modifications, 2026. Original author and license information follows unchanged.

An addictive puzzle game inspired by Tetris.

<img src="images/twitter-opengraph.png" width="100px"><br>

An addictive puzzle game inspired by Tetris. Play it at [www.hextris.io](http://www.hextris.io), or [https://hextris.github.io/hextris](https://hextris.github.io/hextris).

By:
 - Logan Engstrom ([@lengstrom](http://loganengstrom.com/))
 - Garrett Finucane ([@garrettdreyfus](http://github.com/garrettdreyfus))
 - Noah Moroze ([@nmoroze](http://github.com/nmoroze))
 - Michael Yang ([@themichaelyang](http://github.com/themichaelyang))

# Contributing
This project is not very actively maintained, as we are all very busy these days. But feel free to open an issue or PR, and we'll eventually take a look.

# About
Hextris was created by a group of high school friends in 2014.

## Press kit
http://hextris.github.io/presskit/info.html

# About
Hextris was created by a couple high school friends (who are now in college!) who unfortunately don't have as much time to update the game. If you'd like to support the open-source development of Hextris, please consider donating at:

ETH: `0xbf5414129552D37B4Fb12D058Cf1596B960d25b2`

## License
Copyright (C) 2018 Logan Engstrom

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
