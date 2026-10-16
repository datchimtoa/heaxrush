# Phase 3A: AdsGram rewarded SDK preparation

Hexa Rush is a live game at `https://hexarush.onrender.com` / `@hexarushbot`.
Development-only ad diagnostics do not relabel that deployment as a preview.
This slice prepares SDK/configuration handling, **not live rewarded impressions
or Coin payouts**. The owner supplied a numeric Reward block separately from
an `int-...` Interstitial block in a private workspace file. The numeric format
was validated locally, not confirmed against the publisher dashboard/moderation.
Neither actual ID nor private setup contents are included in public source.

## Configuration and owner handoff

Use these environment variable **names**, with the owner's actual Reward block:

```dotenv
ADSGRAM_REWARDED_BLOCK_ID=
ADSGRAM_DEBUG=false
```

Set the numeric Reward ID privately in Render. The ignored owner handoff is
`/home/devroom/hetris/hextris/.test-artifacts/phase3-adsgram-render.env` (0600).
Do not upload this handoff file or `sec.md` to GitHub. Neither the private `.env`
nor Render settings are changed by this implementation. Production rejects
`ADSGRAM_DEBUG=true`; an ID with debug false is inert and remains hidden.
No environment switch can enable Coin issuance or live rewarded viewing.

For a genuine SDK check, use a **separate non-production app/platform** matching
its bot/origin, a test block and explicit `ADSGRAM_DEBUG=true`. Do not load the
live `.env` or point integration fixtures at existing player data. Debug ads do
not generate counted impressions or Reward URL calls. The results action is
clearly labeled Development only; it is not a player reward offer. This host's
browser tests use SDK/API transport fixtures, not real ad impressions/revenue.

## Implemented boundaries

- `GET /api/adsgram` is authenticated, owner-scoped, no-store, accepts no query
  fields and is limited to 20/account/minute. It performs no data/reward writes.
  It returns provider/mode/public block (only in debug)/`rewardsEnabled: false`,
  never private configuration, identity, balance or a claim token.
- Production always returns disabled and retains the existing restrictive CSP.
  Only explicit development debug permits the exact SDK script host and
  provider-owned `*.adsgram.ai` resource origins. No wildcard HTTPS, unsafe-eval
  or new inline-script permission. Extra creative hosts are not guessed; a real
  test-platform check is required to establish any additional CSP needs.
- SDK loading is lazy on the optional result action, after confirmed account
  save and only with Telegram present. No auto-ad, guest/practice ad, gameplay
  interruption, revive, booster, callback settlement, claim or reward promise.
- Duplicate clicks are ignored. Loads have bounded timeouts; no-fill, early
  close or SDK failure leave retry/Play again/title usable. Account/run changes
  or hidden tabs invalidate pending work, destroy the active controller and
  ignore late completions. The SDK dialog owns focus/keys while active.
- No score, fixed-tick/RNG, record, preference, ledger, entitlement, migration or
  reward-policy change. No TADS, automatic interstitial or bot message ads.

## Live rewarded viewing is blocked on a real benefit and verification contract

Official references checked for this slice:

- [Reward format](https://docs.adsgram.ai/publisher/reward-examples): a rewarded
  view must be expected and grant a real benefit. A no-benefit live Reward ad
  disguised as support is not this implementation.
- [API reference](https://docs.adsgram.ai/publisher/api-reference): documented
  `init`/`show`/events are client signals, not authority over Coins. Debug mode
  sends no Reward URL request and generates no counted impressions.
- [Block setup / Reward URL](https://docs.adsgram.ai/publisher/get-block-id):
  the optional server callback is HTTPS GET with a `[userId]` macro. The public
  contract does **not document** a signature, unique impression/event identifier,
  or per-view application-intent correlation. This is not a claim that AdsGram
  has no private/partner mechanism; obtain it from provider support/dashboard.

Before implementing payable callbacks, obtain provider-confirmed authentication,
stable unique event ID, account/block/placement binding, tamper/replay protection,
per-view correlation, retries/late delivery and acknowledgement semantics.
Do not invent request fields, strip ID prefixes, substitute a Telegram ID for
proof of completion, or install a secret-free reward endpoint. A static URL
secret alone also does not supply unique authenticated per-impression evidence.

The previously suggested
`https://hexarush.onrender.com/api/adsgram/reward?userid=[userId]` was a proposed
address only. **It is not implemented and remains 404.** Leave Reward URL blank
until an authenticated, idempotent handler is implemented/deployed. Do not send
genuine provider callbacks to a stub returning success without processing them.

Also approve the exact benefit, eligibility and daily/per-user/global limits,
budget and accounting day, plus the existing achievement/cap/human-bot decisions
in `REWARD_POLICY.md`. A Block ID or a deployment report does not select these
policies. Coin issuance remains false. No historical backfill/future payout promise.