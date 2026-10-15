const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function data(period = 'daily', overrides = {}) {
	return { period, timezone: 'UTC', rewardsEnabled: false, limit: period === 'daily' ? 50 : 100,
		startsAt: '2026-10-11T00:00:00.000Z', endsAt: '2026-10-12T00:00:00.000Z', entries: [], own: null, ...overrides };
}
function client() {
	const elements = new Map(), requests = [], buttons = ['daily', 'weekly'].map(period => ({ dataset: { leaderboardPeriod: period }, setAttribute(key, value) { this[key] = value; } }));
	function node() {
		return { children: [], dataset: {}, text: '', appendChild(child) { this.children.push(child); },
			get textContent() { return this.text + this.children.map(child => child.textContent).join(''); },
			set textContent(value) { this.text = value; this.children = []; } };
	}
	function element(id) {
		if (!elements.has(id)) elements.set(id, node());
		return elements.get(id);
	}
	const context = vm.createContext({
		playerAccount: { state: 'connected', user: { id: 'owner', username: 'verified_player' } }, AbortSignal,
		localStorage: { getItem() { throw Error('Practice must not enter standings'); }, setItem() { throw Error('Standings must not be stored'); } },
		document: { getElementById: element, createElement: node, querySelectorAll() { return buttons; } },
		$(selector) {
			const chain = {
				prop(key, value) { for (const id of selector.split(', ')) element(id.slice(1))[key] = value; return chain; },
				text(value) { for (const id of selector.split(', ')) element(id.slice(1)).textContent = value; return chain; },
				empty() { element(selector.slice(1)).textContent = ''; return chain; }
			}; return chain;
		},
		fetch: async (url, options) => { requests.push({ url, options }); return { ok: true, json: async () => data() }; }
	});
	for (const file of ['identity', 'leaderboards']) vm.runInContext(readFileSync(path.join(__dirname, '../js', file + '.js'), 'utf8'), context);
	return { context, requests, element, buttons };
}

test('guests never fetch rankings or use practice storage; authenticated empty periods do not invent ranks', async () => {
	const f = client(); f.context.playerAccount = { state: 'guest', user: null };
	await f.context.loadLeaderboard(); assert.equal(f.requests.length, 0);
	assert.equal(f.element('leaderboardRefresh').hidden, true); assert.match(f.element('leaderboardStatus').textContent, /Telegram/);
	f.context.playerAccount = { state: 'connected', user: { id: 'owner' } };
	await f.context.loadLeaderboard(); assert.match(f.element('leaderboardOwn').textContent, /Not ranked/);
	assert.match(f.element('leaderboardStatus').textContent, /No scores/);
	assert.equal(f.element('leaderboardEntries').children.length, 0);
});

test('rankings use read-only cookie/no-store requests, preserve decimal points and render names as safe text', async () => {
	const f = client(); const original = f.context.fetch;
	const label = '<img src=x onerror=alert(1)>';
	f.context.fetch = async (...args) => { await original(...args); return { ok: true, json: async () => data('daily', { own: { rank: 184, score: 100.5 }, entries: [{ rank: 1, score: 1200.5, label, isYou: false }] }) }; };
	await f.context.loadLeaderboard();
	assert.equal(f.requests[0].url, '/api/leaderboards?period=daily');
	assert.equal(f.requests[0].options.credentials, 'same-origin'); assert.equal(f.requests[0].options.cache, 'no-store');
	assert.equal(f.requests[0].options.body, undefined); assert.equal(f.requests[0].options.method, undefined);
	const row = f.element('leaderboardEntries').children[0];
	assert.equal(row.children[1].children[0].textContent, label); assert.equal(row.children[2].textContent, '1,200.5');
	assert.match(f.element('leaderboardOwn').textContent, /#184.*@verified_player.*100.5/);
	assert.equal(f.element('leaderboardStatus').hidden, true, 'no explanatory clutter for populated rankings');
	assert.equal(f.element('leaderboardColumns').hidden, false);
	assert.equal(f.element('leaderboardRefresh').disabled, false);
});

test('rapid period switching discards stale daily responses and updates the pressed period without touching gameplay', async () => {
	const f = client(); let release;
	f.context.score = 54; f.context.gameTicks = 123;
	f.context.fetch = async () => new Promise(resolve => { release = () => resolve({ ok: true, json: async () => data('daily', { own: { rank: 1, score: 999 } }) }); });
	const pending = f.context.loadLeaderboard();
	f.context.fetch = async () => ({ ok: true, json: async () => data('weekly', { own: { rank: 5, score: 50 } }) });
	f.context.selectLeaderboardPeriod('weekly');
	await new Promise(resolve => setImmediate(resolve));
	release(); await pending;
	assert.match(f.element('leaderboardOwn').textContent, /#5.*50/);
	assert.equal(f.buttons[0]['aria-pressed'], 'false'); assert.equal(f.buttons[1]['aria-pressed'], 'true');
	assert.equal(f.context.score, 54); assert.equal(f.context.gameTicks, 123);
	f.context.selectLeaderboardPeriod('monthly'); assert.equal(f.context.leaderboardPeriod, 'weekly');
});

test('account changes discard old own ranks and failures/malformed responses show retry without fabricated standings', async () => {
	const f = client(); let release;
	f.context.fetch = async () => new Promise(resolve => { release = () => resolve({ ok: true, json: async () => data('daily', { own: { rank: 1, score: 999 } }) }); });
	const pending = f.context.loadLeaderboard();
	f.context.playerAccount = { state: 'connected', user: { id: 'new' } }; f.context.resetLeaderboardDisplay();
	release(); await pending; assert.equal(f.element('leaderboardOwn').textContent, '');
	for (const invalid of [data('weekly'), data('daily', { rewardsEnabled: true }), data('daily', { own: { rank: -1, score: 50 } }),
		data('daily', { entries: [{ rank: 1, score: -1, label: 'Invalid', isYou: false }] }), data('daily', { endsAt: 'bad-date' }), data('daily', { limit: 1000 })]) {
		f.context.fetch = async () => ({ ok: true, json: async () => invalid });
		await f.context.loadLeaderboard();
		assert.match(f.element('leaderboardStatus').textContent, /retry/i);
		assert.equal(f.element('leaderboardEntries').children.length, 0); assert.equal(f.element('leaderboardOwn').textContent, '');
	}
	f.context.fetch = async () => { throw Error('offline'); }; await f.context.loadLeaderboard();
	assert.match(f.element('leaderboardStatus').textContent, /retry/i); assert.equal(f.element('leaderboardRefresh').disabled, false);
});

test('own row and top-slice row share confirmed identity, highlight You and clear names when the account changes', async () => {
	const f = client();
	f.context.fetch = async () => ({ ok: true, json: async () => data('daily', {
		own: { rank: 2, score: 50.5 }, entries: [{ rank: 2, score: 50.5, label: 'Player old-label', isYou: true }]
	}) });
	await f.context.loadLeaderboard();
	const own = f.element('leaderboardOwn').children[0], row = f.element('leaderboardEntries').children[0];
	assert.equal(own.children[1].textContent, '@verified_playerYOU');
	assert.equal(row.children[1].textContent, '@verified_playerYOU');
	assert.match(row.className, /leaderboard-you/);
	assert.equal(row.dataset.rank, 2);
	f.context.playerAccount.user = { id: 'new', username: null, firstName: 'Minh', lastName: 'One' };
	f.context.resetLeaderboardDisplay();
	assert.equal(f.element('leaderboardOwn').textContent, '');
	assert.equal(f.element('leaderboardOwn').hidden, true);
	await f.context.loadLeaderboard();
	assert.match(f.element('leaderboardOwn').textContent, /Minh One/);
	assert.doesNotMatch(f.element('leaderboardEntries').textContent, /verified_player|old-label/);
});
