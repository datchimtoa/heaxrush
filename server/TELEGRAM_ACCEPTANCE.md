# Phase 2E: genuine Telegram and device acceptance

Status: **pending owner/tester execution**. Automated Firefox and PostgreSQL CI
are separate gates, not evidence that these checks passed. Coin issuance must
stay disabled. Do not enable ads, rewards, claims, wallets or withdrawals.

## Before testing

- Owner confirms the deployed commit and its successful exact-commit Release
  checks run. A Git push is not proof that Render deployed that commit.
- Owner privately confirms the selected production database preserves the intended
  existing accounts, scores and referrals; approves backup retention, recovery
  objectives and an isolated restore drill before any export or restore. Do not
  apply the blueprint's new database blindly, copy preview credentials, or run
  disposable suites against production. Record backup/restore as pending until
  approved and actually verified, not merely because backups are available.
- Owner confirms the matching bot token, `TELEGRAM_BOT_USERNAME=hexarushbot`,
  exact `APP_ORIGIN=https://hexarush.onrender.com`, and Telegram Main Mini App/menu
  URLs privately. No token, database URL, cookie or raw `initData` in reports.
- Use consenting real testers: an existing player/referrer and an account that
  has **never registered with this application**. Do not delete/reset an account
  or generate signed launch fixtures to manufacture new-account evidence.
- Agree a short test window. Aggregate count changes alone cannot identify an
  invitee if unrelated invitations or moderation happen at the same time. Mark
  ambiguous evidence inconclusive rather than exposing other players' history.

## Login and account play

1. Existing player opens **@hexarushbot** inside Telegram and launches the app.
   Profile/Connection shows their authenticated identity. An external browser
   remains explicit device-only practice; it must not claim an account login.
2. Finish an account game. Saving score becomes **Score saved to your account**
   only on success. Confirm it remains separate from My practice records.
3. With consent, briefly interrupt connectivity during score saving, restore it
   and retry. One completion must not be counted twice. If it cannot be checked
   conclusively through the UI, retain the failure and request approved,
   owner-scoped read-only verification; never adjust production rows.
4. Reopen with fresh Telegram launch data. Account identity/progress remains
   consistent; device-local practice and preferences are not account balances.

## Numeric invitation: new account and existing-account exclusion

1. Referrer explicitly creates an invite in Referrals. Copy/Share preserves the
   entire `https://t.me/hexarushbot?startapp=ref_<telegram-user-id>` link. This
   intentionally publishes the **referrer's** Telegram ID. Redact it in public
   evidence. Never collect invitee IDs/names or a private referral graph.
2. Record the referrer's aggregate **Friends joined / Played 3 games** baseline.
   The never-registered tester's **first application launch** must be through
   that link inside Telegram, followed by a valid login. Do not open the app
   first to prepare the account; that would correctly make it ineligible.
3. Refresh Referrals. In a controlled window, Friends joined increases by one,
   while Played 3 games is unchanged until the third qualifying completion.
   Invited tester completes three genuine account games, each successfully saved
   after attribution. At one/two games the reached count stays unchanged; after
   the third it increases by one. Practice, abandoned or unfinished games do not
   qualify. No Coin/reward is granted or promised.
4. Repeat/reopen the same invite. Counts must not duplicate. Once registered,
   opening another consenting referrer's link must not move the relationship.
5. An existing account that predates these tests opens the invite and logs in.
   It must not become newly attributed, even if it has never played. Repeat
   login/refresh must not add a friend. Use controlled aggregates or separately
   approved private read-only verification; do not infer exclusion from a fixture.

## Daily progress and streaks

- Check today's three quests against genuine saved games: three completions,
  800 points in one run, and chain level 3 (**2×** points). Do not manipulate
  client scores, clocks, cookies or database dates to force progress.
- Record same-day relaunch: streak increases at most once. Across a real
  **00:00 UTC** boundary, daily progress resets by server finish time and the
  next valid launch extends a consecutive streak. Cookie refresh/GETs do not
  create a launch. A missed UTC day resets the next valid launch to one.
- Multi-day checks require elapsed real time. Leave them pending until observed;
  fixture transitions and a device-clock change do not close this gate.

## Device layout, motion and audio

- Record device/OS/Telegram versions, date/time and orientation. Check a small
  phone, portrait/landscape and a short Telegram sheet where available. Home,
  Tasks, Referrals, Wallet, Profile, Leaderboards and Back actions stay reachable;
  safe areas and native chrome do not cover content. Navigation hides during
  play, pause and results. Credits remain in Profile → Options → About.
- Enable real OS reduced motion and reopen: no moving panel entrances, particles
  or screen shakes. Gameplay and navigation remain usable. Then restore the
  tester's preference. Browser emulation is supplementary, not device evidence.
- Sound/music default off. After user activation, listen to Chill and Rock and
  change volume independently of effects. Music stops on pause, help, hidden
  app, title and results. Headless offline sample rendering is not a listening
  test. Check vibration only on supported devices with tester consent.
- Wallet remains unavailable and Coins/rewards stay inactive. No claim, payment,
  transfer, ad prompt or future payout promise should appear.

## Evidence and sign-off

Keep a private record per check: release commit, exact CI run URL, tester alias
(not Telegram ID), UTC timestamp, device/version, expected versus observed result,
pass/fail/**pending/inconclusive**, redacted screenshots and issue reference.
Do not upload real-user evidence into the public CI artifact or Git repository.

Owner records production database/backup approval, restore-drill evidence,
deployed commit, agreed uptime observation window/results, and approved restart/
rollback procedures separately. Do not restart/roll back production to test
these without approval, or claim sustained uptime from a single health request.

Failures block sign-off. Preserve them, fix and re-test the affected release.
Passing this checklist still does **not** approve earning: achievement/cap/day
and human/bot controls remain separate decisions in `REWARD_POLICY.md`.