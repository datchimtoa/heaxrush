const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const { createCoinStore } = require('../server/coins.cjs');
const { createApp } = require('../server/app.cjs');
const { readConfig } = require('../server/config.cjs');

// SQL transaction fixture; real locking/constraints are covered by the opt-in PostgreSQL suite.
function fixture() {
	const data = { balance: 0, held: 0, entries: [], active: true, failUpdate: false, releases: 0 };
	let backup;
	const client = {
		async query(sql, args = []) {
			const text = sql.replace(/\s+/g, ' ').trim();
			const result = rows => ({ rows: structuredClone(rows), rowCount: rows.length });
			if (text === 'BEGIN') { backup = structuredClone(data); return result([]); }
			if (text === 'ROLLBACK') { Object.assign(data, backup); return result([]); }
			if (text === 'COMMIT') return result([]);
			if (text.startsWith('SELECT coin_balance')) return result(data.active ? [{ coin_balance: data.balance, coins_held: data.held }] : []);
			if (text.includes('AS total_earned')) return result([{ total_earned: data.entries.filter(e => e.change_type === 'earn' && e.created_at >= args[1] && e.created_at < args[2]).reduce((sum, e) => sum + e.amount, 0), gameplay_earned: 0 }]);
			if (text.startsWith('SELECT * FROM coin_ledger')) return result(data.entries.filter(e => e.user_id === args[0] && e.source === args[1] && e.reference_id === args[2] && e.change_type === args[3]));
			if (text.startsWith('INSERT INTO coin_ledger')) {
				const [id, user_id, change_type, amount, balance_before, balance_after, held_before, held_after, source, reference_id, reason] = args;
				const row = { id, user_id, change_type, amount, balance_before, balance_after, held_before, held_after, source, reference_id, reason, created_at: args[11], session_id: args[12] };
				data.entries.push(row); return result([row]);
			}
			if (text.startsWith('UPDATE users SET coin_balance')) {
				if (data.failUpdate) throw Error('database failure');
				data.balance = args[1]; data.held = args[2]; return result([]);
			}
			throw Error('Unexpected SQL: ' + text);
		},
		release() { data.releases++; }
	};
	return { data, coins: createCoinStore({ connect: async () => client }) };
}

function change(type = 'earn', amount = 20, referenceId = randomUUID()) {
	return { type, amount, referenceId, source: 'test_fixture', reason: 'Fixture operation, not a live reward' };
}

test('server-only ledger operations record all five types and available/held before and after', async () => {
	const { coins, data } = fixture();
	const earned = await coins.change('player', change());
	assert.equal(earned.balanceBefore, 0); assert.equal(earned.balanceAfter, 20);
	await coins.change('player', change('hold', 8));
	assert.equal(data.balance, 12); assert.equal(data.held, 8);
	await coins.change('player', change('release', 3));
	assert.equal(data.balance, 15); assert.equal(data.held, 5);
	await coins.change('player', change('spend', 4));
	await coins.change('player', change('reverse', 2));
	assert.equal(data.balance, 9); assert.equal(data.held, 5);
	assert.equal(data.entries.length, 5);
	assert.equal(data.entries.at(-1).balance_before, 11);
	assert.equal(data.releases, 5);
});

test('identical ledger retries are idempotent, conflicts reject and no balance can go negative or unsafe', async () => {
	const { coins, data } = fixture(), operation = change();
	const first = await coins.change('player', operation);
	await coins.change('player', change('spend', 5));
	assert.deepEqual(await coins.change('player', operation), first);
	assert.equal(data.balance, 15); assert.equal(data.entries.length, 2);
	await assert.rejects(coins.change('player', { ...operation, amount: 21 }), /Conflicting/);
	await assert.rejects(coins.change('player', { ...operation, reason: 'Changed' }), /Conflicting/);
	for (const type of ['spend', 'hold', 'reverse', 'release']) await assert.rejects(coins.change('player', change(type, 30)), /Insufficient/);
	data.balance = Number.MAX_SAFE_INTEGER;
	await assert.rejects(coins.change('player', change()), /balance limit/);
	for (const operation of [change('fake'), change('earn', 0), change('earn', -1), change('earn', 1.5), change('earn', Infinity), { ...change(), source: '' }, { ...change(), referenceId: 'x'.repeat(129) }]) await assert.rejects(coins.change('player', operation), /Invalid/);
});

test('blocked players and database failure cannot leave a ledger entry or partial balance update', async () => {
	const { coins, data } = fixture();
	data.failUpdate = true;
	await assert.rejects(coins.change('player', change()), /database failure/);
	assert.equal(data.entries.length, 0); assert.equal(data.balance, 0);
	data.active = false;
	await assert.rejects(coins.change('player', change()), /Account unavailable/);
	assert.equal(data.entries.length, 0);
});

test('ledger summary is a bounded owner-filtered snapshot with pagination and disabled issuance', async () => {
	const entries = Array.from({ length: 21 }, (_, i) => ({ id: randomUUID(), amount: '5', balance_before: '0', balance_after: '5', held_before: '0', held_after: '0', change_type: 'earn', source: 'test', reference_id: String(i), reason: 'Fixture', created_at: new Date() }));
	const cursor = randomUUID();
	const coins = createCoinStore({ async query(sql, args) {
		assert.match(sql, /LIMIT 21/); assert.match(sql, /user_id = u.id/); assert.match(sql, /status = 'active'/);
		assert.deepEqual(args.slice(0, 2), ['player', cursor]);
		assert.equal(args[2].getUTCHours(), 0); assert.equal(args[3] - args[2], 86400000);
		return { rowCount: 1, rows: [{ coin_balance: '9007199254740991', coins_held: '0', entries }] };
	} });
	const result = await coins.summary('player', cursor);
	assert.equal(result.balance, Number.MAX_SAFE_INTEGER); assert.equal(result.entries.length, 20);
	assert.equal(result.nextCursor, entries[19].id); assert.equal(result.issuanceEnabled, false);
	assert.equal(result.entries[0].balanceAfter, 5);
	assert.equal(result.daily.remainingGameplay, 100); assert.equal(result.daily.remainingTotal, 200);
});

test('all-source daily cap cannot be bypassed by changing source keys or debit/reversal operations', async () => {
	const { coins, data } = fixture();
	await coins.change('player', change('earn', 200));
	await assert.rejects(coins.change('player', { ...change('earn', 1), source: 'other_source' }), /Daily Coin cap/);
	await coins.change('player', change('reverse', 200));
	await assert.rejects(coins.change('player', change('earn', 1)), /Daily Coin cap/);
	assert.equal(data.balance, 0);
	for (const source of ['gameplay', 'achievement']) await assert.rejects(coins.change('player', { ...change(), source }), /verified finish/);
});

test('Coins HTTP API requires authentication, scopes reads to session user and has no mutation route', async t => {
	const config = readConfig({ APP_ORIGIN: 'https://game.example', TELEGRAM_BOT_TOKEN: 'test-only' });
	const calls = [];
	const summary = { balance: 0, held: 0, issuanceEnabled: false, entries: [], nextCursor: null };
	const coins = { async summary(...args) { calls.push(args); return summary; } };
	const store = { async getSession() { return { user: { id: 'owner' } }; } };
	const server = createApp({ config, store, coins, logger: { error() {} } }).listen(0, '127.0.0.1');
	await once(server, 'listening');
	t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
	const base = `http://127.0.0.1:${server.address().port}/api/coins`;
	const headers = { Cookie: config.cookieName + '=' + 'a'.repeat(64) };
	assert.equal((await fetch(base)).status, 401);
	const response = await fetch(base, { headers });
	assert.equal(response.headers.get('cache-control'), 'no-store'); assert.deepEqual(await response.json(), summary);
	const before = randomUUID();
	assert.equal((await fetch(base + '?before=' + before, { headers })).status, 200);
	assert.deepEqual(calls, [['owner', null], ['owner', before]]);
	for (const query of ['?userId=victim', '?balance=999', '?before=bad', '?before=' + before + '&before=' + before]) assert.equal((await fetch(base + query, { headers })).status, 400);
	for (const method of ['POST', 'PATCH', 'DELETE']) assert.equal((await fetch(base, { method, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: 99999 }) })).status, 404);
	store.getSession = async () => null;
	assert.equal((await fetch(base, { headers })).status, 401);
});
