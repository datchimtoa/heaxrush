const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

function fixture() {
	const elements = new Map(), requests = [], frames = [], events = {}, timers = new Map(), links = [];
	let timer = 0;
	function element(id) { if (!elements.has(id)) elements.set(id, { hidden: true, text: '', focus() { this.focused = true; }, appendChild(frame) { frames.push(frame); } }); return elements.get(id); }
	const context = vm.createContext({ AbortSignal, crypto: webcrypto, URL,
		gameState: 2, score: 50, gameTicks: 123, playerRecords: { runs: 4 }, playerPreferences: { sound: false }, officialRun: { verified: true },
		playerAccount: { state: 'connected', user: { id: 'owner', telegramId: '12345', firstName: 'Fixture' } },
		window: { location: { origin: 'https://game.example' }, Telegram: { WebApp: { initData: 'fixture-only', openLink(url) { links.push(url); } } }, addEventListener(name, fn) { events[name] = fn; } },
		document: { hidden: false, addEventListener(name, fn) { events[name] = fn; }, getElementById: element, createElement(type) {
			assert.equal(type, 'iframe'); return { style: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, remove() { this.removed = true; }, contentWindow: { messages: [], postMessage(data, origin) { this.messages.push({ data, origin }); } } };
		} },
		$(selector) { const chain = { prop(k, v) { for (const key of selector.split(', ')) element(key.slice(1))[k] = v; return chain; }, text(v) { element(selector.slice(1)).text = v; return chain; } }; return chain; },
		setTimeout(fn, ms) { const id = ++timer; timers.set(id, { fn, ms }); return id; }, clearTimeout(id) { timers.delete(id); },
		localStorage: { getItem() { throw Error('No practice records'); }, setItem() { throw Error('No local ad authority'); } },
		fetch: async (route, options) => { requests.push({ route, options }); return { ok: true, json: async () => ({ provider: 'tads', mode: 'live', widgetId: '123456', type: 'static', rewardsEnabled: false }) }; }
	});
	vm.runInContext(readFileSync(path.join(__dirname, '../js/tads.js'), 'utf8'), context);
	function message(type, extra = {}, source = context.resultBannerFrame?.contentWindow, origin = 'https://game.example') {
		events.message({ source, origin, data: { provider: 'hexa-tads', type, nonce: context.resultBannerNonce, ...extra } });
	}
	return { context, element, requests, frames, events, timers, links, message };
}

test('banner config is invisible for practice/guests/unfinished/hidden/non-Telegram contexts', async () => {
	for (const change of [c => { c.gameState = 0; }, c => { c.gameState = 1; }, c => { c.gameState = -1; }, c => { c.officialRun = null; }, c => { c.officialRun.verified = false; }, c => { c.playerAccount.state = 'guest'; }, c => { c.document.hidden = true; }, c => { c.window.Telegram.WebApp.initData = ''; }]) {
		const f = fixture(); change(f.context); await f.context.loadResultBanner(); f.context.showResultBanner();
		assert.equal(f.requests.length, 0); assert.equal(f.frames.length, 0); assert.equal(f.element('resultSponsorOpen').hidden, true);
	}
});

test('config uses a no-store cookie GET, never preloads ads; opt-in constructs only one local frame', async () => {
	const f = fixture(); await f.context.loadResultBanner();
	assert.equal(f.requests[0].route, '/api/tads'); assert.equal(f.requests[0].options.credentials, 'same-origin'); assert.equal(f.requests[0].options.cache, 'no-store'); assert.equal(f.requests[0].options.body, undefined);
	assert.equal(f.frames.length, 0); assert.match(f.element('resultSponsorStatus').text, /Telegram launch\/profile data.*No game reward/);
	f.context.showResultBanner(); f.context.showResultBanner(); assert.equal(f.frames.length, 1);
	assert.equal(f.frames[0].src, '/tads-frame.html'); assert.equal(f.frames[0].attrs.sandbox, 'allow-scripts allow-same-origin');
	assert.equal(f.element('resultSponsorOpen').disabled, true);
	f.message('ready'); f.message('ready');
	assert.equal(f.frames[0].contentWindow.messages.length, 1);
	const init = f.frames[0].contentWindow.messages[0]; assert.equal(init.origin, 'https://game.example'); assert.equal(init.data.user.id, 12345); assert.equal(init.data.debug, false); assert.equal(init.data.initData, 'fixture-only');
	assert.equal(f.frames[0].src.includes('fixture-only'), false); assert.equal(init.data.cookie, undefined);
});

test('malformed configuration, rewarding/fullscreen modes and network failures stay collapsed', async () => {
	for (const changes of [{ mode: 'disabled' }, { rewardsEnabled: true }, { type: 'fullscreen' }, { widgetId: 'int-123' }, { widgetId: 123 }, { widgetId: '9007199254740992' }]) {
		const f = fixture(); f.context.fetch = async () => ({ ok: true, json: async () => ({ provider: 'tads', mode: 'live', widgetId: '123456', type: 'static', rewardsEnabled: false, ...changes }) });
		await f.context.loadResultBanner(); f.context.showResultBanner(); assert.equal(f.frames.length, 0); assert.equal(f.element('resultSponsor').hidden, true);
	}
	const f = fixture(); f.context.fetch = async () => { throw Error('offline'); }; await f.context.loadResultBanner(); assert.equal(f.element('resultSponsor').hidden, true);
});

test('stale account config cannot reopen banners; visibility/run/account resets remove frames and timeouts', async () => {
	const f = fixture(); let resolve;
	f.context.fetch = () => new Promise(r => { resolve = r; }); const pending = f.context.loadResultBanner(); f.context.resetResultBanner(); f.context.playerAccount.user.id = 'other';
	resolve({ ok: true, json: async () => ({ provider: 'tads', mode: 'live', widgetId: '123456', type: 'static', rewardsEnabled: false }) }); await pending;
	assert.equal(f.element('resultSponsor').hidden, true);
	const g = fixture(); await g.context.loadResultBanner(); g.context.showResultBanner(); const frame = g.frames[0];
	g.context.document.hidden = true; g.events.visibilitychange(); assert.equal(frame.removed, true); assert.equal(g.timers.size, 0); assert.equal(g.element('resultSponsor').hidden, true);
	g.message('rendered', { height: 200 }, frame.contentWindow); assert.equal(g.element('resultSponsor').hidden, true);
});

test('render, no-fill/close and timeout clean up without changing scores, preferences, ledger or records', async () => {
	const f = fixture(); await f.context.loadResultBanner();
	const before = JSON.stringify([f.context.score, f.context.gameTicks, f.context.playerAccount, f.context.playerRecords, f.context.playerPreferences, f.context.officialRun]);
	f.context.showResultBanner(); f.message('ready'); f.message('rendered', { height: 600 });
	assert.equal(f.frames[0].style.height, '320px'); assert.equal(f.timers.size, 0); assert.match(f.element('resultSponsorStatus').text, /Advertisement.*No game reward/);
	f.message('reward', { amount: 100 }); assert.equal(f.requests.length, 1);
	f.message('close'); assert.equal(f.frames[0].removed, true); assert.equal(f.element('resultSponsorOpen').focused, true);
	f.context.showResultBanner(); f.message('ready'); f.message('unavailable'); assert.equal(f.frames[1].removed, true); assert.match(f.element('resultSponsorStatus').text, /No sponsor/);
	f.context.showResultBanner(); [...f.timers.values()][0].fn(); assert.equal(f.frames[2].removed, true); assert.equal(f.element('resultSponsorOpen').disabled, false);
	assert.equal(before, JSON.stringify([f.context.score, f.context.gameTicks, f.context.playerAccount, f.context.playerRecords, f.context.playerPreferences, f.context.officialRun]));
});

test('frame messages require exact origin/window/nonce; only HTTPS TADS tracking links reach native openLink', async () => {
	const f = fixture(); await f.context.loadResultBanner(); f.context.showResultBanner();
	f.message('ready', {}, {}, 'https://game.example'); assert.equal(f.frames[0].contentWindow.messages.length, 0);
	f.message('ready', {}, f.frames[0].contentWindow, 'https://evil.example'); assert.equal(f.frames[0].contentWindow.messages.length, 0);
	f.message('ready');
	for (const url of ['javascript:alert(1)', 'https://evil.example', 'https://backend.tads.me.evil.example', 'http://backend.tads.me/click', 'https://name:pass@backend.tads.me/click']) f.message('link', { url });
	f.message('link', { url: 'https://backend.tads.me/click?a=1', nonce: 'wrong' }); assert.equal(f.links.length, 0);
	f.message('link', { url: 'https://backend.tads.me/click?a=1' }); assert.deepEqual(f.links, ['https://backend.tads.me/click?a=1']);
	f.message('rendered', { height: Infinity }); assert.equal(f.frames[0].style.height, undefined);
});

test('real lifecycle entry points reset the banner before navigation, account replacement or a new start request', () => {
	for (const [file, pattern] of [
		['main.js', /function init\(seed\) \{[\s\S]*?resetResultBanner\(\)[\s\S]*?abandonOfficialRun\(\)/],
		['main.js', /function setStartScreen\(\) \{\s*init\(\)/],
		['sessions.js', /resetResultBanner\(\)[\s\S]*?runStarting = true[\s\S]*?await abandonOfficialRun\(\)/],
		['player.js', /function setPlayerAccount[\s\S]*?resetResultBanner\(\)[\s\S]*?playerAccount =/],
		['view.js', /function gameOverDisplay[\s\S]*?resetResultBanner\(\)/]
	]) assert.match(readFileSync(path.join(__dirname, '../js', file), 'utf8'), pattern);
});