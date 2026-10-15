const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function navigation() {
	const tabs = ['home', 'leaderboards', 'profile', 'tasks', 'referrals', 'wallet', 'activity', 'settings', 'coins'];
	const animations = [];
	const panels = tabs.map(tab => {
		const surface = { animations: [], getAnimations() { return this.animations; }, animate(frames, options) {
			const animation = { tab, frames, options, canceled: false, cancel() { this.canceled = true; } };
			this.animations = [animation]; animations.push(animation);
		} };
		return { dataset: { homePanel: tab }, hidden: tab !== 'home', scrollTop: 42, querySelector: () => surface, surface };
	});
	const buttons = ['home', 'tasks', 'referrals', 'wallet', 'profile'].map(tab => ({ dataset: { homeTab: tab }, attributes: {}, setAttribute(key, value) { this.attributes[key] = value; }, removeAttribute(key) { delete this.attributes[key]; } }));
	let focus = null, loads = 0;
	const headings = Object.fromEntries(tabs.map(tab => [tab, { focus() { focus = tab; } }]));
	const elements = { coinBack: { dataset: {}, textContent: '' }, aboutGame: { open: true }, startBtn: { focus() { focus = 'play'; } } };
	const context = vm.createContext({
		gameState: 0,
		window: { matchMedia: () => ({ matches: false }) },
		document: {
			getElementById: id => elements[id],
			querySelectorAll(selector) {
				if (selector === '[data-home-panel]') return panels;
				if (selector === '#appNavigation [data-home-tab]') return buttons;
				if (selector === '.game-menu-screen') return panels.slice(1);
				throw Error('Unexpected selector: ' + selector);
			},
			querySelector(selector) { return headings[selector.match(/data-home-panel="([^"]+)"/)[1]]; }
		},
		loadCoinHistory() { loads++; }
	});
	vm.runInContext(readFileSync(path.join(__dirname, '../js/player.js'), 'utf8'), context);
	context.renderPlayerHub = () => {};
	return { context, panels, buttons, elements, animations, focused: () => focus, loads: () => loads,
		selected: () => buttons.filter(button => button.attributes['aria-current'] === 'page').map(button => button.dataset.homeTab) };
}

test('five destinations select one visible panel/current navigation item without advancing gameplay or loading rewards', () => {
	const f = navigation();
	for (const tab of ['home', 'tasks', 'referrals', 'wallet', 'profile']) {
		f.context.showHomeTab(tab, true);
		assert.equal(f.context.activeHomeTab, tab); assert.deepEqual(f.selected(), [tab]);
		assert.deepEqual(f.panels.filter(panel => !panel.hidden).map(panel => panel.dataset.homePanel), [tab]);
		assert.equal(f.focused(), tab); assert.equal(f.context.gameState, 0); assert.equal(f.loads(), 0);
	}
});

test('Referrals loads only on its menu and leaving invalidates stale progress without creating invites', () => {
	const f = navigation(); let loads = 0, resets = 0;
	f.context.loadReferrals = create => { assert.equal(create, false); loads++; };
	f.context.resetReferralDisplay = () => { resets++; };
	f.context.showHomeTab('referrals', true); assert.equal(loads, 1); assert.equal(resets, 0);
	f.context.showHomeTab('home', false); assert.equal(resets, 1);
	f.context.gameState = 1; f.context.showHomeTab('referrals', true); assert.equal(loads, 1);
});

test('Options and personal records belong to Profile; Leaderboards belongs to Home', () => {
	const f = navigation();
	for (const tab of ['settings', 'activity']) {
		f.context.showHomeTab(tab, true); assert.deepEqual(f.selected(), ['profile']);
		f.context.goBackHomeTab(); assert.equal(f.context.activeHomeTab, 'profile'); assert.equal(f.focused(), 'profile');
		f.context.goBackHomeTab(); assert.equal(f.context.activeHomeTab, 'home'); assert.equal(f.focused(), 'play');
	}
	f.context.showHomeTab('leaderboards', true); assert.deepEqual(f.selected(), ['home']);
	f.context.goBackHomeTab(); assert.equal(f.context.activeHomeTab, 'home');
});

test('Tasks loads read-only achievements only on the menu, keeps Tasks selected and Back returns to Home', () => {
	const f = navigation(); let loads = 0;
	f.context.loadAchievements = () => { loads++; };
	f.context.showHomeTab('tasks', true); assert.equal(loads, 1); assert.deepEqual(f.selected(), ['tasks']);
	f.context.goBackHomeTab(); assert.equal(f.context.activeHomeTab, 'home'); assert.equal(f.focused(), 'play');
	f.context.gameState = 1; f.context.showHomeTab('tasks', true); assert.equal(loads, 1);
});

test('Tasks prefers its selected progress section and leaving the screen invalidates daily timers/results', () => {
	const f = navigation(); let reads = 0, resets = 0, achievementReads = 0;
	f.context.loadTasksProgress = () => { reads++; };
	f.context.loadAchievements = () => { achievementReads++; };
	f.context.resetDailyDisplay = () => { resets++; };
	f.context.showHomeTab('tasks', true); assert.equal(reads, 1); assert.equal(achievementReads, 0);
	f.context.showHomeTab('profile', true); assert.equal(resets, 1);
	f.context.showHomeTab('tasks', true); assert.equal(reads, 2);
	f.context.goBackHomeTab(); assert.equal(resets, 2); assert.equal(f.context.activeHomeTab, 'home');
	f.context.gameState = 1; f.context.showHomeTab('tasks', true); assert.equal(reads, 2);
});

test('Coins keeps its actual launch parent for Back and selected bottom destination', () => {
	const f = navigation();
	for (const [parent, selected, label] of [['settings', 'profile', 'Options'], ['wallet', 'wallet', 'Wallet'], ['profile', 'profile', 'Profile']]) {
		f.context.showHomeTab(parent, true); f.context.showHomeTab('coins', true);
		assert.deepEqual(f.selected(), [selected]); assert.equal(f.elements.coinBack.dataset.homeTab, parent);
		assert.equal(f.elements.coinBack.textContent, '← ' + label);
		f.context.goBackHomeTab(); assert.equal(f.context.activeHomeTab, parent);
	}
	assert.equal(f.loads(), 3);
});

test('verified standings load only when opening Leaderboards and keep Home as their parent', () => {
	const f = navigation(); let reads = 0;
	f.context.loadLeaderboard = () => { reads++; };
	for (const tab of ['profile', 'tasks', 'referrals', 'wallet', 'home']) f.context.showHomeTab(tab, true);
	assert.equal(reads, 0);
	f.context.showHomeTab('leaderboards', true);
	assert.equal(reads, 1); assert.deepEqual(f.selected(), ['home']); assert.equal(f.focused(), 'leaderboards');
	f.context.goBackHomeTab(); assert.equal(f.context.activeHomeTab, 'home'); assert.equal(reads, 1);
	f.context.gameState = 1; f.context.showHomeTab('leaderboards', true); assert.equal(reads, 1);
});

test('navigation rejects unknown screens and cannot switch tabs during play, pause or results', () => {
	const f = navigation();
	f.context.showHomeTab('withdraw', true); assert.equal(f.context.activeHomeTab, 'home');
	for (const state of [1, -1, 2]) {
		f.context.gameState = state; f.context.showHomeTab('wallet', true);
		assert.equal(f.context.activeHomeTab, 'home'); assert.equal(f.loads(), 0);
	}
});

test('panel transitions are short, canceled on rapid switches and never defer visibility or mutate gameplay', () => {
	const f = navigation();
	f.context.score = 54; f.context.gameTicks = 123;
	const records = JSON.stringify(f.context.playerRecords);
	f.context.showHomeTab('tasks', true);
	assert.equal(f.animations.length, 1);
	assert.equal(f.animations[0].tab, 'tasks');
	assert.equal(f.animations[0].options.duration, 180);
	assert.equal(f.animations[0].options.fill, undefined, 'no retained transformed/transparent layer');
	assert.equal(f.animations[0].frames[0].transform, 'translateY(8px)');
	f.context.showHomeTab('profile', true);
	assert.equal(f.animations[0].canceled, true);
	assert.equal(f.animations.length, 2);
	assert.deepEqual(f.panels.filter(panel => !panel.hidden).map(panel => panel.dataset.homePanel), ['profile']);
	f.context.showHomeTab('profile', true);
	assert.equal(f.animations.length, 2, 'tapping the current page does not restart animation');
	f.context.showHomeTab('home', true);
	assert.ok(f.animations.at(-1).frames.every(frame => !frame.transform), 'Home fades without moving Play targets');
	assert.equal(f.context.score, 54); assert.equal(f.context.gameTicks, 123);
	assert.equal(JSON.stringify(f.context.playerRecords), records);
	assert.equal(f.loads(), 0);
});

test('reduced motion, hidden documents and missing animation API keep navigation immediate and static', () => {
	const f = navigation();
	f.context.showHomeTab('tasks', true);
	f.context.window.matchMedia = () => ({ matches: true });
	f.context.showHomeTab('wallet', true);
	assert.equal(f.animations[0].canceled, true);
	assert.equal(f.animations.length, 1);
	assert.equal(f.focused(), 'wallet');
	f.context.window.matchMedia = () => ({ matches: false }); f.context.document.hidden = true;
	f.context.showHomeTab('profile', true);
	assert.equal(f.animations.length, 1);
	f.context.document.hidden = false;
	f.panels.forEach(panel => { panel.surface.animate = undefined; });
	assert.doesNotThrow(() => f.context.showHomeTab('home', true));
	assert.equal(f.context.activeHomeTab, 'home');
});

test('markup moves Options to Profile, preserves device records and never labels practice as a global ranking', () => {
	const html = readFileSync(path.join(__dirname, '../index.html'), 'utf8');
	const section = tab => html.match(new RegExp('<section data-home-panel="' + tab + '"[\\s\\S]*?<\\/section>'))[0];
	assert.match(section('home'), /id="openLeaderboards"[^>]*>Leaderboards/);
	assert.doesNotMatch(section('home'), /Options|Records|data-home-tab="settings"/);
	assert.match(section('profile'), /id="openSettings"/);
	assert.match(section('profile'), /id="profileConnection"/);
	assert.match(section('activity'), /id="runHistory"/); assert.match(section('activity'), /Practice games stay on this device/);
	assert.doesNotMatch(section('leaderboards'), /id="runHistory"/); assert.match(section('leaderboards'), /id="leaderboardEntries"/);
	assert.doesNotMatch(section('leaderboards'), /local-disclosure|Flagged runs|blocked accounts|Player labels|My practice records/);
	assert.match(section('leaderboards'), /class="leaderboard-periods"/);
	assert.match(section('wallet'), /isn't available/);
	assert.match(section('referrals'), /id="referralCreate"/);
	assert.match(section('referrals'), /Referral rewards are not active/);
	assert.doesNotMatch(section('referrals'), /Claim|data-home-tab="coins"/);
	assert.match(section('tasks'), /id="achievementEntries"/); assert.match(section('tasks'), /Coin rewards are not active/);
	assert.match(section('tasks'), /data-tasks-section="daily"/); assert.match(section('tasks'), /id="dailyEntries"/);
	assert.match(section('tasks'), /Quest and streak rewards are not active/); assert.doesNotMatch(section('tasks'), /Claim|data-home-tab="coins"/);
	assert.match(section('settings'), /href="credits.html"/);
	const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
	assert.equal(new Set(ids).size, ids.length, 'no duplicate identity/menu IDs');
});