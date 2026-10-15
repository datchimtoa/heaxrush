# Gameplay rewards: implemented accounting, activation blocked

Authorization: `/home/devroom/hetris/next.md`. The foundation is **not committed**;
the document's assumption about a commit does not authorize one.

## Exact rules implemented

- A newly server-verified, eligible, unflagged completion credits exactly 10 Coins
  inside the finish transaction. Insufficient daily room credits zero, not a
  truncated reward. Repeated finishes never backfill an award on another day.
- Persistent one-time entitlements: score 500 / 1,000 / 2,000 → 50 / 150 / 500;
  clear-chain level 4 → 100. Several milestones can unlock in one game.
  `maxCombo >= 4` is chain level, **not** a 4x score multiplier. Scoring stays
  capped at 3x; chain level 4 uses 2.5x as the product's final Answers specify.
- The gameplay cap is 100, **including achievements**, not just completions.
  The all-source cap is 200. Both are per account; PostgreSQL's unique Telegram
  ID guarantees one account per Telegram ID. Every earn operation checks the
  all-source cap; gameplay/achievement earns also check the gameplay cap.
- Ledger earn entries consume gross daily allowance. Spending, holding,
  releasing and reversing do not create more earning room. This conservative
  anti-abuse accounting prevents flag/re-earn cycles.
- Draft calendar accounting uses UTC `[00:00, next 00:00)`, measured at the
  transaction's reward time after acquiring the account lock. UTC needs approval
  before activation; the disabled UI explicitly labels it draft.

## Unresolved conflict — do not activate

The 150- and 500-Coin bonuses cannot be paid in full on one day under the
100-Coin gameplay cap. The authorization does not say to carry balances forward,
truncate/forfeit bonuses, or exempt them from caps. **No option is selected.**
Entitlements are not Coin balances, and no achievement payout code, claim route,
automatic carry-forward, or background settlement job exists. The test-only
enabled store argument exercises completion accounting; it does not represent a
complete approved achievement earning policy.

`server/reward-policy.cjs` keeps `issuanceEnabled: false`; the production startup
uses that value. There is no environment/client activation switch. Sessions
started while disabled are ineligible, including after a future code activation.
Migration 004 leaves every old session ineligible and inserts no rewards or
achievements. Disabled sessions do not create achievement entitlements.

Before activation, approve (1) achievement payout/cap interaction, (2) the day
boundary, and (3) the risk acceptance for automated but replay-valid play. Replay
verification is not human/bot verification. No new human detection is claimed.

## Moderation and reversals

`createGameStore(pool).flag(userId, sessionId, reason)` is a trusted backend
operation, not a player HTTP route. Account then session locks serialize it with
finish. A flag after credit appends one `reverse` per linked earn entry, keyed by
the original ledger entry ID, and records `coins_reversed`. Repeated flags use
the first saved reason and never debit twice. Flags invalidate entitlements tied
to the run; invalidated milestones are not automatically re-unlocked or paid.
Blocked accounts remain reversible by this trusted operation.

Flag, reversals and invalidation commit together. If the available balance is
insufficient (e.g. a future spending feature), the entire flag operation fails
with no partial debit or negative balance. Debt/held-Coin recovery is outside
this phase and must be designed before spending is offered. Current players
cannot spend, transfer or withdraw. Scores/statistics are not rewritten by this
Coin-moderation operation. There is no player-facing flag/unflag endpoint or
admin dashboard.

## Validation boundaries

Fixture tests cover accounting/rollback and simulate serialized transactions;
they are not proof of real PostgreSQL row-lock concurrency. The opt-in
`tests/postgres.test.cjs` covers real migrations/concurrent rewards/reversals in
a **disposable database** only. Never set `TEST_DATABASE_URL` to the active
player database. Browser Coin values are transport fixtures, not live credits.
No ads, wallets, withdrawals, referrals, leaderboard rewards or backfill.