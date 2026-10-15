const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createReplay, validateBatch, rules, GameError } = require('../server/replay.cjs');
const { createGameStore } = require('../server/game-store.cjs');
const { createApp } = require('../server/app.cjs');
const { readConfig } = require('../server/config.cjs');
const { seededGameRandom } = require('../js/session-rules.js');

// SQL fixture only, not a replacement for the opt-in real PostgreSQL test.
function fixture() {
	const data = { sessions: new Map(), batches: new Map(), best: 0, total: 0, games: 0, active: true, releases: 0 };
	let clock = 1800000000000;
	let backup;
	const client = {
		async query(sql, args = []) {
			const text = sql.replace(/\s+/g, ' ').trim();
			const result = rows => ({ rows: structuredClone(rows), rowCount: rows.length });
			if (text === 'BEGIN') { backup = structuredClone(data); return result([]); }
			if (text === 'ROLLBACK') { Object.assign(data, backup); return result([]); }
			if (text === 'COMMIT') return result([]);
			if (text.startsWith('SELECT id FROM users')) return result(data.active ? [{ id: args[0] }] : []);
			if (text.startsWith('SELECT best_score, coin_balance')) return result([{ best_score: data.best, coin_balance: 0, coins_held: 0 }]);
			if (text.includes('SELECT * FROM game_sessions')) {
				if (text.includes('request_id')) return result([...data.sessions.values()].filter(row => row.user_id === args[0] && row.request_id === args[1]));
				return result([...data.sessions.values()].filter(row => row.id === args[0] && row.user_id === args[1]));
			}
			if (text.startsWith('INSERT INTO game_sessions')) {
				const row = { id: args[0], user_id: args[1], request_id: args[2], rules_version: args[3], seed: args[4], started_at: args[5], expires_at: args[6], status: 'active', last_tick: 0, events: [], engine_state: null };
				data.sessions.set(row.id, row); return result([row]);
			}
			if (text.startsWith('SELECT payload_hash')) return result(data.batches.has(args[0] + ':' + args[1]) ? [{ payload_hash: data.batches.get(args[0] + ':' + args[1]) }] : []);
			if (text.startsWith('INSERT INTO game_event_batches')) { data.batches.set(args[0] + ':' + args[1], args[3]); return result([]); }
			if (text.startsWith('UPDATE game_sessions SET events')) {
				Object.assign(data.sessions.get(args[0]), { events: JSON.parse(args[1]), last_tick: args[2], engine_state: JSON.parse(args[3]) }); return result([]);
			}
			if (text.startsWith("UPDATE game_sessions SET status = 'finished'")) {
				const row = data.sessions.get(args[0]); Object.assign(row, { status: 'finished', ended_at: args[1], server_score: args[2], max_combo: args[3], blocks_cleared: args[4], duration_ms: args[5] }); return result([row]);
			}
			if (text.startsWith('UPDATE users SET best_score')) { data.best = Math.max(data.best, args[1]); data.total += args[1]; data.games++; return result([]); }
			if (text.startsWith('UPDATE game_sessions SET status')) {
				const status = text.includes("'expired'") ? 'expired' : 'abandoned';
				for (const row of data.sessions.values()) {
					if (text.includes('user_id') ? row.user_id === args[0] && row.status === 'active' && (status !== 'expired' || row.expires_at <= args[1]) : row.id === args[0]) { row.status = status; row.ended_at = args[1]; }
				}
				return result([]);
			}
			throw Error('Unexpected fixture SQL: ' + text);
		},
		release() { data.releases++; }
	};
	return { data, now: () => clock, advance: ms => clock += ms, games: createGameStore({ connect: async () => client }, () => clock) };
}

function endTick(seed, events = []) {
	const replay = createReplay(seed);
	let tick = 0;
	while (!replay.result().ended && tick < 18000) {
		replay.advance(tick + 1, events.filter(event => event.tick === tick)); tick++;
	}
	assert.equal(replay.result().ended, true);
	return replay.result();
}

test('seeded random generation is reproducible including a zero seed', () => {
	for (const seed of [0, 42, 4294967295]) {
		const a = seededGameRandom(seed), b = seededGameRandom(seed);
		for (let i = 0; i < 100; i++) assert.equal(a(), b());
	}
});

test('replay snapshots produce the same full run as uninterrupted replay', () => {
	const expected = endTick(42);
	let replay = createReplay(42);
	for (let tick = 0; tick < expected.tick;) {
		const next = Math.min(expected.tick, tick + 300);
		replay.advance(next, []);
		replay = createReplay(42, JSON.parse(JSON.stringify(replay.snapshot())));
		tick = next;
	}
	assert.deepEqual(replay.result(), expected);
	assert.equal(expected.score, 38);
	assert.equal(expected.blocksCleared, 10);
});

test('headless and rendered simulation agree at different scales and drawing rates', () => {
	const sources = ['session-rules', 'scoring', 'math', 'Block', 'Hex', 'Text', 'checking', 'wavegen', 'update', 'effects'];
	const events = [{ tick: 0, type: 'rush', value: true }, { tick: 30, type: 'rotate', value: -1 }, { tick: 70, type: 'rotate', value: 1 }, { tick: 120, type: 'rush', value: false }];
	const server = createReplay(17); server.advance(2000, events);
	for (const scale of [0.5, 1, 2]) {
		const context = vm.createContext({ settings: { baseHexWidth: 87, baseBlockHeight: 20, blockHeight: 20 * scale, scale, rows: 7, startDist: 350, creationDt: 18, comboTime: 300, speedModifier: 0.65, creationSpeedModifier: 0.65 }, trueCanvas: { width: 390, height: 844 }, window: { devicePixelRatio: 2 }, colors: ['#e74c3c', '#f1c40f', '#3498db', '#2ecc71', '#9b59b6'], angularVelocityConst: 4, gameState: 1, score: 0, blocks: [], rush: 1, gameRandom: seededGameRandom(17), gameFeedback() {}, gdx: 0, gdy: 0, drawPolygon() {}, ctx: new Proxy({}, { get: () => () => {} }) });
		for (const name of sources) vm.runInContext(readFileSync(path.join(__dirname, '../js', name + '.js'), 'utf8'), context);
		context.ctx = new Proxy({}, { get: (target, key) => key.startsWith('create') ? () => ({ addColorStop() {} }) : () => {} });
		context.window.matchMedia = () => ({ matches: scale === 2 });
		context.MainHex = new context.Hex(87 * scale); context.waveone = new context.waveGen(context.MainHex);
		context.addNewBlock = (lane, color, speed) => context.blocks.push(new context.Block(lane, color, speed * 0.65));
		for (let tick = 0; tick < 2000; tick++) {
			for (const event of events.filter(event => event.tick === tick)) if (event.type === 'rotate') context.MainHex.rotate(event.value); else context.rush = event.value ? 4 : 1;
			context.update(context.rush);
			if (tick % 3 === 0) { context.MainHex.draw(); for (const block of context.MainHex.blocks.flat().concat(context.blocks)) block.draw(); }
		}
		assert.equal(context.score, server.result().score);
		assert.equal(context.MainHex.clearedBlocks, server.result().blocksCleared);
		assert.equal(context.MainHex.comboClock, 2000);
	}
});

test('batches accept inputs only and reject forged scores, state, spawns, gaps, excess, and malformed events', () => {
	const valid = { fromTick: 0, toTick: 100, events: [{ tick: 5, type: 'rotate', value: 1 }] };
	assert.equal(validateBatch(valid), valid);
	for (const body of [{ ...valid, score: 999 }, { ...valid, state: {} }, { ...valid, toTick: 601 }, { ...valid, toTick: rules.maxTicks + 1 }, { ...valid, events: [{ tick: 0, type: 'spawn', value: 1 }] }, { ...valid, events: [{ tick: 100, type: 'rotate', value: 1 }] }, { ...valid, events: [{ tick: 0, type: 'rotate', value: 6 }] }, { ...valid, events: [{ tick: 0, type: 'rush', value: 4 }] }, { ...valid, events: [{ tick: 5, type: 'rotate', value: 1 }, { tick: 4, type: 'rotate', value: 1 }] }, { ...valid, events: Array(201).fill(valid.events[0]) }]) assert.throws(() => validateBatch(body), GameError);
});

test('replay rejects impossible turn rates, redundant rush, and ticks after overflow', () => {
	assert.throws(() => createReplay(1).advance(10, [{ tick: 0, type: 'rotate', value: 1 }, { tick: 4, type: 'rotate', value: -1 }]), /Rotation rate/);
	assert.throws(() => createReplay(1).advance(10, [{ tick: 0, type: 'rush', value: false }]), /Redundant/);
	const ending = endTick(42);
	assert.throws(() => createReplay(42).advance(ending.tick + 1, []), /after game over/);
});

test('session starts are idempotent and a new Play abandons the prior active run', async () => {
	const f = fixture(), requestId = randomUUID();
	const first = await f.games.start('player', requestId);
	assert.deepEqual(await f.games.start('player', requestId), first);
	const second = await f.games.start('player', randomUUID());
	assert.notEqual(first.id, second.id);
	assert.equal(f.data.sessions.get(first.id).status, 'abandoned');
	assert.equal(f.data.sessions.get(second.id).status, 'active');
	assert.equal(f.data.games, 0);
});

test('session events enforce ownership, order, expiry, wall time and identical retries', async () => {
	const f = fixture(); const session = await f.games.start('player', randomUUID());
	const batch = { fromTick: 0, toTick: 300, events: [] };
	await assert.rejects(f.games.events('other', session.id, batch), /not found/);
	await assert.rejects(f.games.events('player', session.id, batch), /ahead/);
	f.advance(5000);
	await f.games.events('player', session.id, batch);
	assert.equal((await f.games.events('player', session.id, batch)).tick, 300);
	await assert.rejects(f.games.events('player', session.id, { ...batch, events: [{ tick: 1, type: 'rotate', value: 1 }] }), /Conflicting/);
	await assert.rejects(f.games.events('player', session.id, { fromTick: 301, toTick: 400, events: [] }), /gap/);
	f.advance(rules.lifetimeMs);
	await assert.rejects(f.games.events('player', session.id, { fromTick: 300, toTick: 400, events: [] }), /no longer active/);
	assert.equal(f.data.sessions.get(session.id).last_tick, 300);
});

test('official finish computes score from replay once and never accepts premature completion', async () => {
	const f = fixture(); const session = await f.games.start('player', randomUUID());
	await assert.rejects(f.games.finish('player', session.id), /not reached/);
	const expected = endTick(session.seed);
	f.advance(expected.durationMs + 1000);
	for (let from = 0; from < expected.tick;) {
		const to = Math.min(from + 600, expected.tick);
		await f.games.events('player', session.id, { fromTick: from, toTick: to, events: [] }); from = to;
	}
	const result = await f.games.finish('player', session.id);
	assert.equal(result.score, expected.score);
	assert.equal(result.blocksCleared, expected.blocksCleared);
	assert.equal(result.verified, true);
	assert.deepEqual(await f.games.finish('player', session.id), result);
	assert.equal(f.data.games, 1);
	assert.equal(f.data.total, expected.score);
	assert.equal(f.data.best, expected.score);
	assert.deepEqual(result.coins, { awarded: 0, balance: 0, held: 0, issuanceEnabled: false, reversed: 0, flagged: false });
	await assert.rejects(f.games.events('player', session.id, { fromTick: expected.tick, toTick: expected.tick + 1, events: [] }), /no longer active/);
});

test('abandoned and blocked runs cannot become official results', async () => {
	const f = fixture(); const session = await f.games.start('player', randomUUID());
	assert.equal((await f.games.abandon('player', session.id)).status, 'abandoned');
	assert.equal((await f.games.abandon('player', session.id)).status, 'abandoned');
	await assert.rejects(f.games.finish('player', session.id), /no longer active/);
	f.data.active = false;
	await assert.rejects(f.games.start('player', randomUUID()), /Account unavailable/);
	assert.equal(f.data.games, 0);
});

test('game HTTP routes require authentication and same Origin, reject score fields, and dispatch owned input', async t => {
	const f = fixture();
	const config = readConfig({ APP_ORIGIN: 'https://game.example' });
	const store = { async getSession() { return { user: { id: 'player' } }; } };
	const server = createApp({ config, store, games: f.games, now: f.now, logger: { error() {} } }).listen(0, '127.0.0.1');
	await once(server, 'listening');
	t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
	const request = (route, body, headers = {}) => fetch(`http://127.0.0.1:${server.address().port}/api/game/` + route, { method: 'POST', headers: { Origin: config.origin, 'Content-Type': 'application/json', Cookie: config.cookieName + '=' + 'a'.repeat(64), ...headers }, body: JSON.stringify(body) });
	assert.equal((await request('start', { requestId: randomUUID() }, { Cookie: '' })).status, 401);
	assert.equal((await request('start', { requestId: randomUUID() }, { Origin: 'https://evil.example' })).status, 403);
	assert.equal((await request('start', { requestId: randomUUID(), seed: 42 })).status, 400);
	assert.equal((await request('start', { requestId: [randomUUID()] })).status, 400);
	const started = await request('start', { requestId: randomUUID() }); assert.equal(started.status, 200);
	const session = await started.json();
	assert.equal((await request(session.id + '/finish', { score: 999 })).status, 400);
	assert.equal((await request(session.id + '/finish', [])).status, 400);
	assert.equal((await request(session.id + '/flag', { reason: 'client flag' })).status, 404, 'moderation is not a player action');
	assert.equal((await request(session.id + '/events', { fromTick: 0, toTick: 1, events: [], balance: 999 })).status, 400);
	assert.equal((await request(session.id + '/finish', {})).status, 409);
	assert.equal((await request(randomUUID() + '/abandon', {})).status, 404);
	assert.equal((await request(session.id + '/abandon', {})).status, 200);
});