# Phase 3B: optional non-paying results banner

This slice can proceed while AdsGram's reward verification contract is pending.
It adds one **non-rewarded Text-Graphic Block** (`type: 'static'`) after a saved
account result. No rewarded/click bonus, automatic fullscreen, Home ad, earning,
webhook, ad-report database or synthetic revenue is introduced.

## Owner setup (disabled by default)

1. Register the real Telegram Mini App site in the TADS publisher dashboard,
   matching `https://hexarush.onrender.com` and `@hexarushbot`.
2. Create a **Text-Graphic Block / Non-Rewarded** widget for the result placement.
   Confirm categories, moderation and the provider's privacy terms. This is a
   separate TADS numeric widget ID, not an AdsGram Reward/Interstitial block.
3. Save its ID privately. Neither a widget nor provider account is created by
   this code; no ID, account approval or impression is fabricated.
4. In owner-managed Render settings, configure:

   ```dotenv
   TADS_RESULT_WIDGET_ID=
   TADS_RESULT_BANNER_ENABLED=false
   TADS_DEBUG=false
   ```

   Supplying an ID alone is inert. After a separate test-app check, the owner can
   explicitly enable this **non-paying banner** with
   `TADS_RESULT_BANNER_ENABLED=true`. This is not an earning/AdsGram switch.
   Production rejects `TADS_DEBUG=true`. On a separate non-production app/site,
   use `TADS_DEBUG=true` with the matching test widget. No dashboard statistics
   or real revenue should be inferred from debug/fixture banners.
5. Verify the deployed commit/assets before activating. No production/private
   settings, bot configuration, database or retained preview/tunnel processes
   were changed in this slice. Tests start/stop their own isolated Node service.
   Never reuse live player data for fixture integration tests.

No TADS widget ID has been supplied/confirmed for this slice. The live service
therefore stays disabled unless the owner separately configures the above.
Leave provider Webhook URL blank: no TADS settlement callback is implemented.

## Player experience and lifecycle

- Only an authenticated Telegram player, with launch data present, and a saved
  official result can see **Show sponsor banner**. Ordinary guest practice,
  title, menus, active play, pause and unsaved/failed results never load an ad.
- Configuration is read via authenticated, uncached `GET /api/tads`, without
  query fields; 20/account/minute, separately from AdsGram reads. No writes.
  Public widget/type/mode only: no user selection, balance or reward authority.
- Neither config read nor result arrival loads the SDK. A deliberate player tap
  loads a local iframe, then `https://w.tads.me/widget.js`. The wrapper uses the
  documented `init({widgetId, type:'static', debug, onAdsNotFound})`, `loadAd()`
  then `showAd()`. **No onShowReward/onClickReward callbacks are passed.**
- Ad disclosure precedes the tap: TADS receives Telegram launch/profile data;
  no game reward is offered. The wrapper forwards only the confirmed API
  profile's basic display fields/Telegram ID and launch data to its SDK context.
  No session cookie, account balance, private game history or game input log is
  explicitly forwarded. The provider SDK is third-party trusted code, not an
  identity source, and must be reviewed under provider privacy terms.
- Label, Close sponsor, Play again and Title remain in the game document. No
  fullscreen fallback or replay gate. Banners resize within a 96–320px viewport;
  additional content is scrollable, not clipped over navigation or controls.
  Sponsor no-fill/error/15-second timeout collapses the frame and allows retry.
- Starting another game, returning to title, changing accounts or hiding the
  document removes the **whole iframe**, stopping that context's timers and
  scripts. SDK `destroyAd()` alone only clears container content in the currently
  inspected SDK; it is not assumed to cancel network/template/timer work.
  Removed frames and old config/messages cannot reopen the placement.
- Parent messages validate exact origin, child window and a fresh nonce. Native
  link relay accepts only HTTPS `backend.tads.me` tracking links, not arbitrary
  JavaScript/hosts or reward messages. Keyboard Escape closes from the child;
  parent focus trapping includes the iframe and restores focus on close.

## CSP and containment boundaries

`/tads-frame.html` has its own no-store CSP. Enabled frames allow only the exact
provider `widget.js` and `static.js` script paths, `backend.tads.me` and
`api.tads.me` connections. Creative image hosts vary, so **HTTPS/data images**
are allowed only in this frame, not in the game. Nested frames, object content,
forms and arbitrary scripts are blocked. Existing supported Telegram ancestors
are included because the game may itself be embedded in Telegram Web.

The parent game does not gain TADS script/connect/image permissions. AdsGram's
development frame-src now includes self so these two preparations can coexist.
The iframe sandbox omits top navigation/popups/forms, but includes scripts and
same-origin for TADS origin validation and native Telegram link relay.
**This is lifecycle containment, not a security boundary from a malicious SDK**:
same-origin provider code could access its parent. Do not claim otherwise. Real
device/provider/CSP validation and publisher/privacy approval remain required.

## Evidence and provider references

Automated unit/HTTP tests exercise configuration, active-account reads, rate
limits, CSP and no reward/private routes. Client/frame fixtures exercise click
opt-in, static-only options, no-fill, bounded load, stale account/nonce/source,
frame disposal, link restrictions and unchanged scores/preferences/history.
Firefox runs normal and genuine reduced motion at phone/small-phone/landscape
sizes with a clearly labeled provider fixture in the actual iframe. No real
SDK impression, user click, provider dashboard or revenue is verified by fixtures.

Official docs/source reviewed (source inspected as data, never executed):

- [Create Widget](https://docs.tads.me/getting-started/publishers/create-widget)
  distinguishes non-rewarded TGB from rewarded click/view widgets.
- [Vanilla JS integration](https://docs.tads.me/getting-started/publishers/embed-widget/vanilla-js)
  documents `widgetId`, static `loadAd()`/`showAd()` and `onAdsNotFound`.
- [Publisher FAQ](https://docs.tads.me/getting-started/publishers/faq-publishers/faq-en)
  requires matching site domain; no-fill is normal, debug does not count.
- Public SDK/template: `https://w.tads.me/widget.js` and
  `https://w.tads.me/static.js`. Basic TGB is image/text; static templates are
  loaded asynchronously. Actual CSP/native forwarding must be tested on device.

AdsGram callback authentication, approved benefits/caps/day/human-bot policy,
live earning, Home/fullscreen inventory and trusted performance reporting are
separate future work, not silently activated by this banner.