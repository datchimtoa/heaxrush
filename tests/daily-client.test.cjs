const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function data(day = '2026-10-13') {
	const start = Date.parse(day + 'T00:00:00Z');
	return { rulesVersion: 'hexa-rush-v1', rewardsEnabled: false, timezone: 'UTC', day, startsAt: new Date(start).toISOString(),
		endsAt: new Date(start + 86400000).toISOString(), serverTime: new Date(start + 43200000).toISOString(),
		quests: [3, 800, 3].map((target, i) => ({ code: ['play_3', 'score_800', 'combo_3'][i], title: ['Find your flow', 'Aim higher', 'Keep the chain'][i],
			description: 'Server progress only', metric: ['games', 'score', 'chain'][i], target, progress: [2, 799.5, 3][i], reached: i === 2 })),
		streak: { days: 5, lastLaunchDay: day, checkedInToday: true } };
}

function client() {
	const elements = new Map(), requests = [], timers = new Map(), events = {}, buttons = ['daily', 'achievements'].map(section => ({
		dataset: { tasksSection: section }, setAttribute(k, v) { this[k] = v; }, addEventListener(k, handler) { this[k] = handler; }
	}));
	let nextTimer = 0, elapsed = 0;
	function node() { return { children: [], text: '', appendChild(child) { this.children.push(child); }, setAttribute(k, v) { this[k] = v; },
		get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }, set textContent(value) { this.text = value; this.children = []; } }; }
	function element(id) { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); }
	const context = vm.createContext({ AbortSignal, gameState: 0, highscores: [0], score: 54, gameTicks: 123,
		performance: { now: () => elapsed }, setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; }, clearTimeout(id) { timers.delete(id); },
		localStorage: { getItem() { throw Error('Practice must not enter daily progress'); }, setItem() { throw Error('Progress must not be stored'); } },
		document: { hidden: false, createElement: node, getElementById: element, querySelectorAll: () => buttons, addEventListener(k, fn) { events[k] = fn; } },
		$(selector) { const chain = { prop(k, v) { for (const id of selector.split(', ')) element(id.slice(1))[k] = v; return chain; },
			text(v) { for (const id of selector.split(', ')) element(id.slice(1)).textContent = v; return chain; }, empty() { element(selector.slice(1)).textContent = ''; return chain; }, on() { return chain; } }; return chain; },
		fetch: async (url, options) => { requests.push({ url, options }); return { ok: true, json: async () => data() }; }
	});
	for (const file of ['session-rules', 'player', 'achievements', 'daily']) vm.runInContext(readFileSync(path.join(__dirname, '../js', file + '.js'), 'utf8'), context);
	context.playerAccount = { state: 'connected', user: { id: 'owner' } }; context.activeHomeTab = 'tasks'; context.renderAccountStatus = () => {};
	return { context, requests, element, timers, buttons, events, elapse(ms) { elapsed += ms; } };
}

test('daily guest/connecting/error states clear all progress and streaks, never fetch or invent zeros', async () => {
	const f = client();
	for (const state of ['guest', 'connecting', 'error']) {
		f.context.setPlayerAccount(state); await f.context.loadDailyProgress();
		assert.equal(f.element('dailyEntries').children.length, 0); assert.equal(f.element('dailyStreak').hidden, true); assert.equal(f.element('dailyRefresh').hidden, true);
	}
	assert.equal(f.requests.length, 0); assert.equal(f.timers.size, 0); assert.match(f.element('dailyStatus').textContent, /Profile/);
});

test('daily transport uses read-only cookies/no-store and accessible safe-text progress, leaving scoring, records and Coins alone', async () => {
	const f = client(); await f.context.loadDailyProgress();
	const req = f.requests[0]; assert.equal(req.url, '/api/daily'); assert.equal(req.options.credentials, 'same-origin'); assert.equal(req.options.cache, 'no-store'); assert.equal(req.options.body, undefined);
	const rows = f.element('dailyEntries').children; assert.equal(rows.length, 3); assert.match(rows[0].textContent, /2 \/ 3 games/);
	assert.match(rows[1].textContent, /799.5 \/ 800 points/); assert.match(rows[2].className, /achievement-reached/);
	assert.equal(rows[0].children[2]['aria-label'], 'Find your flow progress'); assert.equal(rows[0].children[2].max, 3);
	assert.match(f.element('dailyDay').textContent, /2026-10-13.*00:00 UTC/); assert.equal(f.element('dailyStreakCount').textContent, '5 days');
	assert.match(f.element('dailyStreakDetail').textContent, /on a roll/); assert.equal(f.element('dailyStatus').hidden, true);
	assert.equal(f.context.score, 54); assert.equal(f.context.gameTicks, 123); assert.equal(f.context.playerAccount.user.coinBalance, undefined);
	const response = data(); response.quests[0].title = '<img src=x>'; response.quests[0].description = '<b>safe text</b>';
	f.context.fetch = async () => ({ ok: true, json: async () => response }); await f.context.loadDailyProgress();
	assert.match(f.element('dailyEntries').textContent, /<img src=x>.*<b>safe text<\/b>/);
	assert.doesNotMatch(readFileSync(path.join(__dirname, '../js/daily.js'), 'utf8'), /localStorage|innerHTML|\.html\(|method:.*POST|Date\.now/);
});

test('streak labels explain first launch, pending today, missed-day reset and singular days without promising rewards', async () => {
	const f = client();
	for (const [streak, label] of [
		[{ days: 0, lastLaunchDay: null, checkedInToday: false }, /start a streak/],
		[{ days: 0, lastLaunchDay: '2026-10-11', checkedInToday: false }, /start a streak/],
		[{ days: 5, lastLaunchDay: '2026-10-12', checkedInToday: false }, /Keep your streak alive/],
		[{ days: 1, lastLaunchDay: '2026-10-13', checkedInToday: true }, /on a roll/]
	]) {
		const d = data(); d.streak = streak; f.context.fetch = async () => ({ ok: true, json: async () => d }); await f.context.loadDailyProgress();
		assert.match(f.element('dailyStreakDetail').textContent, label); assert.equal(f.element('dailyStreakCount').textContent, streak.days + (streak.days === 1 ? ' day' : ' days'));
	}
});

test('UTC reset is scheduled from server time minus request latency, clears progress and loads the next day', async () => {
	const f = client(); const d = data(); d.serverTime = '2026-10-13T23:59:58.000Z';
	f.context.fetch = async () => { f.elapse(500); return { ok: true, json: async () => d }; }; await f.context.loadDailyProgress();
	assert.equal(f.timers.size, 1); const timer = [...f.timers.values()][0]; assert.equal(timer.delay, 1600);
	f.context.fetch = async () => ({ ok: true, json: async () => data('2026-10-14') }); timer.fn();
	assert.equal(f.element('dailyEntries').children.length, 0); await new Promise(resolve => setImmediate(resolve));
	assert.match(f.element('dailyDay').textContent, /2026-10-14/); assert.equal(f.timers.size, 1);
	f.context.fetch = async () => { f.elapse(3000); return { ok: true, json: async () => d }; }; await f.context.loadDailyProgress();
	assert.equal(f.element('dailyEntries').children.length, 0); assert.match(f.element('dailyStatus').textContent, /fresh set of quests/); assert.equal(f.timers.size, 0);
});

test('account changes, section switches and hidden documents invalidate stale daily results and clear reset timers', async () => {
	const f = client(); f.context.initializeDaily(); let release;
	f.context.fetch = async () => new Promise(resolve => { release = () => resolve({ ok: true, json: async () => data() }); });
	const pending = f.context.loadDailyProgress(); f.context.setPlayerAccount('guest'); release(); await pending;
	assert.equal(f.element('dailyEntries').children.length, 0); assert.equal(f.element('dailyStreakCount').textContent, '');
	f.context.fetch = async () => ({ ok: true, json: async () => data() }); f.context.setPlayerAccount('connected', { id: 'second' });
	await new Promise(resolve => setImmediate(resolve)); assert.equal(f.element('dailyEntries').children.length, 3);
	f.context.document.hidden = true; f.events.visibilitychange(); assert.equal(f.timers.size, 0); assert.equal(f.element('dailyEntries').children.length, 0);
	f.context.document.hidden = false; f.events.visibilitychange(); await new Promise(resolve => setImmediate(resolve)); assert.equal(f.timers.size, 1);
	let achievements = 0; f.context.loadAchievements = () => { achievements++; };
	f.context.selectTasksSection('achievements'); assert.equal(achievements, 1); assert.equal(f.element('dailyPanel').hidden, true);
	assert.equal(f.element('achievementPanel').hidden, false); assert.equal(f.timers.size, 0); assert.equal(f.buttons[1]['aria-pressed'], 'true');
	f.context.selectTasksSection('invalid'); assert.equal(f.context.tasksSection, 'achievements');
	f.context.selectTasksSection('daily'); await new Promise(resolve => setImmediate(resolve)); assert.equal(f.element('dailyPanel').hidden, false);
	f.context.gameState = 1; f.context.document.hidden = true; f.events.visibilitychange(); f.context.document.hidden = false;
	f.events.visibilitychange(); assert.equal(f.timers.size, 0); assert.equal(f.context.gameTicks, 123);
});

test('rapid refresh discards old success/failure and malformed daily responses fail closed with retry', async () => {
	const f = client(); let release;
	f.context.fetch = async () => new Promise((resolve, reject) => { release = () => reject(Error('old offline')); });
	const stale = f.context.loadDailyProgress(); f.context.fetch = async () => ({ ok: true, json: async () => data() });
	await f.context.loadDailyProgress(); release(); await stale; assert.equal(f.element('dailyStatus').hidden, true);
	for (const mutate of [d => { d.rewardsEnabled = true; }, d => { d.day = 'bad'; }, d => { d.timezone = 'local'; }, d => { d.serverTime = d.endsAt; },
		d => { d.quests[0].progress = 2.5; }, d => { d.quests[1].progress = 801; }, d => { d.quests[2].reached = false; }, d => { d.quests.reverse(); },
		d => { d.streak.days = -1; }, d => { d.streak.checkedInToday = false; }, d => { d.streak.lastLaunchDay = null; }, d => { d.rulesVersion = 'old'; }]) {
		const d = data(); mutate(d); f.context.fetch = async () => ({ ok: true, json: async () => d }); await f.context.loadDailyProgress();
		assert.equal(f.element('dailyEntries').children.length, 0); assert.equal(f.element('dailyStreak').hidden, true); assert.match(f.element('dailyStatus').textContent, /retry/); assert.equal(f.timers.size, 0);
	}
	f.context.fetch = async () => ({ ok: false }); await f.context.loadDailyProgress(); assert.match(f.element('dailyStatus').textContent, /retry/);
	f.context.fetch = async () => { throw Error('offline'); }; await f.context.loadDailyProgress(); assert.equal(f.element('dailyRefresh').disabled, false);
});