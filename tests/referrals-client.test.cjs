const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const link = 'https://t.me/hexarushbot?startapp=ref_67890';
const legacyUuidLink = 'https://t.me/alodvipbot?startapp=ref_12345678-1234-4321-8123-123456789abc';
function data(inviteLink = link) { return { rulesVersion: 'hexa-rush-v1', rewardsEnabled: false, targetGames: 3, inviteLink, invitedAccounts: 5, reachedAccounts: 2 }; }
function client() {
	const elements = new Map(), requests = [], events = {}, copied = [], shared = [];
	function element(id) { if (!elements.has(id)) elements.set(id, { text: '', value: '', focus() { this.focused = true; }, select() { this.selected = true; } }); return elements.get(id); }
	const context = vm.createContext({ AbortSignal, gameState: 0, score: 54, gameTicks: 123, highscores: [0], window: {},
		navigator: { clipboard: { async writeText(value) { copied.push(value); } }, async share(value) { shared.push(value); } },
		document: { hidden: false, getElementById: element, addEventListener(name, fn) { events[name] = fn; } },
		localStorage: { getItem() { throw Error('Practice is not referral progress'); }, setItem() { throw Error('Referrals must not be cached'); } },
		$(selector) { const chain = { prop(k, v) { for (const id of selector.split(', ')) element(id.slice(1))[k] = v; return chain; },
			text(v) { for (const id of selector.split(', ')) element(id.slice(1)).text = v; return chain; },
			val(v) { element(selector.slice(1)).value = v; return chain; }, on() { return chain; } }; return chain; },
		fetch: async (url, options) => { requests.push({ url, options }); return { ok: true, json: async () => url.endsWith('/code') ? { inviteLink: link } : data() }; }
	});
	for (const file of ['session-rules', 'player', 'referrals']) vm.runInContext(readFileSync(path.join(__dirname, '../js', file + '.js'), 'utf8'), context);
	context.playerAccount = { state: 'connected', user: { id: 'owner' } }; context.activeHomeTab = 'referrals'; context.renderAccountStatus = () => {};
	return { context, element, requests, events, copied, shared };
}

test('referral guests/connecting/error states clear links and counts and cannot create/share fictitious invites', async () => {
	const f = client();
	for (const state of ['guest', 'connecting', 'error']) {
		f.context.setPlayerAccount(state); await f.context.loadReferrals(true); await f.context.copyReferralLink(); await f.context.shareReferralLink();
		assert.equal(f.element('referralLink').value, ''); assert.equal(f.element('referralSummary').hidden, true);
		assert.equal(f.element('referralInvited').text, ''); assert.equal(f.element('referralCreate').hidden, true);
	}
	assert.equal(f.requests.length, 0); assert.equal(f.copied.length, 0); assert.equal(f.shared.length, 0);
});

test('referral read and explicit empty-body creation use cookie/no-store transport; render only safe links and aggregate counts', async () => {
	const f = client(); await f.context.loadReferrals(false);
	assert.equal(f.requests[0].url, '/api/referrals'); assert.equal(f.requests[0].options.body, undefined);
	assert.equal(f.requests[0].options.credentials, 'same-origin'); assert.equal(f.requests[0].options.cache, 'no-store');
	assert.equal(f.element('referralLink').value, link); assert.equal(f.element('referralInvited').text, '5'); assert.equal(f.element('referralReached').text, '2');
	assert.equal(f.element('referralCreate').hidden, true);
	f.context.fetch = async () => ({ ok: true, json: async () => ({ ...data(null), invitedAccounts: 0, reachedAccounts: 0 }) });
	await f.context.loadReferrals(false); assert.equal(f.element('referralInvite').hidden, true); assert.equal(f.element('referralCreate').hidden, false);
	f.context.fetch = async (url, options) => { f.requests.push({ url, options }); return { ok: true, json: async () => url.endsWith('/code') ? { inviteLink: link } : data() }; };
	await f.context.loadReferrals(true); const post = f.requests.find(r => r.url.endsWith('/code'));
	assert.equal(post.options.method, 'POST'); assert.equal(post.options.body, '{}');
	assert.equal(f.element('referralInvite').hidden, false); assert.equal(f.context.score, 54); assert.equal(f.context.gameTicks, 123);
});

test('copy/share are explicitly activated, preserve cancellations and offer copy/select fallback without automatic messaging', async () => {
	const f = client(); await f.context.loadReferrals(false); assert.deepEqual(f.copied, []); assert.deepEqual(f.shared, []);
	await f.context.copyReferralLink(); assert.deepEqual(f.copied, [link]); assert.match(f.element('referralStatus').text, /copied/);
	await f.context.shareReferralLink(); assert.equal(f.shared[0].url, link); assert.match(f.shared[0].text, /Beat your best/);
	assert.doesNotMatch(f.shared[0].text, /reward|verif|entitle|review/i);
	f.context.navigator.clipboard.writeText = async () => { throw Error('denied'); }; await f.context.copyReferralLink();
	assert.equal(f.element('referralLink').selected, true); assert.equal(f.element('referralLink').focused, true);
	f.context.navigator.share = async () => { const err = Error('cancel'); err.name = 'AbortError'; throw err; }; await f.context.shareReferralLink();
	assert.match(f.element('referralStatus').text, /cancelled/);
	delete f.context.navigator.share; await f.context.shareReferralLink(); assert.match(f.element('referralStatus').text, /Copy link/);
	const telegram = []; f.context.window.Telegram = { WebApp: { openTelegramLink(url) { telegram.push(url); } } };
	await f.context.shareReferralLink(); assert.ok(telegram[0].startsWith('https://t.me/share/url?url=https%3A%2F%2Ft.me%2F'));
	assert.equal(new URL(telegram[0]).searchParams.get('url'), link, 'Telegram Share preserves the complete numeric Telegram-ID invite');
	f.context.gameState = 1; await f.context.shareReferralLink(); assert.equal(telegram.length, 1);
});

test('account switches, navigation invalidation, hidden tabs and stale POST responses cannot leak referral links or counters', async () => {
	const f = client(); f.context.initializeReferrals(); let release;
	f.context.fetch = async () => new Promise(resolve => { release = () => resolve({ ok: true, json: async () => ({ inviteLink: link }) }); });
	const pending = f.context.loadReferrals(true); f.context.activeHomeTab = 'home'; f.context.setPlayerAccount('guest'); release(); await pending;
	assert.equal(f.element('referralLink').value, ''); assert.equal(f.element('referralSummary').hidden, true);
	f.context.fetch = async () => ({ ok: true, json: async () => data() }); f.context.activeHomeTab = 'referrals';
	f.context.setPlayerAccount('connected', { id: 'second' }); await new Promise(resolve => setImmediate(resolve)); assert.equal(f.element('referralLink').value, link);
	f.context.document.hidden = true; f.events.visibilitychange(); assert.equal(f.context.referralInviteLink, null);
	f.context.document.hidden = false; f.events.visibilitychange(); await new Promise(resolve => setImmediate(resolve)); assert.equal(f.context.referralInviteLink, link);
	f.context.fetch = async () => new Promise((resolve, reject) => { release = () => reject(Error('old failure')); });
	const stale = f.context.loadReferrals(false); f.context.activeHomeTab = 'home'; f.context.setPlayerAccount('guest'); release(); await stale;
	assert.match(f.element('referralStatus').text, /Telegram/);
});

test('rapid refresh discards old successful GETs and late clipboard errors cannot overwrite a different account', async () => {
	const f = client(); let release;
	f.context.fetch = async () => new Promise(resolve => { release = () => resolve({ ok: true, json: async () => data(link) }); });
	const pending = f.context.loadReferrals(false);
	f.context.fetch = async () => ({ ok: true, json: async () => ({ ...data(null), invitedAccounts: 0, reachedAccounts: 0 }) });
	await f.context.loadReferrals(false); release(); await pending;
	assert.equal(f.context.referralInviteLink, null); assert.equal(f.element('referralCreate').hidden, false);
	f.context.fetch = async () => ({ ok: true, json: async () => data() }); await f.context.loadReferrals(false);
	f.context.navigator.clipboard.writeText = () => new Promise((resolve, reject) => { release = () => reject(Error('old clipboard failure')); });
	const clipboard = f.context.copyReferralLink(); f.context.activeHomeTab = 'home'; f.context.setPlayerAccount('guest'); release(); await clipboard;
	assert.match(f.element('referralStatus').text, /Telegram/); assert.equal(f.element('referralLink').selected, undefined);
});

test('invalid responses, hostile URLs, enabled rewards and failures leave no fabricated progress and keep retry usable', async () => {
	const f = client();
	for (const mutate of [d => { d.rewardsEnabled = true; }, d => { d.rulesVersion = 'old'; }, d => { d.targetGames = 1; },
		d => { d.invitedAccounts = -1; }, d => { d.reachedAccounts = 6; }, d => { d.reachedAccounts = 1.5; },
		d => { d.inviteLink = 'javascript:alert(1)'; }, d => { d.inviteLink = link.replace('t.me/', 't.me.evil/'); },
		d => { d.inviteLink = link + '&evil=1'; }, d => { d.inviteLink = '<img>'; }]) {
		const bad = data(); mutate(bad); f.context.fetch = async () => ({ ok: true, json: async () => bad }); await f.context.loadReferrals(false);
		assert.equal(f.element('referralLink').value, ''); assert.equal(f.element('referralSummary').hidden, true); assert.equal(f.element('referralRefresh').disabled, false);
		assert.match(f.element('referralStatus').text, /retry/);
	}
	f.context.fetch = async () => ({ ok: false }); await f.context.loadReferrals(true); assert.equal(f.element('referralCreate').hidden, true);
	f.context.fetch = async () => { throw Error('offline'); }; await f.context.loadReferrals(false); assert.match(f.element('referralStatus').text, /retry/);
	assert.doesNotMatch(readFileSync(path.join(__dirname, '../js/referrals.js'), 'utf8'), /innerHTML|\.html\(|localStorage|initDataUnsafe|tgWebAppStartParam/);
});

test('invite links accept numeric Telegram IDs and legacy links, never malformed IDs or unsigned ref query fields', () => {
	const f = client();
	assert.equal(f.context.validReferralLink(link), true);
	assert.equal(f.context.validReferralLink(legacyUuidLink), true);
	assert.equal(f.context.validReferralLink('https://t.me/alodvipbot?startapp=ref_' + 'a'.repeat(32)), true);
	assert.equal(f.context.validReferralLink(link.replace('67890', '9007199254740991')), true);
	for (const invalid of [link.replace('startapp=', 'ref='), link.replace(/ref_.*/, 'ref_0'), link.replace(/ref_.*/, 'ref_067890'), link.replace(/ref_.*/, 'ref_-1'), link.replace(/ref_.*/, 'ref_1.5'), link.replace(/ref_.*/, 'ref_9007199254740992'), link.replace(/ref_.*/, 'ref_12345678901234567'), link + '&ref=12345', legacyUuidLink.replace('123456789abc', '123456789xyz')]) {
		assert.equal(f.context.validReferralLink(invalid), false);
	}
});

test('invite panel distinguishes link creation, ready and zero-progress states without rewards or invented friends', async () => {
	const f = client();
	f.context.fetch = async () => ({ ok: true, json: async () => ({ ...data(null), invitedAccounts: 0, reachedAccounts: 0 }) });
	await f.context.loadReferrals(false);
	assert.match(f.element('referralStatus').text, /Create your link/);
	assert.equal(f.element('referralCreate').hidden, false);
	assert.equal(f.element('referralInvite').hidden, true);
	assert.equal(f.element('referralInvited').text, '0'); assert.equal(f.element('referralReached').text, '0');
	f.context.fetch = async () => ({ ok: true, json: async () => ({ ...data(), invitedAccounts: 0, reachedAccounts: 0 }) });
	await f.context.loadReferrals(false);
	assert.match(f.element('referralStatus').text, /Your link is ready/);
	assert.equal(f.element('referralCreate').hidden, true); assert.equal(f.element('referralInvite').hidden, false);
	assert.equal(f.element('referralInvited').text, '0'); assert.equal(f.element('referralReached').text, '0');
	assert.equal(f.element('referralLink').value, link);
});

test('referral redesign retains labeled selectable links, one primary share action and private account-only stats', () => {
	const html = readFileSync(path.join(__dirname, '../index.html'), 'utf8');
	const panel = html.split('<section data-home-panel="referrals"')[1].split('<section data-home-panel="wallet"')[0];
	assert.match(panel, /class="menu-sheet referral-sheet"/);
	assert.match(panel, /id="referralsTitle">Referrals/);
	assert.match(panel, /Better with <span>friends\./);
	assert.match(panel, /id="referralStatus"[^>]*role="status"/);
	assert.match(panel, /label for="referralLink"/);
	assert.match(panel, /textarea id="referralLink"[^>]*readonly/);
	assert.match(panel, /id="referralShare" class="primary-button"/);
	assert.match(panel, /id="referralCopy" class="secondary-button"/);
	assert.match(panel, /aria-label="Your crew" hidden/);
	assert.match(panel, /aria-label="How invites work"/);
	assert.match(panel, /Referral rewards are not active/);
	assert.doesNotMatch(panel, /leaderboard-status|daily-reward-notice|claim|earn \d|@[a-z]|https:\/\/t\.me/i);
});