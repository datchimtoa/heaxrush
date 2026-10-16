const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { readConfig } = require('../server/config.cjs');
const { readAdsgramConfig, adsgramView } = require('../server/adsgram.cjs');
const { createApp } = require('../server/app.cjs');
const { hashToken } = require('../server/telegram.cjs');

test('AdsGram accepts only numeric rewarded IDs and explicit non-production debug configuration', () => {
	assert.deepEqual(readAdsgramConfig({}), { blockId: '', debug: false });
	assert.deepEqual(readAdsgramConfig({ ADSGRAM_REWARDED_BLOCK_ID: ' 123456 ', ADSGRAM_DEBUG: 'true' }), { blockId: '123456', debug: true });
	for (const value of ['int-123456', 'task-123456', 'bot-123456', '0', '0123', '-1', '1.5', '1;alert(1)', '1'.repeat(17)]) {
		assert.throws(() => readAdsgramConfig({ ADSGRAM_REWARDED_BLOCK_ID: value }), /numeric Reward block/);
	}
	for (const value of ['1', 'yes', 'TRUE']) assert.throws(() => readAdsgramConfig({ ADSGRAM_DEBUG: value }));
	assert.throws(() => readAdsgramConfig({ ADSGRAM_DEBUG: 'true' }), /requires/);
	assert.throws(() => readAdsgramConfig({ NODE_ENV: 'production', ADSGRAM_REWARDED_BLOCK_ID: '123456', ADSGRAM_DEBUG: 'true' }), /not permitted/);
});

test('a configured live Reward ID never enables ads/payouts; production cannot expose a debug block', () => {
	const env = { NODE_ENV: 'production', APP_ORIGIN: 'https://game.example', DATABASE_URL: 'postgres://fixture', TELEGRAM_BOT_TOKEN: 'fixture-only', ADSGRAM_REWARDED_BLOCK_ID: '123456' };
	const config = readConfig(env);
	assert.deepEqual(adsgramView(config), { provider: 'adsgram', mode: 'disabled', blockId: null, rewardsEnabled: false });
	assert.deepEqual(adsgramView({ production: true, adsgram: { blockId: '123456', debug: true } }), adsgramView(config));
	assert.equal(adsgramView({}).mode, 'disabled');
	assert.equal(adsgramView({ adsgram: { blockId: 'int-123456', debug: true } }).mode, 'disabled');
});

async function api(t, debug = false) {
	const config = readConfig({ APP_ORIGIN: 'https://game.example', TELEGRAM_BOT_TOKEN: 'fixture-only', ADSGRAM_REWARDED_BLOCK_ID: '123456', ADSGRAM_DEBUG: String(debug) });
	const token = 'a'.repeat(64), calls = [];
	let active = true;
	const store = { async getSession(hash) { calls.push(hash); return active && hash === hashToken(token) ? { user: { id: 'owner' } } : null; } };
	const server = createApp({ config, store, logger: { error() {} } }).listen(0, '127.0.0.1');
	await once(server, 'listening');
	t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
	return { calls, block() { active = false; }, async request(route = '/api/adsgram', options = {}) {
		return fetch(`http://127.0.0.1:${server.address().port}` + route, { headers: { Cookie: config.cookieName + '=' + token }, signal: AbortSignal.timeout(5000), ...options });
	} };
}

test('ad configuration is owner-authenticated, no-store, read-only, and defaults disabled', async t => {
	const f = await api(t);
	assert.equal((await f.request('/api/adsgram', { headers: {} })).status, 401);
	const response = await f.request();
	assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
	assert.deepEqual(await response.json(), { provider: 'adsgram', mode: 'disabled', blockId: null, rewardsEnabled: false });
	assert.equal((await f.request('/api/adsgram?user=other')).status, 400);
	f.block(); assert.equal((await f.request()).status, 401);
});

test('debug config exposes only the public Reward ID; production/default CSP remains unchanged', async t => {
	const normal = await api(t), debug = await api(t, true);
	const response = await debug.request(), data = await response.json();
	assert.deepEqual(data, { provider: 'adsgram', mode: 'debug', blockId: '123456', rewardsEnabled: false });
	assert.doesNotMatch(response.headers.get('content-security-policy'), /unsafe-eval|script-src[^;]*unsafe-inline|https:\/\/\*(?:[ ;]|$)/);
	assert.match(response.headers.get('content-security-policy'), /script-src 'self' https:\/\/telegram.org https:\/\/sad.adsgram.ai;/);
	assert.match(response.headers.get('content-security-policy'), /connect-src 'self' https:\/\/\*\.adsgram.ai;/);
	assert.doesNotMatch((await normal.request('/')).headers.get('content-security-policy'), /adsgram/);
	for (const key of ['token', 'telegramId', 'userId', 'balance', 'rewardAmount', 'callbackSecret']) assert.equal(data[key], undefined);
});

test('ad config reads are bounded and there is no reward callback/claim or private-file exposure', async t => {
	const f = await api(t, true);
	for (let i = 0; i < 20; i++) assert.equal((await f.request()).status, 200);
	const limited = await f.request(); assert.equal(limited.status, 429); assert.equal(limited.headers.get('retry-after'), '60');
	for (const route of ['/api/adsgram/reward?userid=12345', '/api/adsgram/claim', '/sec.md', '/server/adsgram.cjs']) assert.equal((await f.request(route)).status, 404);
	assert.equal((await f.request('/api/adsgram', { method: 'POST', headers: { Origin: 'https://game.example', 'Content-Type': 'application/json' }, body: '{}' })).status, 404);
});