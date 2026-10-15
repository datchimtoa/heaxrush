const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createGameStore } = require('../server/game-store.cjs');
const { createReplay } = require('../server/replay.cjs');
const { changeCoins, dailyEarnings } = require('../server/coins.cjs');
const { rewardPolicy, dayBounds } = require('../server/reward-policy.cjs');

// SQL/transaction fixture only. Serialization here is NOT proof of PostgreSQL
// row locks; the opt-in disposable-database suite covers real concurrency.
function fixture(enabled = true) {
	const data = { sessions: new Map(), achievements: new Map(), entries: [], balance: 0, held: 0, best: 0, total: 0, games: 0, active: true };
	let time = Date.parse('2026-10-11T12:00:00Z'), tail = Promise.resolve(), failLedger = false;
	const result = rows => ({ rows: structuredClone(rows), rowCount: rows.length });
	async function query(sql, args = []) {
		const text = sql.replace(/\s+/g, ' ').trim();
		if (text.startsWith('SELECT id FROM users')) return result(data.active || !text.includes("status = 'active'") ? [{ id: args[0] }] : []);
		if (text.startsWith('SELECT best_score')) return result([{ best_score: data.best, coin_balance: data.balance, coins_held: data.held }]);
		if (text.startsWith('SELECT coin_balance')) return result(data.active || !text.includes("status = 'active'") ? [{ coin_balance: data.balance, coins_held: data.held }] : []);
		if (text.startsWith('SELECT * FROM game_sessions')) return result([...data.sessions.values()].filter(row => text.includes('request_id') ? row.user_id === args[0] && row.request_id === args[1] : row.id === args[0] && row.user_id === args[1]));
		if (text.startsWith('INSERT INTO game_sessions')) {
			const [id, user_id, request_id, rules_version, seed, started_at, expires_at, reward_eligible] = args;
			const row = { id, user_id, request_id, rules_version, seed, started_at, expires_at, reward_eligible, status: 'active', last_tick: 0, engine_state: null, events: [], coins_awarded: 0, coins_reversed: 0 };
			data.sessions.set(id, row); return result([row]);
		}
		if (text.startsWith("UPDATE game_sessions SET status = 'finished'")) {
			const row = data.sessions.get(args[0]);
			Object.assign(row, { status: 'finished', ended_at: args[1], server_score: args[2], max_combo: args[3], blocks_cleared: args[4], duration_ms: args[5] }); return result([row]);
		}
		if (text.startsWith('UPDATE game_sessions SET status')) {
			const status = text.includes("'expired'") ? 'expired' : 'abandoned';
			for (const row of data.sessions.values()) if (row.status === 'active' && (text.includes('user_id') ? row.user_id === args[0] && (status !== 'expired' || row.expires_at <= args[1]) : row.id === args[0])) row.status = status;
			return result([]);
		}
		if (text.startsWith('UPDATE users SET best_score')) { data.best = Math.max(data.best, args[1]); data.total += args[1]; data.games++; return result([]); }
		if (text.startsWith('UPDATE users SET coin_balance')) { data.balance = args[1]; data.held = args[2]; return result([]); }
		if (text.startsWith('INSERT INTO user_achievements')) {
			const [user_id, code, session_id, bonus_amount, unlocked_at] = args;
			if (!data.achievements.has(code)) data.achievements.set(code, { user_id, code, session_id, bonus_amount, unlocked_at }); return result([]);
		}
		if (text.includes('AS total_earned')) {
			const earnings = data.entries.filter(e => e.user_id === args[0] && e.change_type === 'earn' && e.created_at >= args[1] && e.created_at < args[2]);
			return result([{ total_earned: earnings.reduce((sum, e) => sum + e.amount, 0), gameplay_earned: earnings.filter(e => ['gameplay', 'achievement'].includes(e.source)).reduce((sum, e) => sum + e.amount, 0) }]);
		}
		if (text.startsWith('SELECT * FROM coin_ledger')) return result(data.entries.filter(e => e.user_id === args[0] && (text.includes('session_id =') ? e.session_id === args[1] && e.change_type === 'earn' : e.source === args[1] && e.reference_id === args[2] && e.change_type === args[3])));
		if (text.startsWith('INSERT INTO coin_ledger')) {
			if (failLedger) throw Error('ledger unavailable');
			const [id, user_id, change_type, amount, balance_before, balance_after, held_before, held_after, source, reference_id, reason, created_at, session_id] = args;
			const row = { id, user_id, change_type, amount, balance_before, balance_after, held_before, held_after, source, reference_id, reason, created_at, session_id }; data.entries.push(row); return result([row]);
		}
		if (text.startsWith('UPDATE game_sessions SET coins_awarded')) { const row = data.sessions.get(args[0]); row.coins_awarded = args[1]; return result([row]); }
		if (text.startsWith('UPDATE game_sessions SET coins_reversed')) { data.sessions.get(args[0]).coins_reversed = args[1]; return result([]); }
		if (text.startsWith('UPDATE game_sessions SET flagged_at')) { const row = data.sessions.get(args[0]); row.flagged_at = args[1]; row.flag_reason = args[2]; return result([row]); }
		if (text.startsWith('UPDATE user_achievements SET invalidated_at')) { for (const a of data.achievements.values()) if (a.user_id === args[0] && a.session_id === args[1]) a.invalidated_at ||= args[2]; return result([]); }
		throw Error('Unexpected reward fixture SQL: ' + text);
	}
	const pool = { async connect() {
		const wait = tail; let unlock; tail = new Promise(resolve => { unlock = resolve; }); await wait;
		let backup;
		return { async query(sql, args) {
			if (sql === 'BEGIN') { backup = structuredClone(data); return result([]); }
			if (sql === 'ROLLBACK') { Object.assign(data, backup); return result([]); }
			if (sql === 'COMMIT') return result([]);
			return query(sql, args);
		}, release: unlock };
	} };
	const games = createGameStore(pool, () => time, enabled);
	return { data, games, pool, now: () => time, setTime: value => { time = Date.parse(value); }, failLedger: value => { failLedger = value; },
		async earn(amount, source = 'fixture', sessionId = null) {
			const client = await pool.connect();
			try { return await changeCoins(client, 'player', { type: 'earn', amount, source, referenceId: randomUUID(), reason: 'Test fixture only', sessionId }, time); } finally { client.release(); }
		}, async daily() { return dailyEarnings({ query }, 'player', time); } };
}

const replay = createReplay(1);
while (!replay.result().ended) replay.advance(replay.result().tick + 1, []);
const endedSnapshot = replay.snapshot();

// Server-owned fixture checkpoints exercise award policy thresholds independently
// of play skill. No HTTP/client can provide a snapshot, score or combo.
async function ready(f, score = 0, combo = 1) {
	const session = await f.games.start('player', randomUUID());
	const row = f.data.sessions.get(session.id);
	row.engine_state = structuredClone(endedSnapshot);
	row.engine_state.score = score; row.engine_state.hex.bestCombo = combo;
	return session.id;
}

test('live policy is disabled and UTC draft boundaries include start but exclude next midnight', () => {
	assert.equal(rewardPolicy.issuanceEnabled, false);
	const bounds = dayBounds(Date.parse('2026-10-11T23:59:59.999Z'));
	assert.equal(bounds.start.toISOString(), '2026-10-11T00:00:00.000Z');
	assert.equal(bounds.end.toISOString(), '2026-10-12T00:00:00.000Z');
});

test('verified finish atomically awards 10 once, including concurrent/retried finishes', async () => {
	const f = fixture(), id = await ready(f);
	const [first, duplicate] = await Promise.all([f.games.finish('player', id), f.games.finish('player', id)]);
	assert.deepEqual(first, duplicate); assert.equal(first.coins.awarded, 10);
	assert.equal(f.data.balance, 10); assert.equal(f.data.games, 1); assert.equal(f.data.entries.length, 1);
	assert.equal(f.data.entries[0].session_id, id); assert.equal(f.data.entries[0].reference_id, id);
});

test('achievements are exact one-time entitlements, not partial payouts or carry-forward', async () => {
	const f = fixture();
	await f.games.finish('player', await ready(f, 499.5, 3));
	assert.equal(f.data.achievements.size, 0);
	await f.games.finish('player', await ready(f, 500, 4));
	assert.deepEqual([...f.data.achievements.values()].map(a => [a.code, a.bonus_amount]), [['score_500', 50], ['combo_4', 100]]);
	const original = structuredClone(f.data.achievements.get('score_500'));
	await f.games.finish('player', await ready(f, 1000, 5));
	await f.games.finish('player', await ready(f, 2000, 6));
	assert.deepEqual(f.data.achievements.get('score_500'), original);
	assert.equal(f.data.achievements.get('score_1000').bonus_amount, 150);
	assert.equal(f.data.achievements.get('score_2000').bonus_amount, 500);
	assert.equal(f.data.balance, 40); assert.equal(f.data.entries.filter(e => e.source === 'achievement').length, 0);
});

test('score milestones distinguish exact thresholds from fractional scores immediately below them', async () => {
	const f = fixture();
	await f.games.finish('player', await ready(f, 999.5, 3));
	assert.deepEqual([...f.data.achievements.keys()], ['score_500']);
	await f.games.finish('player', await ready(f, 1999.5, 3));
	assert.deepEqual([...f.data.achievements.keys()], ['score_500', 'score_1000']);
	await f.games.finish('player', await ready(f, 2000, 4));
	assert.deepEqual([...f.data.achievements.keys()], ['score_500', 'score_1000', 'score_2000', 'combo_4']);
});

test('disabled issuance and old sessions never receive rewards even after activation or later finish retry', async () => {
	const f = fixture(false), id = await ready(f, 2000, 4);
	const enabledGames = createGameStore(f.pool, f.now, true);
	assert.equal((await enabledGames.finish('player', id)).coins.awarded, 0);
	assert.equal((await enabledGames.finish('player', id)).coins.awarded, 0);
	assert.equal(f.data.entries.length, 0); assert.equal(f.data.achievements.size, 0);
	const disabledId = await ready(f, 2000, 4);
	assert.equal((await f.games.finish('player', disabledId)).coins.awarded, 0);
	assert.equal(f.data.balance, 0);
});

test('unfinished, abandoned, expired, foreign, blocked and flagged runs never earn', async () => {
	const f = fixture();
	const active = await f.games.start('player', randomUUID());
	await assert.rejects(f.games.finish('player', active.id), /not reached/);
	await assert.rejects(f.games.finish('stranger', active.id), /not found/);
	await f.games.abandon('player', active.id);
	await assert.rejects(f.games.finish('player', active.id), /no longer active/);
	const expired = await ready(f); f.data.sessions.get(expired).expires_at = new Date(f.now() - 1);
	await assert.rejects(f.games.finish('player', expired), /no longer active/);
	const flagged = await ready(f, 2000, 4);
	assert.deepEqual(await f.games.flag('player', flagged, 'review fixture'), { flagged: true, reversed: 0 });
	await assert.rejects(f.games.finish('player', flagged), /flagged/);
	const blocked = await ready(f); f.data.active = false;
	await assert.rejects(f.games.finish('player', blocked), /Account unavailable/);
	assert.equal(f.data.entries.length, 0); assert.equal(f.data.achievements.size, 0); assert.equal(f.data.games, 0);
});

test('100 gameplay cap includes achievements; UTC rollover resets allowances, not finish eligibility', async () => {
	const f = fixture();
	await f.earn(50, 'achievement'); // accounting primitive fixture, not an approved bonus payout
	for (let i = 0; i < 5; i++) assert.equal((await f.games.finish('player', await ready(f))).coins.awarded, 10);
	const capped = await ready(f, 2000, 4);
	assert.equal((await f.games.finish('player', capped)).coins.awarded, 0);
	assert.equal((await f.daily()).gameplayEarned, 100); assert.equal(f.data.achievements.size, 4);
	f.setTime('2026-10-12T00:00:00Z');
	assert.equal((await f.daily()).remainingGameplay, 100);
	assert.equal((await f.games.finish('player', capped)).coins.awarded, 0, 'cap-blocked completions are not backfilled');
	assert.equal((await f.games.finish('player', await ready(f))).coins.awarded, 10);
	assert.equal(f.data.balance, 110, 'pending entitlements do not pay themselves next day');
});

test('total cap is shared across sources and remaining allowance under 10 never truncates completion reward', async () => {
	const f = fixture(); await f.earn(195);
	assert.equal((await f.games.finish('player', await ready(f))).coins.awarded, 0);
	await f.earn(5, 'another_source');
	await assert.rejects(f.earn(1), /Daily Coin cap/);
	assert.equal((await f.daily()).remainingTotal, 0); assert.equal(f.data.balance, 200);
});

test('ten completions exhaust gameplay allowance and later concurrent finishes cannot exceed cap', async () => {
	const f = fixture();
	for (let i = 0; i < 10; i++) await f.games.finish('player', await ready(f));
	const id = await ready(f);
	await Promise.all([f.games.finish('player', id), f.games.finish('player', id)]);
	assert.equal(f.data.balance, 100); assert.equal(f.data.entries.length, 10); assert.equal(f.data.games, 11);
});

test('post-credit flags append idempotent reversals, invalidate entitlements and never reopen allowance', async () => {
	const f = fixture(), id = await ready(f, 2000, 4);
	await f.games.finish('player', id);
	const [first, retry] = await Promise.all([f.games.flag('player', id, 'abuse fixture'), f.games.flag('player', id, 'abuse fixture')]);
	assert.deepEqual(first, { flagged: true, reversed: 10 }); assert.deepEqual(first, retry);
	assert.equal(f.data.entries.length, 2); assert.equal(f.data.entries[0].change_type, 'earn'); assert.equal(f.data.entries[1].change_type, 'reverse');
	assert.equal(f.data.entries[1].reference_id, f.data.entries[0].id); assert.equal(f.data.balance, 0);
	assert.equal((await f.daily()).remainingGameplay, 90);
	assert.ok([...f.data.achievements.values()].every(a => a.invalidated_at));
	const result = await f.games.finish('player', id);
	assert.equal(result.coins.flagged, true); assert.equal(result.coins.reversed, 10);
	assert.equal(f.data.games, 1); assert.equal(f.data.entries.length, 2);
	f.data.active = false;
	assert.deepEqual(await f.games.flag('player', id, 'retry after account block'), first, 'moderation can reverse blocked accounts');
});

test('ledger failure rolls back verified finish, aggregates, entitlements and credits together', async () => {
	const f = fixture(), id = await ready(f, 2000, 4); f.failLedger(true);
	await assert.rejects(f.games.finish('player', id), /ledger unavailable/);
	assert.equal(f.data.sessions.get(id).status, 'active'); assert.equal(f.data.games, 0);
	assert.equal(f.data.balance, 0); assert.equal(f.data.achievements.size, 0); assert.equal(f.data.entries.length, 0);
	f.failLedger(false); assert.equal((await f.games.finish('player', id)).coins.awarded, 10);
	f.failLedger(true); await assert.rejects(f.games.flag('player', id, 'review'), /ledger unavailable/);
	assert.equal(f.data.sessions.get(id).flagged_at, undefined); assert.equal(f.data.balance, 10);
	f.failLedger(false); await f.games.flag('player', id, 'review'); assert.equal(f.data.balance, 0);
});

test('finish versus flag race serializes both ways without leaving credited flagged earnings', async () => {
	const f = fixture(), id = await ready(f);
	const [finished, flagged] = await Promise.all([f.games.finish('player', id), f.games.flag('player', id, 'race review')]);
	assert.equal(finished.coins.awarded, 10); assert.equal(flagged.reversed, 10); assert.equal(f.data.balance, 0);
	const other = await ready(f);
	const outcomes = await Promise.allSettled([f.games.flag('player', other, 'race review'), f.games.finish('player', other)]);
	assert.equal(outcomes[0].status, 'fulfilled'); assert.equal(outcomes[1].status, 'rejected');
	assert.match(outcomes[1].reason.message, /flagged/); assert.equal(f.data.entries.length, 2);
});

test('insufficient reversal balance fails atomically instead of partially flagging or debiting', async () => {
	const f = fixture(), id = await ready(f, 500, 4);
	await f.games.finish('player', id); f.data.balance = 5; // hypothetical future spend, not a current UI action
	await assert.rejects(f.games.flag('player', id, 'review'), /Insufficient/);
	assert.equal(f.data.sessions.get(id).flagged_at, undefined); assert.equal(f.data.balance, 5);
	assert.equal(f.data.entries.length, 1); assert.ok([...f.data.achievements.values()].every(a => !a.invalidated_at));
});

test('moderation reverses every linked credited source once, preserving unrelated earnings', async () => {
	const f = fixture(), id = await ready(f, 500, 4);
	await f.games.finish('player', id);
	await f.earn(50, 'achievement', id); // primitive fixture only: no bonus payout policy chosen
	f.data.sessions.get(id).coins_awarded = 60;
	await f.earn(20);
	assert.deepEqual(await f.games.flag('player', id, 'review'), { flagged: true, reversed: 60 });
	assert.deepEqual(await f.games.flag('player', id, 'review'), { flagged: true, reversed: 60 });
	assert.equal(f.data.balance, 20); assert.equal(f.data.entries.filter(e => e.change_type === 'reverse').length, 2);
	assert.equal((await f.daily()).earned, 80);
});