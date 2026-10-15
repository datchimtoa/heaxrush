const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createAchievementStore } = require('../server/achievements.cjs');
const { createApp } = require('../server/app.cjs');
const { readConfig } = require('../server/config.cjs');
const { rules } = require('../server/replay.cjs');
const { rewardPolicy } = require('../server/reward-policy.cjs');

test('achievement progress is one owner-scoped read of finished, unflagged, current-rules sessions', async () => {
	const calls = [];
	const store = createAchievementStore({ async query(sql, values) { calls.push({ sql, values }); return { rows: [{ best_score: '0', best_combo: 0 }] }; } });
	const data = await store.progress('owner');
	assert.equal(calls.length, 1);
	assert.deepEqual(calls[0].values, ['owner', rules.version]);
	assert.match(calls[0].sql, /g.user_id = \$1 AND u.status = 'active' AND g.status = 'finished'/);
	assert.match(calls[0].sql, /g.flagged_at IS NULL AND g.rules_version = \$2/);
	assert.match(calls[0].sql, /g.server_score IS NOT NULL AND g.ended_at IS NOT NULL/);
	assert.match(calls[0].sql, /MAX\(g.server_score\)/); assert.match(calls[0].sql, /MAX\(g.max_combo\)/);
	assert.doesNotMatch(calls[0].sql, /INSERT|UPDATE|DELETE|user_achievements|reward_eligible|coin_ledger|telegram_id/);
	assert.equal(data.rulesVersion, rules.version); assert.equal(data.rewardsEnabled, false);
	assert.deepEqual(data.milestones.map(m => [m.code, m.target, m.progress, m.reached]), [
		['score_500', 500, 0, false], ['score_1000', 1000, 0, false], ['score_2000', 2000, 0, false], ['combo_4', 4, 0, false]
	]);
	assert.equal(rewardPolicy.issuanceEnabled, false);
});

test('score thresholds preserve decimal progress, clamp overachievement, and chain 4 is not a points multiplier', async () => {
	let row;
	const store = createAchievementStore({ async query() { return { rows: [row] }; } });
	for (const score of [0, 499.5, 500, 999.5, 1000, 1999.5, 2000, 9000]) {
		row = { best_score: String(score), best_combo: 3 };
		const data = await store.progress('owner');
		for (const m of data.milestones.slice(0, 3)) {
			assert.equal(m.progress, Math.min(score, m.target)); assert.equal(m.reached, score >= m.target);
		}
		assert.equal(data.milestones[3].progress, 3); assert.equal(data.milestones[3].reached, false);
	}
	row = { best_score: '500', best_combo: 10 };
	assert.equal((await store.progress('owner')).milestones[3].progress, 4);
	assert.equal((await store.progress('owner')).milestones[3].reached, true);
	row = { best_score: '18', best_combo: 1 };
	assert.equal((await store.progress('owner')).milestones[0].reached, false, 'read-only progress can decrease after a trusted flag');
	assert.doesNotMatch(JSON.stringify(await store.progress('owner')), /amount|bonus|balance|sessionId|unlockedAt|claim/);
});

async function api(t, configured = true) {
	const calls = []; let time = 0;
	const config = readConfig({ APP_ORIGIN: 'https://game.example', TELEGRAM_BOT_TOKEN: 'test-fixture-token' });
	const store = { async getSession() { return { user: { id: 'owner' } }; } };
	const achievements = { async progress(userId) { calls.push(userId); return { rewardsEnabled: false, milestones: [] }; } };
	const server = createApp({ config, store, achievements: configured ? achievements : null, now: () => time, logger: { error() {} } }).listen(0, '127.0.0.1');
	await once(server, 'listening');
	t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
	return { calls, store, achievements, advance() { time += 60000; }, request(route = '/api/achievements', options = {}) {
		return fetch(`http://127.0.0.1:${server.address().port}` + route, { headers: { Cookie: config.cookieName + '=' + 'a'.repeat(64) }, signal: AbortSignal.timeout(5000), ...options });
	} };
}

test('achievement API infers identity from authentication, accepts no queries or claims, and never caches', async t => {
	const f = await api(t);
	assert.equal((await f.request(undefined, { headers: {} })).status, 401);
	for (const query of ['?userId=other', '?score=2000', '?combo=4', '?claim=true', '?before=x', '?userId[]=owner']) {
		assert.equal((await f.request('/api/achievements' + query)).status, 400);
	}
	const response = await f.request();
	assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
	assert.equal((await response.json()).rewardsEnabled, false); assert.deepEqual(f.calls, ['owner']);
	for (const route of ['/api/achievements', '/api/achievements/claim']) assert.equal((await f.request(route, { method: 'POST' })).status, 404);
	f.store.getSession = async () => ({ user: { id: 'second' } }); await f.request();
	assert.deepEqual(f.calls, ['owner', 'second']);
	f.store.getSession = async () => null; assert.equal((await f.request()).status, 401);
});

test('achievement reads are per-account rate limited and backend failures do not expose details or fabricate progress', async t => {
	const f = await api(t);
	for (let i = 0; i < 20; i++) assert.equal((await f.request()).status, 200);
	const limited = await f.request(); assert.equal(limited.status, 429); assert.equal(limited.headers.get('retry-after'), '60');
	assert.equal(f.calls.length, 20);
	f.store.getSession = async () => ({ user: { id: 'second' } }); assert.equal((await f.request()).status, 200);
	f.advance(); assert.equal((await f.request()).status, 200);
	f.achievements.progress = async () => { throw Error('private database password'); };
	const failed = await f.request(); assert.equal(failed.status, 503); assert.doesNotMatch(await failed.text(), /password|database|milestones/);
	const unconfigured = await api(t, false); assert.equal((await unconfigured.request()).status, 503);
});