const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function player() {
	const stored = new Map();
	const context = vm.createContext({
		localStorage: { getItem: key => stored.get(key) || null, setItem: (key, value) => stored.set(key, value) },
		window: {}, navigator: {},
		settings: { platform: 'mobile' }, trueCanvas: { width: 390 },
		init() {}
	});
	for (const file of ['identity', 'player', 'feedback']) vm.runInContext(readFileSync(path.join(__dirname, '../js', file + '.js'), 'utf8'), context);
	return { context, stored };
}

function run(overrides = {}) {
	return { runRecorded: false, clearedBlocks: 9, bestCombo: 3, comboClock: 60 * 83 + 20, ...overrides };
}

test('player hub starts with actual empty data, quiet audio, and independent storage keys', () => {
	const { context, stored } = player();
	stored.set('highscores', '[999999]');
	stored.set('hexaRush.practice.highscores.v1', '[18]');
	assert.deepEqual(JSON.parse(JSON.stringify(context.readPlayerRecords())), { runs: 0, cleared: 0, bestCombo: 0, longestSeconds: 0, history: [] });
	assert.equal(context.readPlayerPreferences().sound, false);
	assert.equal(context.readPlayerPreferences().haptics, false);
	assert.equal(context.readPlayerPreferences().music, 'off');
	assert.equal(context.readPlayerPreferences().tutorialSeen, false);
	assert.equal(context.playerStorageKey, 'hexaRush.practice.player.v1');
	assert.equal(context.preferencesStorageKey, 'hexaRush.preferences.v1');
});

test('completed run is recorded exactly once, including fractional scores and unpaused duration', () => {
	const { context, stored } = player();
	const hex = run();
	const record = context.completePracticeRun(hex, 70.5);
	assert.equal(record.seconds, 83);
	assert.equal(record.score, 70.5);
	assert.equal(record.cleared, 9);
	assert.equal(record.combo, 3);
	assert.equal(context.completePracticeRun(hex, 999), null);
	assert.equal(context.playerRecords.runs, 1);
	assert.equal(context.playerRecords.cleared, 9);
	assert.equal(context.playerRecords.history.length, 1);
	const saved = JSON.parse(stored.get(context.playerStorageKey));
	assert.equal(saved.history[0].score, 70.5);
	assert.equal(context.readPlayerRecords().bestCombo, 3);
	assert.equal(saved.coins, undefined);
	assert.equal(saved.officialScore, undefined);
});

test('history retains the last twenty runs while lifetime totals keep all completions', () => {
	const { context } = player();
	for (let i = 0; i < 25; i++) context.completePracticeRun(run({ comboClock: i * 60, clearedBlocks: 3, bestCombo: i + 1 }), i * 10);
	assert.equal(context.playerRecords.runs, 25);
	assert.equal(context.playerRecords.cleared, 75);
	assert.equal(context.playerRecords.longestSeconds, 24);
	assert.equal(context.playerRecords.bestCombo, 25);
	assert.equal(context.playerRecords.history.length, 20);
	assert.equal(context.playerRecords.history[0].score, 240);
	assert.equal(context.playerRecords.history[19].score, 50);
});

test('malformed records reset safely and persisted entries are reduced to known fields', () => {
	const { context, stored } = player();
	for (const invalid of ['{bad', 'null', '[]', '{"history":[]}', JSON.stringify({ runs: -1, cleared: 1, bestCombo: 1, longestSeconds: 1, history: [] })]) {
		stored.set(context.playerStorageKey, invalid);
		assert.equal(context.readPlayerRecords().runs, 0);
	}
	context.completePracticeRun(run(), 10);
	const valid = JSON.parse(stored.get(context.playerStorageKey));
	for (const badRun of [{ ...valid.history[0], score: '999' }, { ...valid.history[0], seconds: -1 }, { ...valid.history[0], endedAt: 9e15 }, null]) {
		stored.set(context.playerStorageKey, JSON.stringify({ ...valid, history: [badRun] }));
		assert.equal(context.readPlayerRecords().history.length, 0);
	}
	stored.set(context.playerStorageKey, JSON.stringify({ ...valid, coins: 999, history: [{ ...valid.history[0], html: '<script>' }] }));
	const normalized = context.readPlayerRecords();
	assert.equal(normalized.coins, undefined);
	assert.equal(normalized.history[0].html, undefined);
});

test('blocked storage keeps runs in memory and preference parsing accepts only booleans', () => {
	const { context, stored } = player();
	stored.set(context.preferencesStorageKey, '{"sound":true,"haptics":false}');
	assert.equal(context.readPlayerPreferences().sound, true);
	assert.equal(context.readPlayerPreferences().haptics, false);
	stored.set(context.preferencesStorageKey, '{"sound":"true","haptics":"false"}');
	assert.equal(context.readPlayerPreferences().sound, false);
	assert.equal(context.readPlayerPreferences().haptics, false);
	context.localStorage = { getItem() { throw Error('denied'); }, setItem() { throw Error('full'); } };
	assert.equal(context.readPlayerRecords().runs, 0);
	assert.doesNotThrow(() => context.completePracticeRun(run(), 10));
	assert.equal(context.storageUnavailable, true);
	assert.equal(context.playerRecords.runs, 1);
	assert.equal(context.playerRecords.history[0].score, 10);
});

test('duration formatting works for zero, seconds, minutes, and long runs', () => {
	const { context } = player();
	for (const [seconds, expected] of [[0, '0:00'], [8, '0:08'], [83, '1:23'], [3661, '61:01']]) assert.equal(context.formatRunTime(seconds), expected);
});

test('feedback starts silent, honors preferences, and tolerates missing or broken audio/haptics', () => {
	const { context } = player();
	let audioCalls = 0;
	let vibrations = 0;
	context.window.AudioContext = function() { audioCalls++; throw Error('unavailable'); };
	context.navigator.vibrate = () => vibrations++;
	context.unlockGameAudio();
	assert.equal(audioCalls, 0);
	context.gameFeedback('rotate');
	context.gameFeedback('clear');
	assert.equal(vibrations, 0);
	context.playerPreferences.haptics = true;
	context.gameFeedback('clear');
	assert.equal(vibrations, 1);
	context.playerPreferences.haptics = false;
	context.gameFeedback('clear');
	assert.equal(vibrations, 1);
	context.playerPreferences.sound = true;
	assert.doesNotThrow(() => context.unlockGameAudio());
	assert.equal(context.audioUnavailable, true);
	assert.doesNotThrow(() => context.gameFeedback('clear'));
});

test('audio synthesizes short bounded cues after user activation without remote assets', () => {
	const { context } = player();
	const stops = [];
	const frequencies = [];
	context.playerPreferences = { sound: true, haptics: false };
	context.window.AudioContext = function() {
		this.state = 'running';
		this.currentTime = 10;
		this.destination = {};
		this.createOscillator = () => ({ frequency: { setValueAtTime(value) { frequencies.push(value); } }, connect() {}, disconnect() {}, start() {}, stop(time) { stops.push(time); } });
		this.createGain = () => ({ gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} });
	};
	context.unlockGameAudio();
	context.gameFeedback('rotate');
	assert.deepEqual(frequencies, [240]);
	assert.ok(stops[0] <= 10.15);
	context.playerPreferences.sound = false;
	context.gameFeedback('clear', 5);
	assert.equal(stops.length, 1);
});

test('Telegram haptics require a supported SDK version and remain optional', () => {
	const { context } = player();
	context.playerPreferences.haptics = true;
	const events = [];
	context.window.Telegram = { WebApp: {
		isVersionAtLeast: version => version === '6.1',
		HapticFeedback: { impactOccurred: kind => events.push(kind), notificationOccurred: kind => events.push(kind) }
	} };
	context.gameFeedback('rotate');
	context.gameFeedback('clear', 2);
	context.gameFeedback('end');
	assert.deepEqual(events, ['light', 'medium', 'warning']);
	context.playerPreferences.haptics = false;
	context.gameFeedback('rotate');
	context.gameFeedback('clear', 1);
	assert.equal(events.length, 3);
	context.playerPreferences.haptics = true;
	context.window.Telegram.WebApp.isVersionAtLeast = () => false;
	context.gameFeedback('rotate');
	assert.equal(events.length, 3);
	context.window.Telegram.WebApp.isVersionAtLeast = () => true;
	context.window.Telegram.WebApp.HapticFeedback.impactOccurred = () => { throw Error('Unsupported'); };
	assert.doesNotThrow(() => context.gameFeedback('rotate'));
});

test('first-run tutorial reacts to rotations and clears, persists once, and ignores paused time', () => {
	const { context: p, stored } = player();
	const tip = { hidden: true }, label = { textContent: '' };
	p.document = { getElementById: id => id === 'tutorialTip' ? tip : label };
	p.gameState = 1; p.gameTicks = 0;
	p.MainHex = { lastRotate: -5, clearedBlocks: 0 };
	p.startFirstRunTutorial();
	assert.equal(tip.hidden, false);
	assert.match(label.textContent, /rotate/);
	assert.equal(JSON.parse(stored.get(p.preferencesStorageKey)).tutorialSeen, true);
	p.MainHex.lastRotate = 0; p.updateFirstRunTutorial();
	assert.equal(label.textContent, 'Match 3 of the same color');
	p.gameState = -1; p.updateFirstRunTutorial();
	assert.equal(tip.hidden, true);
	assert.equal(p.tutorialActive, true);
	p.gameState = 1; p.MainHex.clearedBlocks = 3; p.updateFirstRunTutorial();
	assert.match(label.textContent, /Nice!/);
	p.gameTicks = 180; p.updateFirstRunTutorial();
	assert.equal(tip.hidden, true);
	p.startFirstRunTutorial();
	assert.equal(p.tutorialActive, false, 'later runs never repeat the guide');
	p.playerPreferences = p.readPlayerPreferences();
	assert.equal(p.playerPreferences.tutorialSeen, true, 'reload preserves dismissal');
});

test('tutorial times out without input and stays dismissed during storage failure for this visit', () => {
	const { context: p } = player();
	p.document = { getElementById: () => ({ hidden: true, textContent: '' }) };
	p.gameState = 1; p.gameTicks = 0; p.MainHex = { lastRotate: -5, clearedBlocks: 0 };
	p.localStorage.setItem = () => { throw Error('blocked'); };
	p.startFirstRunTutorial();
	assert.equal(p.storageUnavailable, true);
	p.gameTicks = 1080; p.updateFirstRunTutorial();
	assert.equal(p.tutorialActive, false);
	p.startFirstRunTutorial();
	assert.equal(p.tutorialActive, false);
});
