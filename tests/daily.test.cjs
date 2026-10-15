const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { createDailyStore, recordLoginDay, streakView, utcDay } = require('../server/daily.cjs');
const { createStore } = require('../server/store.cjs');
const { createApp } = require('../server/app.cjs');
const { readConfig } = require('../server/config.cjs');
const { rules } = require('../server/replay.cjs');

test('UTC quest days are half-open and cross month/year/leap boundaries without local-time shifts', () => {
	for (const [time, day, next] of [
		['2026-10-13T23:59:59.999Z', '2026-10-13', '2026-10-14'],
		['2026-10-14T00:00:00Z', '2026-10-14', '2026-10-15'],
		['2028-02-29T18:00:00Z', '2028-02-29', '2028-03-01'],
		['2026-12-31T23:00:00-01:00', '2027-01-01', '2027-01-02']
	]) {
		const bounds = utcDay(Date.parse(time)); assert.equal(bounds.day, day);
		assert.equal(bounds.start.toISOString(), day + 'T00:00:00.000Z'); assert.equal(bounds.end.toISOString(), next + 'T00:00:00.000Z');
	}
});

test('daily quests and streak use one owner-only read snapshot of finished/unflagged current-rules runs and active accounts', async () => {
	const calls = []; let time = Date.parse('2026-10-13T23:59:59Z');
	const store = createDailyStore({ async query(sql, values) { calls.push({ sql, values }); return { rows: [{ completed_games: '0', best_score: '0', best_combo: 0 }] }; } }, () => time);
	const data = await store.progress('owner'), { sql, values } = calls[0];
	assert.equal(calls.length, 1); assert.deepEqual(values, ['owner', rules.version, utcDay(time).start, utcDay(time).end]);
	assert.match(sql, /g.user_id = \$1 AND u.status = 'active' AND g.status = 'finished'/);
	assert.match(sql, /g.flagged_at IS NULL AND g.rules_version = \$2 AND g.server_score IS NOT NULL/);
	assert.match(sql, /g.ended_at >= \$3 AND g.ended_at < \$4/);
	assert.match(sql, /s.user_id = \$1/); assert.match(sql, /u.status = 'active'/);
	assert.doesNotMatch(sql, /INSERT|UPDATE|DELETE|auth_sessions|reward_eligible|user_achievements|coin_ledger/);
	assert.equal(data.day, '2026-10-13'); assert.equal(data.serverTime, new Date(time).toISOString()); assert.equal(data.rewardsEnabled, false);
	assert.deepEqual(data.quests.map(q => [q.code, q.progress, q.target, q.reached]), [['play_3', 0, 3, false], ['score_800', 0, 800, false], ['combo_3', 0, 3, false]]);
	assert.deepEqual(data.streak, { days: 0, lastLaunchDay: null, checkedInToday: false });
	time += 1000; assert.equal((await store.progress('owner')).day, '2026-10-14');
});

test('daily progress clamps counts and scores, preserves decimals and chain 3 labels the existing 2x multiplier', async () => {
	let row;
	const store = createDailyStore({ async query() { return { rows: [row] }; } });
	for (const [count, score, chain] of [[2, 799.5, 2], [3, 800, 3], [100, 9000, 10]]) {
		row = { completed_games: String(count), best_score: String(score), best_combo: chain };
		const data = await store.progress('owner');
		assert.deepEqual(data.quests.map(q => q.progress), [Math.min(3, count), Math.min(800, score), Math.min(3, chain)]);
		assert.deepEqual(data.quests.map(q => q.reached), [count >= 3, score >= 800, chain >= 3]);
		assert.match(data.quests[2].description, /chain level 3.*2× points/);
		assert.doesNotMatch(JSON.stringify(data), /bonus|amount|balance|entitlement|claim/);
	}
	row = { completed_games: 1, best_score: 18, best_combo: 1 };
	assert.ok((await store.progress('owner')).quests.every(q => !q.reached), 'flags can reduce progress without awarding/revoking rewards');
});

test('streak display handles never-visited, today, yesterday, missed days and future state without backfill', () => {
	for (const [last, count, expected, checked] of [[null, null, 0, false], ['2026-10-13', 5, 5, true], ['2026-10-12', 5, 5, false],
		['2026-10-11', 5, 0, false], ['2026-10-14', 5, 0, false]]) {
		assert.deepEqual(streakView({ last_launch_day: last, streak_days: count }, '2026-10-13'), { days: expected, lastLaunchDay: last, checkedInToday: checked });
	}
	assert.equal(streakView({ last_launch_day: '2028-02-29', streak_days: 5 }, '2028-03-01').days, 5);
});

test('streak upsert is atomic, same-day idempotent, consecutive-day only and never rolls back for older requests', async () => {
	const calls = [];
	await recordLoginDay({ async query(sql, values) { calls.push({ sql, values }); } }, 'owner', Date.parse('2026-10-13T23:59:59Z'));
	assert.deepEqual(calls[0].values, ['owner', '2026-10-13']);
	assert.match(calls[0].sql, /ON CONFLICT \(user_id\) DO UPDATE/);
	assert.match(calls[0].sql, /last_launch_day = EXCLUDED.last_launch_day - 1/);
	assert.match(calls[0].sql, /THEN login_streaks.days \+ 1 ELSE 1 END/);
	assert.match(calls[0].sql, /WHERE login_streaks.last_launch_day < EXCLUDED.last_launch_day/);
	const migration = readFileSync(path.join(__dirname, '../server/migrations/005_login_streaks.sql'), 'utf8');
	assert.match(migration, /user_id UUID PRIMARY KEY REFERENCES users/); assert.match(migration, /CHECK \(days > 0\)/);
	assert.doesNotMatch(migration, /INSERT|UPDATE|DELETE|auth_sessions|coin_ledger|user_achievements/);
});

test('new-login streak writes share auth transaction; replay/blocked accounts and streak failures roll everything back', async () => {
	const calls = []; let mode = 'ok'; let released = 0;
	const client = { async query(sql, values) {
		calls.push({ sql, values });
		if (sql.includes('INSERT INTO users')) return { rows: [{ id: 'owner', status: mode === 'blocked' ? 'blocked' : 'active', telegram_id: 123, first_name: 'Fixture' }] };
		if (sql.includes('INSERT INTO auth_sessions') && mode === 'replay') throw Object.assign(Error('duplicate'), { code: '23505' });
		if (sql.includes('INSERT INTO login_streaks') && mode === 'fail') throw Error('streak unavailable');
		return { rows: [] };
	}, release() { released++; } };
	const store = createStore({ connect: async () => client }, () => Date.parse('2026-10-13T23:59:59Z'));
	const input = { user: { telegramId: '123', firstName: 'Fixture', lastName: '', username: null }, tokenHash: 'a', launchHash: 'b', expiresAt: new Date() };
	await store.login(input); assert.equal(calls.at(-1).sql, 'COMMIT'); assert.equal(calls.at(-2).values[1], '2026-10-13');
	for (mode of ['blocked', 'replay', 'fail']) {
		calls.length = 0; await assert.rejects(store.login(input)); assert.equal(calls.at(-1).sql, 'ROLLBACK');
		if (mode !== 'fail') assert.ok(calls.every(call => !call.sql.includes('INSERT INTO login_streaks')));
	}
	assert.equal(released, 4);
});

test('same-launch recorder takes an active-account row lock and measures the day after acquiring it', async () => {
	let time = Date.parse('2026-10-13T23:59:59Z'), active = true; const calls = [];
	const client = { async query(sql, values) { calls.push({ sql, values });
		if (sql.includes('FOR UPDATE')) { time += 1000; return { rowCount: active ? 1 : 0 }; } return { rows: [] }; }, release() {} };
	const store = createStore({ connect: async () => client }, () => time);
	await store.recordLaunch('owner'); assert.match(calls[1].sql, /status = 'active' FOR UPDATE/);
	assert.deepEqual(calls[2].values, ['owner', '2026-10-14']); assert.equal(calls.at(-1).sql, 'COMMIT');
	active = false; calls.length = 0; await assert.rejects(store.recordLaunch('owner'), /Account unavailable/);
	assert.equal(calls.at(-1).sql, 'ROLLBACK'); assert.ok(calls.every(call => !call.sql.includes('INSERT INTO login_streaks')));
});

async function api(t, configured = true) {
	let time = 0; const calls = [];
	const config = readConfig({ APP_ORIGIN: 'https://game.example', TELEGRAM_BOT_TOKEN: 'test-fixture-token' });
	const store = { async getSession() { return { user: { id: 'owner' } }; }, async recordLaunch() { throw Error('GET must not record a visit'); } };
	const daily = { async progress(id) { calls.push(id); return { rewardsEnabled: false, quests: [] }; } };
	const server = createApp({ config, store, daily: configured ? daily : null, now: () => time, logger: { error() {} } }).listen(0, '127.0.0.1');
	await once(server, 'listening'); t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
	return { calls, store, daily, advance() { time += 60000; }, request(route = '/api/daily', options = {}) {
		return fetch(`http://127.0.0.1:${server.address().port}` + route, { headers: { Cookie: config.cookieName + '=' + 'a'.repeat(64) }, signal: AbortSignal.timeout(5000), ...options });
	} };
}

test('daily HTTP infers account, refuses submitted days/progress and has no claim/check-in write routes', async t => {
	const f = await api(t); assert.equal((await f.request(undefined, { headers: {} })).status, 401);
	for (const query of ['?userId=other', '?day=2026-10-13', '?score=800', '?combo=3', '?checkIn=true', '?claim=true']) assert.equal((await f.request('/api/daily' + query)).status, 400);
	const res = await f.request(); assert.equal(res.status, 200); assert.equal(res.headers.get('cache-control'), 'no-store'); assert.equal((await res.json()).rewardsEnabled, false);
	assert.deepEqual(f.calls, ['owner']);
	for (const route of ['/api/daily', '/api/daily/claim', '/api/daily/check-in', '/api/streak/claim']) assert.equal((await f.request(route, { method: 'POST' })).status, 404);
	f.store.getSession = async () => ({ user: { id: 'other' } }); await f.request(); assert.deepEqual(f.calls, ['owner', 'other']);
	f.store.getSession = async () => null; assert.equal((await f.request()).status, 401);
});

test('daily HTTP is per-account rate-limited and fails closed without private details or fake progress', async t => {
	const f = await api(t); for (let i = 0; i < 20; i++) assert.equal((await f.request()).status, 200);
	const limited = await f.request(); assert.equal(limited.status, 429); assert.equal(limited.headers.get('retry-after'), '60'); assert.equal(f.calls.length, 20);
	f.advance(); assert.equal((await f.request()).status, 200);
	f.daily.progress = async () => { throw Error('private database password'); };
	const failed = await f.request(); assert.equal(failed.status, 503); assert.doesNotMatch(await failed.text(), /password|database|quests/);
	const missing = await api(t, false); assert.equal((await missing.request()).status, 503);
});