const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { once } = require('node:events');
const { readFileSync } = require('node:fs');
const { createReferralStore, attributeReferral } = require('../server/referrals.cjs');
const { createStore } = require('../server/store.cjs');
const { createApp } = require('../server/app.cjs');
const { readConfig } = require('../server/config.cjs');
const { validateTelegramData } = require('../server/telegram.cjs');
const { rules } = require('../server/replay.cjs');

const code = 'ref_' + 'a'.repeat(32), otherCode = 'ref_' + 'b'.repeat(32);
const ownerId = '12345678-1234-4321-8123-123456789abc', accountCode = 'ref_' + ownerId;
const telegramCode = 'ref_67890';
const botToken = 'test-only-token', time = 1800000000000;
function signed(startParam = telegramCode) {
	const fields = new URLSearchParams({ auth_date: String(time / 1000), user: JSON.stringify({ id: 12345, first_name: 'Fixture' }), start_param: startParam });
	fields.sort();
	const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
	fields.set('hash', createHmac('sha256', secret).update([...fields].map(([k, v]) => k + '=' + v).join('\n')).digest('hex'));
	return fields.toString();
}

test('referral launch parameter is returned only after HMAC/age/identity checks; malformed IDs do not break valid login', () => {
	assert.equal(validateTelegramData(signed(), botToken, time).startParam, telegramCode);
	assert.equal(validateTelegramData(signed(accountCode), botToken, time).startParam, accountCode, 'old UUID invites still work');
	assert.equal(validateTelegramData(signed(code), botToken, time).startParam, code, 'old signed invites still work');
	assert.equal(validateTelegramData(signed('not-a-code'), botToken, time).startParam, 'not-a-code');
	assert.throws(() => validateTelegramData(signed().replace(telegramCode, otherCode), botToken, time));
	assert.throws(() => validateTelegramData(signed(), botToken, time + 301000));
	assert.throws(() => validateTelegramData(signed() + '&start_param=' + otherCode, botToken, time));
});

test('referral attribution accepts Telegram IDs, old UUIDs and legacy codes, locks active non-self owners and never rewards', async () => {
	const calls = []; let found = true;
	const client = { async query(sql, values) { calls.push({ sql, values }); return { rowCount: found ? 1 : 0, rows: [{ id: 'referrer' }] }; } };
	for (const param of [undefined, null, '', code.toUpperCase(), accountCode.toUpperCase(), 'ref_0', 'ref_067890', 'ref_-1', 'ref_1.5', 'ref_9007199254740992', 'ref_12345678901234567', accountCode + '&ref=other', '<script>', { code }]) await attributeReferral(client, 'invitee', param);
	assert.equal(calls.length, 0);
	await attributeReferral(client, 'invitee', accountCode);
	assert.match(calls[0].sql, /JOIN users.*c.user_id/);
	assert.match(calls[0].sql, /WHERE c.user_id = \$1 AND u.status = 'active' AND u.id <> \$2 FOR SHARE OF u/);
	assert.deepEqual(calls[0].values, [ownerId, 'invitee']);
	assert.deepEqual(calls[1].values, ['invitee', 'referrer']);
	calls.length = 0;
	await attributeReferral(client, 'invitee', telegramCode);
	assert.match(calls[0].sql, /WHERE u\.telegram_id = \$1 AND u\.status = 'active'/);
	assert.deepEqual(calls[0].values, ['67890', 'invitee']);
	assert.deepEqual(calls[1].values, ['invitee', 'referrer']);
	calls.length = 0;
	await attributeReferral(client, 'invitee', code);
	assert.match(calls[0].sql, /u.status = 'active' AND u.id <> \$2 FOR SHARE OF u/);
	assert.deepEqual(calls[0].values, [code, 'invitee']);
	assert.match(calls[1].sql, /^INSERT INTO referrals/); assert.deepEqual(calls[1].values, ['invitee', 'referrer']);
	found = false; calls.length = 0; await attributeReferral(client, 'invitee', code); assert.equal(calls.length, 1);
	assert.ok(calls.every(call => !/coin|reward|achievement|ledger/.test(call.sql)));
});

test('numeric invite lookup keeps large Telegram IDs exact and ignores unpublished or unavailable owners', async () => {
	const calls = [];
	const client = { async query(sql, values) { calls.push({ sql, values }); return { rowCount: 0, rows: [] }; } };
	for (const telegramId of ['1', '4503599627370495', '9007199254740991']) {
		await attributeReferral(client, 'invitee', 'ref_' + telegramId);
		assert.deepEqual(calls.at(-1).values, [telegramId, 'invitee']);
		assert.match(calls.at(-1).sql, /FROM referral_codes c JOIN users u/);
		assert.match(calls.at(-1).sql, /u\.telegram_id = \$1 AND u\.status = 'active' AND u\.id <> \$2 FOR SHARE OF u/);
	}
	assert.equal(calls.length, 3, 'missing owners cause no relationship writes');
});

test('only winning newly generated login UUID may attribute; retries/existing accounts and disabled configuration cannot attach', async () => {
	const calls = []; let existing = false, fail = null, accountId;
	const client = { async query(sql, values) {
		calls.push({ sql, values });
		if (sql.includes('INSERT INTO users')) { accountId = existing ? 'old-account' : values[0]; return { rows: [{ id: accountId, telegram_id: 12345, status: 'active' }] }; }
		if (fail && sql.includes(fail)) throw new Error('fixture rollback');
		if (sql.includes('SELECT u.id')) return { rows: [{ id: 'referrer' }], rowCount: 1 };
		return { rows: [] };
	}, release() { calls.push({ sql: 'RELEASE' }); } };
	const pool = { connect: async () => client }, input = { user: { telegramId: '12345', firstName: 'Fixture' }, startParam: telegramCode };
	const store = createStore(pool, () => time, { referralsEnabled: true });
	await store.login(input);
	assert.deepEqual(calls.filter(c => c.sql.startsWith('INSERT INTO referrals'))[0].values, [accountId, 'referrer']);
	assert.ok(calls.findIndex(c => c.sql.includes('login_streaks')) < calls.findIndex(c => c.sql.includes('INSERT INTO referrals')));
	assert.deepEqual(calls.slice(-2).map(c => c.sql), ['COMMIT', 'RELEASE']);
	existing = true; calls.length = 0; await store.login(input); assert.ok(calls.every(c => !/referral/.test(c.sql)));
	existing = false; calls.length = 0; await createStore(pool).login(input); assert.ok(calls.every(c => !/referral/.test(c.sql)));
	for (fail of ['INSERT INTO referrals', 'INSERT INTO auth_sessions', 'INSERT INTO login_streaks']) {
		calls.length = 0; await assert.rejects(store.login(input), /rollback/);
		assert.deepEqual(calls.slice(-2).map(c => c.sql), ['ROLLBACK', 'RELEASE']);
		assert.ok(calls.every(c => c.sql !== 'COMMIT'));
	}
});

test('invite creation returns the Telegram ID without new randomness or replacing legacy links', async () => {
	const calls = []; let saved = code, active = true;
	const client = { async query(sql, values) {
		calls.push({ sql, values });
		if (sql.includes('FOR UPDATE')) return { rowCount: active ? 1 : 0, rows: [{ telegram_id: 67890 }] };
		if (sql.startsWith('INSERT INTO referral_codes')) {
			assert.equal(values[0], ownerId); assert.equal(values[1], 'ref_' + ownerId.replaceAll('-', ''));
			assert.match(sql, /ON CONFLICT \(user_id\) DO NOTHING/);
			if (!saved) saved = values[1];
		}
		return { rows: [] };
	}, release() {} };
	const store = createReferralStore({ connect: async () => client }, 'alodvipbot');
	const first = await store.createCode(ownerId); assert.equal(first.inviteLink, 'https://t.me/alodvipbot?startapp=ref_67890');
	assert.deepEqual(await store.createCode(ownerId), first); assert.equal(saved, code, 'legacy code is not overwritten');
	saved = null; assert.deepEqual(await store.createCode(ownerId), first); assert.equal(saved, 'ref_' + ownerId.replaceAll('-', ''));
	assert.doesNotMatch(readFileSync(require.resolve('../server/referrals.cjs'), 'utf8'), /randomBytes|randomUUID/);
	active = false; await assert.rejects(store.createCode(ownerId), /Account unavailable/); assert.equal(calls.at(-1).sql, 'ROLLBACK');
});

test('owner summary uses one read snapshot, eligible post-attribution games and active accounts; output is aggregate-only', async () => {
	let row = { id: ownerId, telegram_id: '67890', code, invited_accounts: '5', reached_accounts: '2' }; const calls = [];
	const store = createReferralStore({ async query(sql, values) { calls.push({ sql, values }); return { rows: row ? [row] : [], rowCount: row ? 1 : 0 }; } }, 'alodvipbot');
	const data = await store.summary('owner'); assert.equal(calls.length, 1);
	assert.deepEqual(calls[0].values, ['owner', rules.version]);
	assert.match(calls[0].sql, /COUNT\(g.id\) >= 3/); assert.match(calls[0].sql, /g.ended_at >= r.attributed_at/);
	assert.match(calls[0].sql, /g.status = 'finished'/); assert.match(calls[0].sql, /g.flagged_at IS NULL AND g.rules_version = \$2 AND g.server_score IS NOT NULL/);
	assert.match(calls[0].sql, /invited.status = 'active'/); assert.match(calls[0].sql, /owner.status = 'active'/);
	assert.doesNotMatch(calls[0].sql, /INSERT|UPDATE|DELETE|coin_ledger|reward_eligible|user_achievements|username|first_name/);
	assert.deepEqual(data, { rulesVersion: rules.version, rewardsEnabled: false, targetGames: 3, inviteLink: 'https://t.me/alodvipbot?startapp=ref_67890', invitedAccounts: 5, reachedAccounts: 2 });
	row = { telegram_id: '67891', code: null, invited_accounts: '0', reached_accounts: '0' }; assert.equal((await store.summary('other')).inviteLink, null);
	row = null; await assert.rejects(store.summary('blocked'), /Account unavailable/);
});

test('existing published invites return the Telegram-ID link through HTTP without rewriting legacy codes', async t => {
	const calls = [];
	const referrals = createReferralStore({ async query(sql, values) {
		calls.push({ sql, values });
		return { rowCount: 1, rows: [{ id: ownerId, telegram_id: '67890', code, invited_accounts: '0', reached_accounts: '0' }] };
	} }, 'alodvipbot');
	const config = readConfig({ APP_ORIGIN: 'https://game.example', TELEGRAM_BOT_TOKEN: botToken });
	const server = createApp({ config, store: { async getSession() { return { user: { id: ownerId } }; } }, referrals }).listen(0, '127.0.0.1');
	await once(server, 'listening'); t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
	const response = await fetch(`http://127.0.0.1:${server.address().port}/api/referrals`, { headers: { Cookie: config.cookieName + '=' + 'a'.repeat(64) } });
	assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
	assert.equal((await response.json()).inviteLink, 'https://t.me/alodvipbot?startapp=ref_67890');
	assert.equal(calls.length, 1); assert.deepEqual(calls[0].values, [ownerId, rules.version]);
	assert.doesNotMatch(calls[0].sql, /INSERT|UPDATE|DELETE/);
});

test('referral config accepts owner-confirmed bot names, refuses URL/code injection and migration starts empty', () => {
	assert.equal(readConfig({ TELEGRAM_BOT_USERNAME: '@alodvipbot' }).botUsername, 'alodvipbot');
	assert.equal(readConfig({}).botUsername, '');
	for (const name of ['alodvipbot?startapp=evil', 'https://t.me/evilbot', 'notabot/', 'a'.repeat(33), '']) {
		assert.throws(() => createReferralStore({}, name));
		if (name) assert.throws(() => readConfig({ TELEGRAM_BOT_USERNAME: name }));
	}
	const sql = readFileSync(require.resolve('../server/migrations/006_referrals.sql'), 'utf8');
	assert.match(sql, /invitee_id UUID PRIMARY KEY/); assert.match(sql, /CHECK \(invitee_id <> referrer_id\)/);
	assert.doesNotMatch(sql, /INSERT|UPDATE|DELETE|ledger|achievement|reward/);
});

async function api(t, configured = true) {
	let now = 0; const calls = [], config = readConfig({ APP_ORIGIN: 'https://game.example', TELEGRAM_BOT_TOKEN: botToken, TELEGRAM_BOT_USERNAME: 'alodvipbot' });
	const store = { async getSession() { return { user: { id: 'owner' } }; }, async login(input) { calls.push(input); return { id: 'owner' }; } };
	const referrals = { async summary(id) { calls.push(['read', id]); return { rewardsEnabled: false }; }, async createCode(id) { calls.push(['write', id]); return { inviteLink: 'https://t.me/alodvipbot?startapp=' + code }; } };
	const server = createApp({ config, store, referrals: configured ? referrals : null, now: () => now || time, logger: { error() {} } }).listen(0, '127.0.0.1');
	await once(server, 'listening'); t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
	return { calls, store, referrals, advance() { now = time + 60001; }, request(route = '/api/referrals', body, headers = {}) {
		return fetch(`http://127.0.0.1:${server.address().port}` + route, { method: body === undefined ? 'GET' : 'POST',
			headers: { Cookie: config.cookieName + '=' + 'a'.repeat(64), Origin: config.origin, 'Content-Type': 'application/json', ...headers },
			...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5000) });
	} };
}

test('HTTP infers owner, validates empty code creation and same origin, is uncached and offers no reward/public lookup routes', async t => {
	const f = await api(t);
	assert.equal((await f.request('/api/referrals', undefined, { Cookie: '' })).status, 401);
	for (const route of ['/api/referrals?userId=other', '/api/referrals?code=' + code, '/api/referrals/code?count=5']) {
		assert.equal((await f.request(route, route.includes('/code') ? {} : undefined)).status, 400);
	}
	for (const body of [{ code }, { referrer: 'other' }, { telegramId: '67890' }, { rewards: true }, [], null]) assert.equal((await f.request('/api/referrals/code', body)).status, 400);
	assert.equal((await f.request('/api/referrals/code', {}, { Origin: 'https://other.example' })).status, 403);
	const response = await f.request(); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
	assert.equal((await f.request('/api/referrals/code', {})).status, 200);
	assert.deepEqual(f.calls, [['read', 'owner'], ['write', 'owner']]);
	for (const route of ['/api/referrals/claim', '/api/referrals/qualify', '/api/referrals/' + code]) assert.equal((await f.request(route, {})).status, 404);
	f.store.getSession = async () => ({ user: { id: 'second' } }); await f.request(); assert.deepEqual(f.calls.at(-1), ['read', 'second']);
	f.store.getSession = async () => null; assert.equal((await f.request()).status, 401);
});

test('HTTP rate limits read/write separately per account and sanitizes failures without fabricated data', async t => {
	const f = await api(t);
	for (let i = 0; i < 20; i++) assert.equal((await f.request()).status, 200);
	assert.equal((await f.request()).status, 429);
	for (let i = 0; i < 5; i++) assert.equal((await f.request('/api/referrals/code', {})).status, 200);
	const limited = await f.request('/api/referrals/code', {}); assert.equal(limited.status, 429); assert.equal(limited.headers.get('retry-after'), '60');
	f.advance(); assert.equal((await f.request()).status, 200);
	f.referrals.summary = async () => { throw Error('private database password'); };
	const failed = await f.request(); assert.equal(failed.status, 503); assert.doesNotMatch(await failed.text(), /password|database|invitedAccounts/);
	const missing = await api(t, false); assert.equal((await missing.request()).status, 503);
});

test('login forwards signed start_param only, rejects body referrer injection, and unsigned URL parameters never override it', async t => {
	const f = await api(t);
	assert.equal((await f.request('/api/auth/telegram?startapp=' + otherCode, { initData: signed() })).status, 200);
	assert.equal(f.calls[0].startParam, telegramCode);
	assert.equal((await f.request('/api/auth/telegram', { initData: signed(), startParam: otherCode })).status, 400);
	assert.equal((await f.request('/api/auth/telegram', { initData: signed().replace(telegramCode, otherCode) })).status, 401);
	assert.equal(f.calls.length, 1);
});

test('matching-cookie signed referral launches record streak only and never add or replace attribution', async t => {
	const f = await api(t); let records = 0;
	const validated = validateTelegramData(signed(), botToken, time);
	f.store.getSession = async () => ({ user: { id: 'owner', telegramId: '12345' }, launchHash: validated.launchHash });
	f.store.recordLaunch = async id => { assert.equal(id, 'owner'); records++; };
	assert.equal((await f.request('/api/auth/telegram', { initData: signed() })).status, 200);
	assert.equal((await f.request('/api/auth/telegram', { initData: signed() })).status, 200);
	assert.equal(records, 2); assert.equal(f.calls.length, 0);
	assert.equal((await f.request('/api/auth/telegram', { initData: signed().replace(telegramCode, otherCode) })).status, 401);
	assert.equal(records, 2);
});