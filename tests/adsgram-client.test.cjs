const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture() {
	const elements = new Map(), requests = [], scripts = [], timers = new Map(), sdkCalls = [];
	let timerId = 0;
	function element(id) { if (!elements.has(id)) elements.set(id, { hidden: true, text: '' }); return elements.get(id); }
	const context = vm.createContext({ AbortSignal,
		gameState: 2, officialRun: { id: 'saved-game', verified: true },
		playerAccount: { state: 'connected', user: { id: 'owner', officialBest: 38 } },
		score: 38, gameTicks: 3333, playerRecords: { runs: 7 },
		window: { Telegram: { WebApp: {} } },
		document: { hidden: false, createElement() { return { remove() { this.removed = true; } }; }, head: { appendChild(script) { scripts.push(script); } } },
		$(selector) { const chain = { prop(k, v) { element(selector)[k] = v; return chain; }, text(v) { element(selector).text = v; return chain; } }; return chain; },
		setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; }, clearTimeout(id) { timers.delete(id); },
		localStorage: { getItem() { throw Error('Ads cannot read practice'); }, setItem() { throw Error('Ads cannot authorize rewards'); } },
		fetch: async (route, options) => { requests.push({ route, options }); return { ok: true, json: async () => ({ provider: 'adsgram', mode: 'debug', blockId: '123456', rewardsEnabled: false }) }; }
	});
	vm.runInContext(readFileSync(path.join(__dirname, '../js/adsgram.js'), 'utf8'), context);
	function sdk(show = async () => ({ done: true, error: false })) {
		context.window.Adsgram = { init(options) { sdkCalls.push(JSON.parse(JSON.stringify(options))); return { show, destroy() { sdkCalls.push('destroy'); } }; } };
	}
	return { context, element, requests, scripts, timers, sdkCalls, sdk };
}
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }

test('only a visible saved account result with Telegram can request optional ad configuration', async () => {
	for (const change of [c => { c.gameState = 1; }, c => { c.gameState = 0; }, c => { c.gameState = -1; }, c => { c.officialRun = null; }, c => { c.officialRun.verified = false; }, c => { c.playerAccount.state = 'guest'; }, c => { c.document.hidden = true; }, c => { delete c.window.Telegram; }]) {
		const f = fixture(); change(f.context); await f.context.loadResultAd(); assert.equal(f.requests.length, 0); assert.equal(f.element('#resultAdCheck').hidden, true);
	}
});

test('debug config uses an owner cookie/no-store GET and never eagerly loads the provider SDK', async () => {
	const f = fixture(); await f.context.loadResultAd();
	assert.equal(f.requests.length, 1); assert.equal(f.requests[0].route, '/api/adsgram');
	assert.equal(f.requests[0].options.credentials, 'same-origin'); assert.equal(f.requests[0].options.cache, 'no-store'); assert.equal(f.requests[0].options.body, undefined);
	assert.equal(f.element('#resultAdCheck').hidden, false); assert.equal(f.scripts.length, 0);
	assert.match(f.element('#resultAdStatus').text, /No reward/);
});

test('disabled, malformed, enabled-reward or failing configuration never offers an ad', async () => {
	for (const data of [{ mode: 'disabled' }, { provider: 'adsgram', mode: 'debug', rewardsEnabled: true, blockId: '123456' },
		{ provider: 'adsgram', mode: 'debug', rewardsEnabled: false, blockId: 'int-123456' }, { provider: 'adsgram', mode: 'debug', rewardsEnabled: false, blockId: 123456 }]) {
		const f = fixture(); f.context.fetch = async () => ({ ok: true, json: async () => data }); await f.context.loadResultAd(); await f.context.showResultAdCheck();
		assert.equal(f.element('#resultAdCheck').hidden, true); assert.equal(f.element('#resultAdButton').hidden, true); assert.equal(f.scripts.length, 0);
	}
	const f = fixture(); f.context.fetch = async () => { throw Error('offline'); }; await f.context.loadResultAd(); assert.equal(f.element('#resultAdCheck').hidden, true);
});

test('SDK completion is diagnostic only: no score, practice, account, balance or reward mutation', async () => {
	const f = fixture(); await f.context.loadResultAd(); f.sdk();
	const before = JSON.stringify([f.context.score, f.context.gameTicks, f.context.playerAccount, f.context.playerRecords, f.context.officialRun]);
	await f.context.showResultAdCheck();
	assert.deepEqual(f.sdkCalls, [{ blockId: '123456', debug: true, debugConsole: false, debugBannerType: 'RewardedVideo' }, 'destroy']);
	assert.match(f.element('#resultAdStatus').text, /Test ad completed.*No reward/);
	assert.equal(before, JSON.stringify([f.context.score, f.context.gameTicks, f.context.playerAccount, f.context.playerRecords, f.context.officialRun]));
	assert.equal(f.requests.length, 1); assert.equal(f.context.resultAdBusy, false); assert.equal(f.timers.size, 0);
});

test('SDK is lazy, shared, removable on failure, and a later explicit click can retry', async () => {
	const f = fixture(); await f.context.loadResultAd();
	const first = f.context.showResultAdCheck(); await settle();
	assert.equal(f.scripts.length, 1); assert.equal(f.scripts[0].src, 'https://sad.adsgram.ai/js/sad.min.js');
	f.scripts[0].onerror(); await first;
	assert.equal(f.scripts[0].removed, true); assert.equal(f.context.adsgramSdkPromise, null); assert.match(f.element('#resultAdStatus').text, /unavailable/);
	const second = f.context.showResultAdCheck(); await settle(); assert.equal(f.scripts.length, 2);
	f.sdk(); f.scripts[1].onload(); await second; assert.match(f.element('#resultAdStatus').text, /completed/);
});

test('duplicate clicks, skips, no-fill and SDK exceptions never credit or trap the result', async () => {
	for (const show of [async () => ({ done: false, error: false }), async () => { throw Error('no fill'); }]) {
		const f = fixture(); await f.context.loadResultAd(); f.sdk(show); await f.context.showResultAdCheck();
		assert.match(f.element('#resultAdStatus').text, /No reward/); assert.equal(f.element('#resultAdButton').disabled, false);
	}
	const f = fixture(); await f.context.loadResultAd(); let finish; f.sdk(() => new Promise(resolve => { finish = resolve; }));
	const pending = f.context.showResultAdCheck(); await settle(); await f.context.showResultAdCheck();
	assert.equal(f.sdkCalls.length, 1); finish({ done: true, error: false }); await pending; assert.equal(f.requests.length, 1);
});

test('account/new-run resets discard stale config, cancel/destroy playback and ignore late success', async () => {
	const f = fixture(); let release;
	f.context.fetch = async () => new Promise(resolve => { release = () => resolve({ ok: true, json: async () => ({ provider: 'adsgram', mode: 'debug', rewardsEnabled: false, blockId: '123456' }) }); });
	const read = f.context.loadResultAd(); await settle(); f.context.resetResultAd(); f.context.playerAccount.user.id = 'other'; release(); await read;
	assert.equal(f.element('#resultAdCheck').hidden, true);
	const g = fixture(); await g.context.loadResultAd(); let finish; g.sdk(() => new Promise(resolve => { finish = resolve; }));
	const pending = g.context.showResultAdCheck(); await settle(); g.context.resetResultAd(); await pending;
	assert.equal(g.sdkCalls.at(-1), 'destroy'); assert.equal(g.element('#resultAdCheck').hidden, true); assert.equal(g.timers.size, 0);
	finish({ done: true, error: false }); await settle(); assert.equal(g.element('#resultAdStatus').text, '');
});

test('timeout/hidden/new-run while loading SDK cannot start a late ad or leave controls busy', async () => {
	for (const cancel of ['timeout', 'hidden', 'new-run']) {
		const f = fixture(); await f.context.loadResultAd(); const pending = f.context.showResultAdCheck(); await settle();
		if (cancel === 'timeout') [...f.timers.values()].find(t => t.ms === 90000).fn();
		else { if (cancel === 'hidden') f.context.document.hidden = true; else f.context.gameState = 1; f.context.resetResultAd(); }
		await pending;
		f.sdk(); f.scripts[0].onload(); await settle(); assert.equal(f.sdkCalls.length, 0); assert.equal(f.context.resultAdBusy, false);
	}
});