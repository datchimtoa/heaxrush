const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function client() {
	const elements = new Map(), requests = [];
	function element(id) {
		if (!elements.has(id)) elements.set(id, { children: [], textContent: '', appendChild(child) { this.children.push(child); } });
		return elements.get(id);
	}
	const context = vm.createContext({
		playerAccount: { state: 'connected', user: { id: 'owner' } }, AbortSignal,
		localStorage: { getItem() { throw Error('Coins must not use local storage'); }, setItem() { throw Error('Coins must not use local storage'); } },
		document: { getElementById: element, createElement() { return { children: [], appendChild(child) { this.children.push(child); } }; } },
		$(selector) {
			const chain = {
				prop(key, value) { for (const id of selector.split(', ')) element(id.slice(1))[key] = value; return chain; },
				text(value) { for (const id of selector.split(', ')) element(id.slice(1)).textContent = value; return chain; },
				empty() { element(selector.slice(1)).children = []; return chain; }
			};
			return chain;
		},
		fetch: async (url, options) => { requests.push({ url, options }); return { ok: true, json: async () => ({ balance: 20, held: 0, issuanceEnabled: false, entries: [], nextCursor: null }) }; }
	});
	vm.runInContext(readFileSync(path.join(__dirname, '../js/coins.js'), 'utf8'), context);
	return { context, element, requests };
}

test('guest Coins never contact APIs or use local storage and account changes clear previous identity data', async () => {
	const { context, element, requests } = client();
	context.playerAccount.state = 'guest';
	context.resetCoinDisplay(); await context.loadCoinHistory(false);
	assert.equal(requests.length, 0); assert.equal(element('coinRefresh').hidden, true);
	assert.equal(element('coinBalanceRow').hidden, true); assert.equal(element('coinBalance').textContent, '—');
	context.playerAccount = { state: 'connected', user: { id: 'new' } };
	context.resetCoinDisplay();
	assert.equal(element('coinRefresh').hidden, false);
	assert.equal(element('coinHistory').children.length, 0);
});

test('Coins loads on demand with cookies/no-store, uses safe text, and paginates without posting balances', async () => {
	const { context, element, requests } = client();
	const fetch = context.fetch;
	const row = { type: 'earn', amount: 20, reason: '<img src=x onerror=alert(1)>', source: 'fixture', createdAt: '2026-10-11T00:00:00Z' };
	context.fetch = async (...args) => { await fetch(...args); return { ok: true, json: async () => ({ balance: 20, held: 3, entries: [row], nextCursor: requests.length === 1 ? 'next-id' : null, issuanceEnabled: false }) }; };
	await context.loadCoinHistory(false);
	assert.equal(requests[0].url, '/api/coins'); assert.equal(requests[0].options.credentials, 'same-origin'); assert.equal(requests[0].options.cache, 'no-store');
	assert.equal(requests[0].options.body, undefined);
	assert.equal(element('coinBalance').textContent, '20'); assert.equal(element('coinHeldRow').hidden, false);
	assert.equal(element('coinHistory').children[0].children[0].children[0].textContent, row.reason);
	assert.match(element('coinStatus').textContent, /rewards are not active/);
	assert.match(element('coinHistory').children[0].children[0].children[1].textContent, /^Coins added/);
	assert.doesNotMatch(element('coinHistory').children[0].children[0].children[1].textContent, /fixture/);
	await context.loadCoinHistory(true);
	assert.equal(requests[1].url, '/api/coins?before=next-id'); assert.equal(element('coinHistory').children.length, 2);
	assert.equal(element('coinMore').hidden, true);
});

test('slow history cannot overwrite another account and refresh errors offer retry without zeroing balance', async () => {
	const { context, element } = client();
	await context.loadCoinHistory(false);
	let release;
	context.fetch = async () => new Promise(resolve => { release = () => resolve({ ok: true, json: async () => ({ balance: 999, held: 0, entries: [] }) }); });
	const pending = context.loadCoinHistory(false);
	context.playerAccount = { state: 'connected', user: { id: 'new' } }; context.resetCoinDisplay();
	release(); await pending;
	assert.equal(element('coinBalance').textContent, '—');
	context.fetch = async () => { throw Error('offline'); };
	await context.loadCoinHistory(false);
	assert.match(element('coinStatus').textContent, /Retry/); assert.equal(element('coinRefresh').disabled, false);
});

test('result Coins use only server fields, disabled issuance has no fake award and practice hides them', () => {
	const { context, element } = client();
	context.showResultCoins({ awarded: 0, balance: 5, held: 0, issuanceEnabled: false });
	assert.equal(context.playerAccount.user.coinBalance, 5); assert.equal(element('resultCoins').hidden, false);
	assert.match(element('resultCoins').textContent, /Rewards are not active/); assert.doesNotMatch(element('resultCoins').textContent, /\+/);
	context.showResultCoins(undefined); assert.equal(element('resultCoins').hidden, true);
});

test('inactive daily allowances stay hidden, active allowances come from server data, and account changes clear both', async () => {
	const { context, element } = client();
	let issuanceEnabled = false;
	context.fetch = async () => ({ ok: true, json: async () => ({ balance: 0, held: 0, entries: [], nextCursor: null, issuanceEnabled,
		policyStatus: 'awaiting_achievement_payout_policy', daily: { day: '2026-10-11', timezone: 'UTC', earned: 150, gameplayEarned: 80, totalLimit: 200, gameplayLimit: 100, remainingTotal: 50, remainingGameplay: 20 } }) });
	await context.loadCoinHistory(false);
	assert.equal(element('coinDailyRow').hidden, true); assert.equal(element('coinEarnedToday').textContent, '150');
	assert.equal(element('coinGameplayRemaining').textContent, '20 / 100'); assert.equal(element('coinTotalRemaining').textContent, '50 / 200');
	assert.match(element('coinDayLabel').textContent, /UTC/); assert.match(element('coinStatus').textContent, /rewards are not active/);
	assert.doesNotMatch(element('coinStatus').textContent, /policy|approval|claimable/);
	issuanceEnabled = true; await context.loadCoinHistory(false);
	assert.equal(element('coinDailyRow').hidden, false);
	assert.equal(element('coinGameplayRemaining').textContent, '20 / 100');
	context.playerAccount = { state: 'guest', user: null }; context.resetCoinDisplay();
	assert.equal(element('coinDailyRow').hidden, true); assert.equal(element('coinEarnedToday').textContent, '—'); assert.equal(element('coinDayLabel').textContent, '');
});

test('malformed daily data cannot replace server display with unsafe or fabricated allowances', async () => {
	const { context, element } = client();
	context.fetch = async () => ({ ok: true, json: async () => ({ balance: 999, held: 0, entries: [], daily: { earned: -1 } }) });
	context.resetCoinDisplay(); await context.loadCoinHistory(false);
	assert.equal(element('coinDailyRow').hidden, true); assert.equal(element('coinBalance').textContent, '—'); assert.match(element('coinStatus').textContent, /Retry/);
});

test('flagged verified result shows reversal instead of presenting the old award as fresh earnings', () => {
	const { context, element } = client();
	context.showResultCoins({ awarded: 10, reversed: 10, flagged: true, balance: 0, held: 0, issuanceEnabled: true });
	assert.match(element('resultCoins').textContent, /Balance adjusted.*Coins 0/);
	assert.doesNotMatch(element('resultCoins').textContent, /\+10/);
});
