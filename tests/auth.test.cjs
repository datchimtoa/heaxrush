const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { once } = require('node:events');
const { createApp } = require('../server/app.cjs');
const { createStore } = require('../server/store.cjs');
const { readConfig } = require('../server/config.cjs');
const { AuthError, validateTelegramData, hashToken } = require('../server/telegram.cjs');

const botToken = '123456:test-only-not-a-real-bot-token';
const now = 1800000000000;
const user = { id: 178633587, first_name: 'Player <b>', last_name: 'One', username: 'player_one', language_code: 'en' };
function signed(overrides = {}, token = botToken) {
	const values = { auth_date: String(now / 1000), query_id: 'test-query', user: JSON.stringify(user), ...overrides };
	const fields = new URLSearchParams(Object.entries(values).reverse());
	const checkString = Object.entries(values).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => key + '=' + value).join('\n');
	const secret = createHmac('sha256', 'WebAppData').update(token).digest();
	fields.set('hash', createHmac('sha256', secret).update(checkString).digest('hex'));
	return fields.toString();
}

// Test double only. The production process always uses PostgreSQL, never memory.
function memoryStore() {
	const accounts = new Map();
	const sessions = new Map();
	const launches = new Set();
	return {
		accounts, sessions, launches, fail: false, calls: 0, launchRecords: [],
		async recordLaunch(userId) { this.launchRecords.push(userId); },
		async health() { if (this.fail) throw Error('database unavailable'); },
		async login(input) {
			this.calls++;
			if (this.fail) throw Error('private database details');
			if (launches.has(input.launchHash)) throw new AuthError('Telegram launch already used; reopen the Mini App');
			launches.add(input.launchHash);
			const account = accounts.get(input.user.telegramId) || { id: 'test-user', ...input.user };
			accounts.set(input.user.telegramId, account);
			sessions.set(input.tokenHash, { user: account, launchHash: input.launchHash, expiresAt: input.expiresAt });
			return account;
		},
		async getSession(hash) {
			if (this.fail) throw Error('database unavailable');
			const session = sessions.get(hash);
			return session && !session.revoked && session.expiresAt.getTime() > now ? session : null;
		},
		async revoke(hash) { if (sessions.has(hash)) sessions.get(hash).revoked = true; }
	};
}

async function api(t, overrides = {}) {
	const store = memoryStore();
	const config = { ...readConfig({ APP_ORIGIN: 'https://game.example', TELEGRAM_BOT_TOKEN: botToken }), ...overrides };
	const app = createApp({ config, store, now: () => now, logger: { error() {} } });
	const server = app.listen(0, '127.0.0.1');
	await once(server, 'listening');
	t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
	const base = `http://127.0.0.1:${server.address().port}`;
	function request(route, body, options = {}) {
		return fetch(base + route, {
			method: body === undefined ? 'GET' : 'POST',
			headers: { Origin: config.origin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...options.headers },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
			...options, signal: AbortSignal.timeout(5000)
		});
	}
	return { store, config, request };
}

test('Telegram HMAC authenticates sorted decoded fields and signed Unicode names', () => {
	const data = validateTelegramData(signed({ user: JSON.stringify({ ...user, first_name: 'Minh + Café 🟣' }), signature: 'optional-signature' }), botToken, now);
	assert.equal(data.user.firstName, 'Minh + Café 🟣');
	assert.equal(data.user.telegramId, String(user.id));
	assert.match(data.launchHash, /^[a-f\d]{64}$/);
});

test('Telegram rejects tampered user data, wrong bot token, missing or malformed hash', () => {
	const original = signed();
	for (const invalid of [original.replace('test-query', 'forged-query'), original + '&hash=abcd', original.replace(/hash=[^&]+/, 'hash=abcd'), original.replace(/&hash=[^&]+/, '')]) {
		assert.throws(() => validateTelegramData(invalid, botToken, now), AuthError);
	}
	assert.throws(() => validateTelegramData(original, 'wrong-token', now), AuthError);
});

test('Telegram freshness enforces five minutes and a small future clock skew', () => {
	assert.doesNotThrow(() => validateTelegramData(signed({ auth_date: String(now / 1000 - 300) }), botToken, now));
	for (const date of [now / 1000 - 301, now / 1000 + 31, 'bad', '1e9']) {
		assert.throws(() => validateTelegramData(signed({ auth_date: String(date) }), botToken, now), AuthError);
	}
});

test('Telegram rejects duplicates, malformed payloads, missing user, unsafe IDs, and oversized data', () => {
	for (const input of [signed() + '&user=extra', '%XX', 'x'.repeat(16001), null, {}, '', signed({ user: 'invalid-json' }), signed({ user: 'null' }), signed({ user: JSON.stringify({ ...user, id: 0 }) }), signed({ user: JSON.stringify({ ...user, id: Number.MAX_SAFE_INTEGER + 1 }) }), signed({ user: JSON.stringify({ ...user, username: 123 }) })]) {
		assert.throws(() => validateTelegramData(input, botToken, now), AuthError);
	}
});

test('HTTP login sets a protected cookie and stores only its hash; me authenticates the same user', async t => {
	const { store, request } = await api(t, { production: true, cookieName: '__Host-hexaRushSession' });
	const login = await request('/api/auth/telegram', { initData: signed() });
	assert.equal(login.status, 200);
	const cookie = login.headers.get('set-cookie');
	assert.match(cookie, /HttpOnly/);
	assert.match(cookie, /Secure/);
	assert.match(cookie, /SameSite=None/);
	assert.match(cookie, /Partitioned/);
	assert.match(cookie, /Path=\//);
	const token = cookie.split(';')[0].split('=')[1];
	assert.equal(store.sessions.has(token), false);
	assert.equal(store.sessions.has(hashToken(token)), true);
	const body = await login.json();
	assert.equal(body.user.telegramId, String(user.id));
	assert.equal(body.gameplayMode, 'practice');
	assert.equal(body.token, undefined);
	assert.equal(body.coins, undefined);
	const me = await request('/api/auth/me', undefined, { headers: { Cookie: cookie.split(';')[0] } });
	assert.equal(me.status, 200);
	assert.equal((await me.json()).user.telegramId, String(user.id));
	assert.equal(me.headers.get('cache-control'), 'no-store');
	assert.match(me.headers.get('content-security-policy'), /script-src 'self' https:\/\/telegram.org;/);
});

test('a launch cannot log in twice without the same session cookie; same-cookie retries are idempotent', async t => {
	const { store, request } = await api(t);
	const body = { initData: signed() };
	const first = await request('/api/auth/telegram', body);
	const cookie = first.headers.get('set-cookie').split(';')[0];
	assert.equal((await request('/api/auth/telegram', body)).status, 401);
	const retry = await request('/api/auth/telegram', body, { headers: { Cookie: cookie, Origin: 'https://game.example', 'Content-Type': 'application/json' } });
	assert.equal(retry.status, 200);
	assert.equal(retry.headers.get('set-cookie'), null);
	assert.equal(store.sessions.size, 1);
	assert.deepEqual(store.launchRecords, ['test-user']);
});

test('only validated same-launch POST retries record a streak; cookie reads, bad data and failed login never record one', async t => {
	const { store, request } = await api(t);
	const body = { initData: signed() };
	const first = await request('/api/auth/telegram', body);
	const cookie = first.headers.get('set-cookie').split(';')[0];
	const headers = { Cookie: cookie, Origin: 'https://game.example', 'Content-Type': 'application/json' };
	assert.equal((await request('/api/auth/me', undefined, { headers: { Cookie: cookie } })).status, 200);
	assert.equal((await request('/api/auth/telegram', { initData: '' }, { headers })).status, 401);
	assert.equal((await request('/api/auth/telegram', { initData: signed({ auth_date: String(now / 1000 - 301) }) }, { headers })).status, 401);
	assert.equal((await request('/api/auth/telegram', body, { headers: { ...headers, Origin: 'https://other.example' } })).status, 403);
	assert.equal((await request('/api/auth/telegram', body)).status, 401);
	assert.deepEqual(store.launchRecords, []);
	assert.equal((await request('/api/auth/telegram', body, { headers })).status, 200);
	assert.equal((await request('/api/auth/telegram', body, { headers })).status, 200);
	assert.deepEqual(store.launchRecords, ['test-user', 'test-user'], 'the trusted recorder deduplicates by UTC day, not by POST count');
	store.recordLaunch = async () => { throw Error('private streak database detail'); };
	const failed = await request('/api/auth/telegram', body, { headers });
	assert.equal(failed.status, 503); assert.doesNotMatch(await failed.text(), /private|database|streak/);
});

test('login rejects forged identities/rewards, cross-origin writes, and oversized or invalid JSON', async t => {
	const { store, request } = await api(t);
	assert.equal((await request('/api/auth/telegram', { user, coins: 999 })).status, 400);
	assert.equal((await request('/api/auth/telegram', { initData: signed(), score: 999 })).status, 400);
	const crossOrigin = await request('/api/auth/telegram', { initData: signed() }, { headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' } });
	assert.equal(crossOrigin.status, 403);
	assert.equal((await crossOrigin.json()).code, 'ORIGIN_NOT_ALLOWED');
	assert.equal((await request('/api/auth/telegram', { initData: signed() }, { headers: { 'Content-Type': 'application/json' } })).status, 403);
	assert.equal((await request('/api/auth/telegram', { initData: 'x'.repeat(30000) })).status, 413);
	assert.equal((await request('/api/auth/telegram', {}, { body: '{bad json' })).status, 400);
	assert.equal(store.calls, 0);
});

test('unauthenticated, malformed, duplicate, expired, and revoked cookies cannot access a profile', async t => {
	const { store, request } = await api(t);
	assert.equal((await request('/api/auth/me')).status, 401);
	const login = await request('/api/auth/telegram', { initData: signed() });
	const cookie = login.headers.get('set-cookie').split(';')[0];
	for (const invalid of ['hexaRushSession=bad', cookie + '; ' + cookie]) {
		assert.equal((await request('/api/auth/me', undefined, { headers: { Cookie: invalid } })).status, 401);
	}
	const session = [...store.sessions.values()][0];
	session.expiresAt = new Date(now - 1);
	assert.equal((await request('/api/auth/me', undefined, { headers: { Cookie: cookie } })).status, 401);
	session.expiresAt = new Date(now + 1000);
	const logout = await request('/api/auth/logout', {}, { headers: { Cookie: cookie, Origin: 'https://game.example', 'Content-Type': 'application/json' } });
	assert.equal(logout.status, 204);
	assert.match(logout.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/);
	assert.equal((await request('/api/auth/me', undefined, { headers: { Cookie: cookie } })).status, 401);
});

test('login rate limiting rejects excess attempts and does not affect gameplay assets', async t => {
	const { request } = await api(t);
	for (let i = 0; i < 20; i++) assert.equal((await request('/api/auth/telegram', { initData: 'forged' })).status, 401);
	const blocked = await request('/api/auth/telegram', { initData: signed() });
	assert.equal(blocked.status, 429);
	assert.equal(blocked.headers.get('retry-after'), '60');
	assert.equal((await request('/')).status, 200);
});

test('static allowlist exposes game and legal files but not backend, credentials, git, or tests', async t => {
	const { request } = await api(t);
	for (const route of ['/', '/js/auth.js', '/style/style.css', '/credits.html', '/LICENSE.md']) assert.equal((await request(route)).status, 200, route);
	for (const route of ['/.env', '/.git/config', '/server/index.cjs', '/server/migrations/001_auth.sql', '/server/coins.cjs', '/server/migrations/003_coins_ledger.sql', '/server/game-rewards.cjs', '/server/reward-policy.cjs', '/server/migrations/004_game_rewards.sql', '/package.json', '/node_modules/express/package.json', '/tests/auth.test.cjs']) assert.equal((await request(route)).status, 404, route);
	assert.equal((await request('/api/coins')).status, 503, 'Coins fail closed when their store is not configured');
	const page = await request('/');
	assert.match(page.headers.get('content-security-policy'), /frame-ancestors.*telegram/);
	assert.equal(page.headers.get('x-powered-by'), null);
});

test('database failures fail closed without leaking private error details', async t => {
	const { store, request } = await api(t);
	store.fail = true;
	assert.equal((await request('/api/health')).status, 503);
	const login = await request('/api/auth/telegram', { initData: signed() });
	assert.equal(login.status, 503);
	assert.doesNotMatch(await login.text(), /private database/);
});

test('unconfigured development serves practice, but production fails without required credentials', async t => {
	const { request } = await api(t, { botToken: '' });
	const login = await request('/api/auth/telegram', { initData: signed() });
	assert.equal(login.status, 503);
	assert.equal((await login.json()).code, 'AUTH_NOT_CONFIGURED');
	assert.equal((await request('/api/health')).status, 503, 'database alone does not make Telegram login ready');
	assert.equal((await request('/')).status, 200);
	assert.throws(() => readConfig({ NODE_ENV: 'production' }), /Production requires/);
	assert.throws(() => readConfig({ APP_ORIGIN: 'https://game.example/path' }), /APP_ORIGIN/);
	assert.throws(() => readConfig({ PORT: '-1' }), /PORT/);
	const config = readConfig({ NODE_ENV: 'production', RENDER_EXTERNAL_URL: 'https://game.example', TELEGRAM_BOT_TOKEN: botToken, DATABASE_URL: 'postgres://test' });
	assert.equal(config.cookieName, '__Host-hexaRushSession');
});

test('session cookies support HTTPS Telegram previews while local HTTP remains usable', async t => {
	for (const origin of ['https://preview.example', 'http://localhost:8001']) {
		const { request } = await api(t, { origin, production: false });
		const login = await request('/api/auth/telegram', { initData: signed() });
		assert.equal(login.status, 200);
		const cookie = login.headers.get('set-cookie');
		assert.match(cookie, /HttpOnly/);
		if (origin.startsWith('https:')) {
			assert.match(cookie, /Secure/);
			assert.match(cookie, /SameSite=None/);
			assert.match(cookie, /Partitioned/);
		} else {
			assert.doesNotMatch(cookie, /Secure|Partitioned/);
			assert.match(cookie, /SameSite=Strict/);
		}
	}
});

test('health and authentication report missing database without leaking configuration values', async t => {
	const config = readConfig({ TELEGRAM_BOT_TOKEN: botToken });
	const server = createApp({ config, store: null }).listen(0, '127.0.0.1');
	await once(server, 'listening');
	t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
	const base = `http://127.0.0.1:${server.address().port}`;
	const health = await fetch(base + '/api/health');
	assert.equal(health.status, 503);
	assert.deepEqual(await health.json(), { status: 'unconfigured' });
	const login = await fetch(base + '/api/auth/telegram', { method: 'POST' });
	assert.equal(login.status, 503);
	assert.deepEqual(await login.json(), { error: 'Telegram authentication is not configured', code: 'AUTH_NOT_CONFIGURED' });
});

test('PostgreSQL login runs in a transaction, rolls back on replay/blocked account, and releases connections', async () => {
	const statements = [];
	let mode = 'ok';
	const client = {
		async query(sql) {
			statements.push(sql.trim().split(/\s+/).slice(0, 3).join(' '));
			if (sql.includes('INSERT INTO users')) return { rows: [{ id: 'uuid', telegram_id: user.id, first_name: user.first_name, last_name: '', status: mode === 'blocked' ? 'blocked' : 'active' }] };
			if (sql.includes('INSERT INTO auth_sessions') && mode === 'replay') throw Object.assign(Error('duplicate'), { code: '23505' });
			return { rows: [], rowCount: 0 };
		},
		release() { statements.push('RELEASE'); }
	};
	const store = createStore({ connect: async () => client });
	const input = { user: validateTelegramData(signed(), botToken, now).user, tokenHash: 'a'.repeat(64), launchHash: 'b'.repeat(64), expiresAt: new Date(now) };
	await store.login(input);
	assert.deepEqual(statements, ['BEGIN', 'INSERT INTO users', 'INSERT INTO auth_sessions', 'INSERT INTO login_streaks', 'COMMIT', 'RELEASE']);
	for (mode of ['blocked', 'replay']) {
		statements.length = 0;
		await assert.rejects(store.login(input), AuthError);
		assert.deepEqual(statements.slice(-2), ['ROLLBACK', 'RELEASE']);
	}
});

test('verified usernames are stored, refreshed on login and returned by the authenticated cookie profile', async () => {
	let row;
	const client = { async query(sql, values) {
		if (sql.includes('INSERT INTO users')) {
			assert.match(sql, /username = EXCLUDED.username/);
			row = { id: 'owner', status: 'active', telegram_id: values[1], first_name: values[2], last_name: values[3], username: values[4], language_code: values[5] };
			return { rows: [row] };
		}
		return { rows: [] };
	}, release() {} };
	const store = createStore({ connect: async () => client, async query(sql) {
		assert.match(sql, /auth_sessions s JOIN users u/);
		return { rows: [{ ...row, launch_hash: 'fixture' }], rowCount: 1 };
	} });
	for (const username of ['old_handle', 'new_handle', null]) {
		const account = await store.login({ user: { telegramId: '12345', firstName: 'Name', lastName: '', username }, tokenHash: 'fixture', launchHash: 'fixture', expiresAt: new Date() });
		assert.equal(account.username, username);
		assert.equal((await store.getSession('fixture')).user.username, username);
	}
});

test('ordinary browser does not load Telegram SDK or make authentication calls', async () => {
	const context = vm.createContext({ window: { location: { hash: '' } }, URLSearchParams });
	vm.runInContext(readFileSync(path.join(__dirname, '../js/auth.js'), 'utf8'), context);
	await context.startTelegramAuth();
});

test('Telegram client sends raw initData only and never trusts initDataUnsafe or alters practice mode', async () => {
	const requests = [];
	const accountStates = [];
	let ready = false;
	const context = vm.createContext({
		window: { location: { hash: '' }, Telegram: { WebApp: { initData: 'signed-data', initDataUnsafe: { user: { first_name: 'FORGED' } }, ready() { ready = true; }, expand() {} } } },
		URLSearchParams, AbortSignal,
		setPlayerAccount: (state, account) => accountStates.push({ state, account }),
		document: { getElementById: () => { throw Error('Authentication must not write overlapping HUD messages'); } },
		fetch: async (url, options) => { requests.push({ url, options }); return { ok: true, json: async () => ({ user: { id: 'verified-user', telegramId: '12345', firstName: '<script>Verified</script>' } }) }; }
	});
	vm.runInContext(readFileSync(path.join(__dirname, '../js/auth.js'), 'utf8'), context);
	await context.startTelegramAuth();
	assert.equal(ready, true);
	assert.equal(requests[0].url, '/api/auth/telegram');
	assert.equal(requests[1].url, '/api/auth/me');
	assert.deepEqual(JSON.parse(requests[0].options.body), { initData: 'signed-data' });
	assert.equal(accountStates[0].state, 'connecting');
	assert.equal(accountStates[1].state, 'connected');
	assert.equal(accountStates[1].account.firstName, '<script>Verified</script>');
	context.fetch = async () => { throw Error('offline'); };
	await context.startTelegramAuth();
	assert.equal(accountStates.at(-1).state, 'error');
});