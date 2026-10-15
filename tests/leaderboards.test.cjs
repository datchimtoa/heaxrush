const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createLeaderboardStore, leaderboardWindow } = require('../server/leaderboards.cjs');
const { createApp } = require('../server/app.cjs');
const { readConfig } = require('../server/config.cjs');
const { rules } = require('../server/replay.cjs');

test('daily and Monday-based weekly windows use half-open UTC periods across calendar boundaries', () => {
	for (const [period, time, start, end] of [
		['daily', '2026-10-11T23:59:59.999Z', '2026-10-11T00:00:00.000Z', '2026-10-12T00:00:00.000Z'],
		['daily', '2026-10-12T00:00:00.000Z', '2026-10-12T00:00:00.000Z', '2026-10-13T00:00:00.000Z'],
		['weekly', '2026-10-11T23:59:59.999Z', '2026-10-05T00:00:00.000Z', '2026-10-12T00:00:00.000Z'],
		['weekly', '2026-10-12T00:00:00.000Z', '2026-10-12T00:00:00.000Z', '2026-10-19T00:00:00.000Z'],
		['weekly', '2027-01-01T00:00:00.000Z', '2026-12-28T00:00:00.000Z', '2027-01-04T00:00:00.000Z']
	]) {
		const window = leaderboardWindow(period, Date.parse(time));
		assert.equal(window.start.toISOString(), start); assert.equal(window.end.toISOString(), end);
	}
	assert.throws(() => leaderboardWindow('monthly', Date.now()), /Expected daily or weekly/);
});

test('standings read only finished/unflagged current-rules runs of active accounts in one snapshot', async () => {
	const calls = [];
	const store = createLeaderboardStore({ async query(sql, values) { calls.push({ sql, values }); return { rows: [] }; } }, () => Date.parse('2026-10-11T22:00:00Z'));
	for (const [period, aggregate, limit] of [['daily', 'MAX', 50], ['weekly', 'SUM', 100]]) {
		const data = await store.standings('owner', period);
		const { sql, values } = calls.at(-1);
		assert.match(sql, new RegExp(aggregate + '\\(g.server_score\\)'));
		assert.match(sql, /g.status = 'finished' AND g.flagged_at IS NULL AND u.status = 'active'/);
		assert.match(sql, /g.ended_at >= \$1 AND g.ended_at < \$2 AND g.rules_version = \$5/);
		assert.match(sql, /RANK\(\) OVER \(ORDER BY points DESC\)/);
		assert.match(sql, /ROW_NUMBER\(\) OVER \(ORDER BY points DESC, user_id\)/);
		assert.match(sql, /position <= \$4 OR user_id = \$3/);
		assert.doesNotMatch(sql, /INSERT|UPDATE|DELETE|coin_ledger|reward_eligible|best_score|telegram_id|first_name|last_name/);
		assert.match(sql, /u.username FROM ranked r/);
		assert.deepEqual(values.slice(2), ['owner', limit, rules.version]);
		assert.equal(data.limit, limit); assert.equal(data.rewardsEnabled, false); assert.equal(data.own, null);
		assert.deepEqual(data.entries, []); assert.equal(data.timezone, 'UTC');
	}
	assert.equal(calls.length, 2, 'one query per response; no separately drifting own rank');
	await assert.rejects(store.standings('owner', 'all'), /Expected daily/);
	assert.equal(calls.length, 2);
});

test('own rank outside the top slice returns public handles without exposing private account fields', async () => {
	const rows = [{ user_id: 'other', username: 'quiz_champion', first_name: 'PRIVATE', telegram_id: 'SECRET', points: '1200.5', rank: '1', position: '1' },
		{ user_id: 'tied', points: '1200.5', rank: '1', position: '2' },
		{ user_id: 'owner', points: '0.0', rank: '184', position: '185' }];
	const store = createLeaderboardStore({ async query() { return { rows }; } });
	const data = await store.standings('owner', 'daily');
	assert.deepEqual(data.own, { rank: 184, score: 0 });
	assert.equal(data.entries.length, 2); assert.equal(data.entries[0].score, 1200.5);
	assert.equal(data.entries[0].rank, data.entries[1].rank); assert.equal(data.entries[0].isYou, false);
	assert.equal(data.entries[0].label, '@quiz_champion');
	assert.match(data.entries[1].label, /^Player [a-f\d]{10}$/);
	assert.deepEqual(Object.keys(data.entries[0]).sort(), ['isYou', 'label', 'rank', 'score']);
	assert.doesNotMatch(JSON.stringify(data), /user_id|telegramId|username|firstName|PRIVATE|SECRET/);
	rows[2].position = '3'; rows[2].rank = '3';
	const changed = await store.standings('owner', 'weekly');
	assert.equal(changed.entries[2].isYou, true);
	assert.equal(changed.entries[1].label, data.entries[1].label, 'stable anonymous fallback for accounts without a public handle');
});

test('public labels follow the latest verified handle and fall back anonymously for missing or invalid usernames', async () => {
	const row = { user_id: 'owner', username: 'old_handle', points: '10', rank: '1', position: '1' };
	const store = createLeaderboardStore({ async query() { return { rows: [row] }; } });
	assert.equal((await store.standings('owner', 'daily')).entries[0].label, '@old_handle');
	row.username = 'new_handle';
	assert.equal((await store.standings('owner', 'weekly')).entries[0].label, '@new_handle');
	for (const username of [null, '', '   ', '<img src=x>', 'x'.repeat(33), 123]) {
		row.username = username;
		assert.match((await store.standings('owner', 'daily')).entries[0].label, /^Player [a-f\d]{10}$/);
	}
});

async function api(t, configured = true) {
	const calls = [];
	let time = Date.parse('2026-10-11T10:00:00Z');
	const config = readConfig({ APP_ORIGIN: 'https://game.example', TELEGRAM_BOT_TOKEN: 'test-fixture-token' });
	const store = { async getSession() { return { user: { id: 'owner' } }; } };
	const leaderboards = { async standings(userId, period) { calls.push({ userId, period }); return { entries: [], own: null, rewardsEnabled: false }; } };
	const server = createApp({ config, store, leaderboards: configured ? leaderboards : null, now: () => time, logger: { error() {} } }).listen(0, '127.0.0.1');
	await once(server, 'listening');
	t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
	const base = `http://127.0.0.1:${server.address().port}`;
	return { calls, store, leaderboards, advance() { time += 60000; },
		request(route = '/api/leaderboards?period=daily', options = {}) {
			return fetch(base + route, { headers: { Cookie: config.cookieName + '=' + 'a'.repeat(64) }, signal: AbortSignal.timeout(5000), ...options });
		} };
}

test('leaderboard HTTP reads require authentication, accept only a bounded period and infer own identity', async t => {
	const f = await api(t);
	assert.equal((await f.request(undefined, { headers: {} })).status, 401);
	for (const query of ['', '?period=monthly', '?period=daily&period=weekly', '?period[]=daily', '?period=daily&userId=other', '?period=daily&limit=999']) {
		assert.equal((await f.request('/api/leaderboards' + query)).status, 400);
	}
	for (const period of ['daily', 'weekly']) {
		const response = await f.request('/api/leaderboards?period=' + period);
		assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
		assert.equal((await response.json()).rewardsEnabled, false);
	}
	assert.deepEqual(f.calls, [{ userId: 'owner', period: 'daily' }, { userId: 'owner', period: 'weekly' }]);
	assert.equal((await f.request(undefined, { method: 'POST' })).status, 404);
	f.store.getSession = async () => null;
	assert.equal((await f.request()).status, 401);
});

test('leaderboard reads are rate limited per account and database errors fail closed', async t => {
	const f = await api(t);
	for (let i = 0; i < 20; i++) assert.equal((await f.request()).status, 200);
	const limited = await f.request(); assert.equal(limited.status, 429); assert.equal(limited.headers.get('retry-after'), '60');
	assert.equal(f.calls.length, 20);
	f.advance(); assert.equal((await f.request()).status, 200);
	f.leaderboards.standings = async () => { throw Error('private database password'); };
	const failed = await f.request(); assert.equal(failed.status, 503); assert.doesNotMatch(await failed.text(), /password|database/);
	const unconfigured = await api(t, false);
	assert.equal((await unconfigured.request()).status, 503);
});
