const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function data(score = 750.5, chain = 4) {
	return { rulesVersion: 'hexa-rush-v1', rewardsEnabled: false, milestones: [500, 1000, 2000, 4].map((target, i) => ({
		code: ['score_500', 'score_1000', 'score_2000', 'combo_4'][i], title: 'Milestone ' + i, description: 'Verified progress',
		metric: i < 3 ? 'score' : 'chain', target, progress: Math.min(i < 3 ? score : chain, target), reached: (i < 3 ? score : chain) >= target
	})) };
}

function client() {
	const elements = new Map(), requests = [];
	function node() { return { children: [], text: '', appendChild(child) { this.children.push(child); }, setAttribute(key, value) { this[key] = value; },
		get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }, set textContent(value) { this.text = value; this.children = []; } }; }
	function element(id) { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); }
	const context = vm.createContext({ playerAccount: { state: 'connected', user: { id: 'owner' } }, AbortSignal, gameState: 0, highscores: [0],
		score: 54, gameTicks: 123, document: { createElement: node, getElementById: element },
		localStorage: { getItem() { throw Error('Practice must not enter achievements'); }, setItem() { throw Error('Progress must not be stored'); } },
		$(selector) { const chain = { prop(key, value) { for (const id of selector.split(', ')) element(id.slice(1))[key] = value; return chain; },
			text(value) { element(selector.slice(1)).textContent = value; return chain; }, empty() { element(selector.slice(1)).textContent = ''; return chain; }, on() { return chain; } }; return chain; },
		fetch: async (url, options) => { requests.push({ url, options }); return { ok: true, json: async () => data() }; }
	});
	for (const file of ['session-rules', 'player', 'achievements']) vm.runInContext(readFileSync(path.join(__dirname, '../js', file + '.js'), 'utf8'), context);
	context.playerAccount = { state: 'connected', user: { id: 'owner' } }; context.renderAccountStatus = () => {};
	return { context, element, requests };
}

test('guest/connecting/error achievements do not fetch or fabricate zero progress', async () => {
	const f = client();
	for (const state of ['guest', 'connecting', 'error']) {
		f.context.setPlayerAccount(state); await f.context.loadAchievements();
		assert.equal(f.element('achievementEntries').children.length, 0); assert.equal(f.element('achievementRefresh').hidden, true);
	}
	assert.equal(f.requests.length, 0); assert.match(f.element('achievementStatus').textContent, /Profile/);
});

test('achievement GETs are uncached and render decimal, reached, chain, and zero progress without touching game or storage', async () => {
	const f = client(); await f.context.loadAchievements();
	const request = f.requests[0]; assert.equal(request.url, '/api/achievements');
	assert.equal(request.options.credentials, 'same-origin'); assert.equal(request.options.cache, 'no-store'); assert.equal(request.options.body, undefined);
	const rows = f.element('achievementEntries').children;
	assert.equal(rows.length, 4); assert.match(rows[0].className, /achievement-reached/); assert.match(rows[1].textContent, /750.5 \/ 1,000 points/);
	assert.equal(rows[3].children[2].max, 4); assert.equal(rows[3].children[2].value, 4);
	assert.equal(rows[3].children[2]['aria-label'], 'Milestone 3 progress');
	assert.equal(f.element('achievementStatus').hidden, true); assert.equal(f.element('achievementRefresh').disabled, false);
	f.context.fetch = async () => ({ ok: true, json: async () => data(0, 0) }); await f.context.loadAchievements();
	assert.ok(f.element('achievementEntries').children.every(row => !row.className.includes('achievement-reached')));
	assert.equal(f.context.score, 54); assert.equal(f.context.gameTicks, 123);
});

test('achievement titles/descriptions use safe text, never HTML or claim controls', async () => {
	const f = client(), response = data(); response.milestones[0].title = '<img src=x onerror=alert(1)>'; response.milestones[0].description = '<b>safe text</b>';
	f.context.fetch = async () => ({ ok: true, json: async () => response }); await f.context.loadAchievements();
	assert.match(f.element('achievementEntries').textContent, /<img src=x onerror=alert\(1\)>.*<b>safe text<\/b>/);
	assert.doesNotMatch(readFileSync(path.join(__dirname, '../js/achievements.js'), 'utf8'), /innerHTML|\.html\(|localStorage|method:.*POST/);
});

test('account changes clear progress, discard stale successes/failures and reload only when Tasks is visible', async () => {
	const f = client(); let release;
	f.context.fetch = async () => new Promise(resolve => { release = () => resolve({ ok: true, json: async () => data(2000, 4) }); });
	const pending = f.context.loadAchievements(); f.context.setPlayerAccount('connected', { id: 'second' }); release(); await pending;
	assert.equal(f.element('achievementEntries').children.length, 0);
	f.context.activeHomeTab = 'tasks'; f.context.fetch = async () => ({ ok: true, json: async () => data(18, 1) });
	f.context.setPlayerAccount('connected', { id: 'third' }); await new Promise(resolve => setImmediate(resolve));
	assert.match(f.element('achievementEntries').textContent, /18 \/ 500/);
	f.context.fetch = async () => new Promise((resolve, reject) => { release = () => reject(Error('old account offline')); });
	const staleFailure = f.context.loadAchievements(); f.context.setPlayerAccount('guest'); release(); await staleFailure;
	assert.match(f.element('achievementStatus').textContent, /Telegram/); assert.doesNotMatch(f.element('achievementStatus').textContent, /unavailable/);
});

test('rapid refresh ignores older progress; malformed/error data fail closed with a usable retry', async () => {
	const f = client(); let release;
	f.context.fetch = async () => new Promise(resolve => { release = () => resolve({ ok: true, json: async () => data(2000) }); });
	const pending = f.context.loadAchievements(); f.context.fetch = async () => ({ ok: true, json: async () => data(50, 1) });
	await f.context.loadAchievements(); release(); await pending; assert.match(f.element('achievementEntries').textContent, /50 \/ 500/);
	for (const mutate of [d => { d.rewardsEnabled = true; }, d => { d.rulesVersion = 'old'; }, d => { d.milestones.pop(); },
		d => { d.milestones[0].progress = -1; }, d => { d.milestones[0].reached = false; }, d => { d.milestones[0].target = 1; },
		d => { d.milestones[3].progress = 2.5; }, d => { d.milestones[0].title = null; }, d => { d.milestones.reverse(); }]) {
		const invalid = data(); mutate(invalid); f.context.fetch = async () => ({ ok: true, json: async () => invalid });
		await f.context.loadAchievements(); assert.equal(f.element('achievementEntries').children.length, 0); assert.match(f.element('achievementStatus').textContent, /retry/);
	}
	f.context.fetch = async () => ({ ok: false }); await f.context.loadAchievements(); assert.match(f.element('achievementStatus').textContent, /retry/);
	f.context.fetch = async () => { throw Error('offline'); }; await f.context.loadAchievements(); assert.equal(f.element('achievementRefresh').disabled, false);
});