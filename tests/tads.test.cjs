const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { readConfig } = require('../server/config.cjs');
const { readTadsConfig, tadsView } = require('../server/tads.cjs');
const { createApp } = require('../server/app.cjs');
const { hashToken } = require('../server/telegram.cjs');

test('TADS needs a separate safe numeric widget plus explicit opt-in, never changes Coin issuance', () => {
	assert.deepEqual(readTadsConfig({}), { widgetId: '', enabled: false, debug: false });
	for (const value of ['int-123', 'task-123', '0', '0123', '1.5', '-2', '9007199254740992', 'https://ads.example']) assert.throws(() => readTadsConfig({ TADS_RESULT_WIDGET_ID: value }));
	for (const key of ['TADS_DEBUG', 'TADS_RESULT_BANNER_ENABLED']) for (const value of ['yes', '1', 'TRUE']) assert.throws(() => readTadsConfig({ [key]: value }));
	assert.throws(() => readTadsConfig({ TADS_RESULT_BANNER_ENABLED: 'true' }), /requires/);
	assert.throws(() => readTadsConfig({ NODE_ENV: 'production', TADS_DEBUG: 'true' }), /not permitted/);
	const supplied = readConfig({ TADS_RESULT_WIDGET_ID: '123456' });
	assert.deepEqual(tadsView(supplied), { provider: 'tads', mode: 'disabled', widgetId: null, type: 'static', rewardsEnabled: false });
	for (const debug of [true, false]) {
		const config = readConfig({ TADS_RESULT_WIDGET_ID: '123456', TADS_RESULT_BANNER_ENABLED: 'true', TADS_DEBUG: String(debug) });
		assert.equal(tadsView(config).mode, debug ? 'debug' : 'live');
		assert.equal(tadsView(config).rewardsEnabled, false);
		assert.equal(tadsView({ ...config, production: true, tads: { ...config.tads, debug: true } }).mode, 'disabled');
	}
	const production = readConfig({ NODE_ENV: 'production', APP_ORIGIN: 'https://game.example', DATABASE_URL: 'fixture-only', TELEGRAM_BOT_TOKEN: 'fixture-only', TADS_RESULT_WIDGET_ID: '123456', TADS_RESULT_BANNER_ENABLED: 'true' });
	assert.deepEqual(tadsView(production), { provider: 'tads', mode: 'live', widgetId: '123456', type: 'static', rewardsEnabled: false });
	assert.equal(require('../server/reward-policy.cjs').rewardPolicy.issuanceEnabled, false);
});

async function api(t, env = {}) {
	const config = readConfig({ APP_ORIGIN: 'https://game.example', TELEGRAM_BOT_TOKEN: 'fixture-only', ...env });
	const token = 'b'.repeat(64); let active = true, clock = 0;
	const store = { async getSession(hash) { return active && hash === hashToken(token) ? { user: { id: 'owner' } } : null; } };
	const server = createApp({ config, store, now: () => clock, logger: { error() {} } }).listen(0, '127.0.0.1');
	await once(server, 'listening');
	t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
	return { block() { active = false; }, nextMinute() { clock += 60000; }, async request(route = '/api/tads', options = {}) {
		return fetch(`http://127.0.0.1:${server.address().port}` + route, { headers: { Cookie: config.cookieName + '=' + token }, signal: AbortSignal.timeout(5000), ...options });
	} };
}

test('TADS config authenticates active owner, rejects query/write fields and stays no-store without identity', async t => {
	const f = await api(t, { TADS_RESULT_WIDGET_ID: '123456', TADS_RESULT_BANNER_ENABLED: 'true', TADS_DEBUG: 'true' });
	assert.equal((await f.request('/api/tads', { headers: {} })).status, 401);
	const response = await f.request(); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
	assert.deepEqual(await response.json(), { provider: 'tads', mode: 'debug', widgetId: '123456', type: 'static', rewardsEnabled: false });
	assert.equal((await f.request('/api/tads?user=other')).status, 400);
	assert.equal((await f.request('/api/tads', { method: 'POST' })).status, 404);
	f.block(); assert.equal((await f.request()).status, 401);
});

test('TADS reads are limited separately from AdsGram, expire after a minute and have no settlement routes', async t => {
	const f = await api(t);
	for (let i = 0; i < 20; i++) assert.equal((await f.request()).status, 200);
	const limited = await f.request(); assert.equal(limited.status, 429); assert.equal(limited.headers.get('retry-after'), '60');
	assert.equal((await f.request('/api/adsgram')).status, 200);
	f.nextMinute(); assert.equal((await f.request()).status, 200);
	for (const route of ['/api/tads/reward', '/api/tads/webhook', '/api/tads/claim', '/server/tads.cjs', '/sec.md']) assert.equal((await f.request(route)).status, 404);
});

test('provider CSP permissions are confined to an explicit banner document, not the game; Telegram nesting allowed', async t => {
	const f = await api(t, { TADS_RESULT_WIDGET_ID: '123456', TADS_RESULT_BANNER_ENABLED: 'true' });
	const page = await f.request('/'), frame = await f.request('/tads-frame.html');
	assert.equal(frame.status, 200); assert.equal(frame.headers.get('cache-control'), 'no-store');
	assert.doesNotMatch(page.headers.get('content-security-policy'), /tads|img-src[^;]*https:/);
	const csp = frame.headers.get('content-security-policy');
	assert.match(csp, /script-src 'self' https:\/\/w.tads.me\/widget.js https:\/\/w.tads.me\/static.js;/);
	assert.match(csp, /connect-src https:\/\/backend.tads.me https:\/\/api.tads.me;/);
	assert.match(csp, /frame-src 'none'; frame-ancestors 'self' https:\/\/web.telegram.org https:\/\/\*\.telegram.org/);
	assert.doesNotMatch(csp, /unsafe-eval|script-src[^;]*unsafe-inline/);
	const disabled = await api(t); assert.doesNotMatch((await disabled.request('/tads-frame.html')).headers.get('content-security-policy'), /w\.tads.me|backend\.tads.me|api\.tads.me/);
	for (const route of ['/js/tads.js', '/js/tads-frame.js', '/style/tads-frame.css']) assert.equal((await f.request(route)).status, 200);
});