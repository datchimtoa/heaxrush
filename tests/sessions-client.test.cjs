const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

function client() {
	const elements = new Map();
	const calls = [];
	const context = vm.createContext({
		crypto: webcrypto, AbortSignal,
		playerAccount: { state: 'connected', user: { officialBest: 50 } },
		gameState: 0, rush: 1, settings: {},
		MainHex: { rotate: () => true },
		$(selector) {
			if (!elements.has(selector)) elements.set(selector, {});
			const element = elements.get(selector);
			const chain = { prop(key, value) { element[key] = value; return chain; }, text(value) { element.text = value; return chain; } };
			return chain;
		},
		unlockGameAudio() {}, gameFeedback() {},
		showResultCoins(coins) { context.resultCoins = coins; },
		startFirstRunTutorial() { context.tutorialStarts = (context.tutorialStarts || 0) + 1; },
		startPracticeRun() { context.practiceStarts = (context.practiceStarts || 0) + 1; },
		init(seed) { context.runGeneration++; context.officialRun = null; context.gameTicks = 0; context.gameState = 1; context.seed = seed; },
		pause() { context.gameState = -1; }, formatRunTime: seconds => seconds + ' seconds',
		fetch: async (url, options) => {
			const body = JSON.parse(options.body);
			calls.push({ url, body });
			if (url.endsWith('/start')) return { ok: true, json: async () => ({ id: 'game', seed: 42, tick: 0, rulesVersion: 'hexa-rush-v1' }) };
			if (url.endsWith('/events')) return { ok: true, json: async () => ({ tick: body.toTick }) };
			if (url.endsWith('/finish')) return { ok: true, json: async () => ({ score: 38, bestScore: 50, maxCombo: 1, blocksCleared: 10, durationMs: 61733, verified: true, coins: { awarded: 0, balance: 0, held: 0, issuanceEnabled: false } }) };
			return { ok: true, json: async () => ({ status: 'abandoned' }) };
		}
	});
	context.setStartScreen = () => { context.init(); context.gameState = 0; };
	for (const name of ['session-rules', 'sessions']) vm.runInContext(readFileSync(path.join(__dirname, '../js', name + '.js'), 'utf8'), context);
	return { context, elements, calls };
}

test('guests start practice without contacting official APIs', async () => {
	const { context, calls } = client();
	context.playerAccount.state = 'guest';
	await context.startPlayerRun();
	assert.equal(context.practiceStarts, 1);
	assert.equal(calls.length, 0);
});

test('pending or failed Telegram login never silently starts a device-only run', async () => {
	for (const state of ['connecting', 'error']) {
		const { context, calls, elements } = client();
		context.playerAccount.state = state;
		await context.startPlayerRun();
		assert.equal(context.practiceStarts, undefined);
		assert.equal(context.gameState, 0);
		assert.equal(calls.length, 0);
		assert.equal(elements.get('#runNotice').hidden, false);
		assert.equal(elements.get('#practiceBtn').hidden, false);
	}
});

test('verified starts use a server-issued seed and retries reuse one idempotency key', async () => {
	const { context, calls } = client();
	const fetch = context.fetch;
	let first = true;
	context.fetch = async (...args) => { const response = await fetch(...args); if (first) { first = false; throw Error('lost response'); } return response; };
	await context.startPlayerRun();
	assert.equal(calls.length, 2);
	assert.equal(calls[0].body.requestId, calls[1].body.requestId);
	assert.equal(context.seed, 42);
	assert.equal(context.officialRun.id, 'game');
	assert.equal(context.practiceStarts, undefined);
	assert.equal(context.tutorialStarts, 1, 'official play also offers the first-run guide');
});

test('failed starts never silently fall back to practice or fabricate an official run', async () => {
	const { context, elements } = client();
	context.fetch = async () => { throw Error('offline'); };
	await context.startPlayerRun();
	assert.equal(context.officialRun, null);
	assert.equal(context.gameState, 0);
	assert.equal(context.practiceStarts, undefined);
	assert.equal(elements.get('#practiceBtn').hidden, false);
});

test('a failed official restart cannot resume the abandoned board as practice', async () => {
	const { context } = client();
	await context.startPlayerRun();
	context.gameState = -1;
	const fetch = context.fetch;
	context.fetch = async (url, options) => {
		if (url.endsWith('/abandon')) return fetch(url, options);
		throw Error('offline');
	};
	await context.startPlayerRun();
	assert.equal(context.gameState, 0, 'failed restart must leave the title, not a resumable abandoned run');
	assert.equal(context.officialRun, null);
	assert.equal(context.practiceStarts, undefined);
});

test('returning to title cancels an in-flight official start', async () => {
	const { context, calls } = client();
	const fetch = context.fetch;
	let release;
	context.fetch = async (url, options) => {
		if (!url.endsWith('/start')) return fetch(url, options);
		return new Promise(resolve => { release = async () => resolve(await fetch(url, options)); });
	};
	const starting = context.startPlayerRun();
	for (let i = 0; i < 10 && !release; i++) await Promise.resolve();
	assert.ok(release);
	context.setStartScreen();
	await release();
	await starting;
	assert.equal(context.gameState, 0);
	assert.equal(context.officialRun, null);
	assert.equal(calls.at(-1).url, '/api/game/game/abandon');
});

test('only accepted rotations and actual rush changes enter the event stream', async () => {
	const { context } = client();
	await context.startPlayerRun();
	context.gameTicks = 10;
	context.rotatePlayer(1);
	context.MainHex.rotate = () => false;
	context.rotatePlayer(-1);
	context.setPlayerRush(true);
	context.setPlayerRush(true);
	context.setPlayerRush(false);
	assert.deepEqual(JSON.parse(JSON.stringify(context.officialRun.events)), [{ tick: 10, type: 'rotate', value: 1 }, { tick: 10, type: 'rush', value: true }, { tick: 10, type: 'rush', value: false }]);
});

test('finish uploads bounded batches and displays only the server result without writing practice storage', async () => {
	const { context, calls, elements } = client();
	await context.startPlayerRun();
	context.gameTicks = 1300;
	await context.syncOfficialRun(true);
	assert.deepEqual(calls.filter(call => call.url.endsWith('/events')).map(call => [call.body.fromTick, call.body.toTick]), [[0, 600], [600, 1200], [1200, 1300]]);
	assert.deepEqual(calls.at(-1).body, {});
	assert.equal(context.officialRun.verified, true);
	assert.equal(elements.get('#cScore').text, 38);
	assert.equal(context.playerAccount.user.officialBest, 50);
	assert.equal(elements.get('#resultSaveNote').text, 'Score saved to your account');
	assert.equal(elements.get('#resultEyebrow').text, 'NICE RUN');
	assert.deepEqual(JSON.parse(JSON.stringify(context.resultCoins)), { awarded: 0, balance: 0, held: 0, issuanceEnabled: false });
});

test('a lost batch response retries the identical batch and no unacknowledged input is removed', async () => {
	const { context, calls } = client();
	await context.startPlayerRun();
	context.gameTicks = 300;
	context.officialRun.events.push({ tick: 10, type: 'rotate', value: 1 });
	const fetch = context.fetch;
	context.fetch = async (...args) => { await fetch(...args); throw Error('lost response'); };
	await context.syncOfficialRun(false);
	assert.equal(context.gameState, -1);
	assert.equal(context.officialRun.ackTick, 0);
	assert.equal(context.officialRun.events.length, 1);
	context.fetch = fetch;
	await context.syncOfficialRun(true);
	const batches = calls.filter(call => call.url.endsWith('/events'));
	assert.deepEqual(batches[0].body, batches[1].body);
	assert.equal(context.officialRun.verified, true);
});

test('failed finish remains visibly unverified and can retry without uploading scores', async () => {
	const { context, elements, calls } = client();
	await context.startPlayerRun();
	context.gameTicks = 5;
	const fetch = context.fetch;
	context.fetch = async (url, options) => url.endsWith('/finish') ? { ok: false, status: 409 } : fetch(url, options);
	await context.syncOfficialRun(true);
	assert.equal(context.officialRun.verified, false);
	assert.equal(elements.get('#retryResult').hidden, false);
	assert.match(elements.get('#resultSaveNote').text, /Could not save.*Retry saving/);
	assert.equal(elements.get('#resultEyebrow').text, 'SCORE NOT SAVED');
	context.fetch = fetch;
	await context.syncOfficialRun(true);
	assert.equal(context.officialRun.verified, true);
	assert.equal(calls.filter(call => call.url.endsWith('/events')).length, 1);
});

test('an old asynchronous response cannot overwrite a new run', async () => {
	const { context, elements } = client();
	await context.startPlayerRun();
	context.gameTicks = 1;
	const fetch = context.fetch;
	let release;
	context.fetch = async (url, options) => url.endsWith('/finish') ? new Promise(resolve => { release = () => resolve({ ok: true, json: async () => ({ score: 999, bestScore: 999 }) }); }) : fetch(url, options);
	const old = context.syncOfficialRun(true);
	for (let i = 0; i < 10 && !release; i++) await Promise.resolve();
	assert.ok(release);
	context.officialRun = { id: 'new' };
	release();
	await old;
	assert.equal(elements.has('#cScore'), false);
	assert.equal(context.playerAccount.user.officialBest, 50);
});

test('Loading is temporary start feedback, not a permanent account-run label', async () => {
	const { context, elements } = client(); let release;
	const fetch = context.fetch;
	context.fetch = (url, options) => new Promise(resolve => { release = () => resolve(fetch(url, options)); });
	const pending = context.startPlayerRun();
	assert.equal(elements.get('#runNotice').text, 'Loading…');
	for (let i = 0; i < 10 && !release; i++) await Promise.resolve();
	assert.ok(release); release(); await pending;
	assert.equal(elements.get('#gameMode').text, 'Chase your next best!');
	assert.equal(context.gameState, 1);
});