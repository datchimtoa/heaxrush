const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture(standalone = false) {
	const events = {}, messages = [], scripts = [], calls = [], timers = new Map(), slot = { id: '', querySelector() { return this.button || null; } };
	let measure, pagehide;
	const parent = { postMessage(data, origin) { messages.push({ data, origin }); } };
	const context = vm.createContext({
		window: { parent, location: { origin: 'https://game.example' }, addEventListener(name, fn) { events[name] = fn; if (name === 'pagehide') pagehide = fn; } },
		document: { body: { scrollHeight: 112 }, head: { appendChild(script) { scripts.push(script); } }, getElementById() { return { appendChild() {} }; },
			createElement(type) { return type === 'div' ? slot : { remove() {} }; }, addEventListener(name, fn) { events[name] = fn; } },
		MutationObserver: class { constructor(fn) { measure = fn; } observe() {} disconnect() { calls.push('mutation-disconnect'); } },
		ResizeObserver: class { observe() {} disconnect() { calls.push('resize-disconnect'); } },
		setTimeout(fn, ms) { timers.set(1, { fn, ms }); return 1; }, clearTimeout(id) { timers.delete(id); }
	});
	if (standalone) context.window.parent = context.window;
	vm.runInContext(readFileSync(path.join(__dirname, '../js/tads-frame.js'), 'utf8'), context);
	const data = { provider: 'hexa-tads', type: 'init', nonce: 'a'.repeat(32), widgetId: '123456', debug: true, initData: 'fixture-only', user: { id: 12345, first_name: 'Fixture' } };
	async function init(change = {}, source = parent, origin = 'https://game.example') { await events.message?.({ source, origin, data: { ...data, ...change } }); }
	function sdk(mode = 'success') { context.window.tads = { init(options) {
		calls.push(options); return { async loadAd() { calls.push('load'); if (mode === 'no-fill') { options.onAdsNotFound(); throw Error('No fill'); } },
			async showAd() { calls.push('show'); slot.button = {}; measure(); }, destroyAd() { calls.push('destroy'); } };
	} }; }
	return { context, events, messages, scripts, calls, timers, slot, data, init, sdk, close() { pagehide(); } };
}

test('frame does nothing standalone; only the exact parent/origin and valid data can initialize provider', async () => {
	const standalone = fixture(true); assert.equal(standalone.messages.length, 0); assert.equal(standalone.scripts.length, 0);
	const f = fixture(); assert.equal(f.messages[0].data.type, 'ready');
	await f.init({}, {}, 'https://game.example'); await f.init({}, undefined, 'https://evil.example');
	for (const change of [{ nonce: 'x' }, { widgetId: 'int-123' }, { widgetId: '9007199254740992' }, { debug: 'false' }, { initData: '' }, { user: { id: 0 } }]) await f.init(change);
	assert.equal(f.scripts.length, 0); assert.equal(f.context.window.Telegram, undefined);
});

test('frame uses static debug/live API without reward callbacks; render messages are diagnostics only', async () => {
	for (const debug of [true, false]) {
		const f = fixture(); f.sdk(); await f.init({ debug }); await f.init();
		assert.equal(f.calls.filter(c => c && typeof c === 'object').length, 1);
		const options = f.calls[0]; assert.equal(options.widgetId, 123456); assert.equal(options.type, 'static'); assert.equal(options.debug, debug);
		assert.equal(options.onShowReward, undefined); assert.equal(options.onClickReward, undefined);
		assert.equal(f.slot.id, 'tads-container-123456'); assert.equal(f.scripts.length, 0);
		assert.ok(f.messages.some(m => m.data.type === 'rendered' && m.data.nonce === f.data.nonce && m.data.height === 112));
		f.close(); assert.ok(f.calls.includes('destroy')); assert.ok(f.calls.includes('resize-disconnect'));
	}
});

test('no-fill and native link/Escape relays carry no rewards or arbitrary Telegram events', async () => {
	const f = fixture(); f.sdk('no-fill'); await f.init(); assert.ok(f.messages.some(m => m.data.type === 'unavailable'));
	f.context.window.TelegramWebviewProxy.postEvent('web_app_open_link', JSON.stringify({ url: 'https://backend.tads.me/click' }));
	assert.equal(f.messages.at(-1).data.type, 'link');
	const count = f.messages.length; f.context.window.TelegramWebviewProxy.postEvent('web_app_data_send', '{}'); assert.equal(f.messages.length, count);
	f.events.keydown({ key: 'Escape', preventDefault() {} }); assert.equal(f.messages.at(-1).data.type, 'close');
});

test('frame loads only the official SDK after parent handshake; load failure reports unavailable', async () => {
	const f = fixture(); const pending = f.init(); await Promise.resolve();
	assert.equal(f.scripts.length, 1); assert.equal(f.scripts[0].src, 'https://w.tads.me/widget.js');
	f.scripts[0].onerror(); await pending; assert.equal(f.messages.at(-1).data.type, 'unavailable');
	const stalled = fixture(); const waiting = stalled.init(); await Promise.resolve();
	const timeout = stalled.timers.get(1); assert.equal(timeout.ms, 8000); timeout.fn(); await waiting;
	assert.equal(stalled.messages.at(-1).data.type, 'unavailable');
});