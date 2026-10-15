const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function presentation() {
	let now = 1000;
	let reduced = false;
	let nextTimer = 0;
	const timers = new Map();
	const storage = new Map();
	const voices = [];
	const animations = [];
	const callout = { hidden: true, getAnimations: () => [], animate: (frames, options) => animations.push({ frames, options }) };
	const audio = {
		state: 'running', currentTime: 10, destination: {},
		createGain: () => ({ gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} }, connect() {}, disconnect() {} }),
		createOscillator: () => {
			const voice = { frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {}, start(time) { this.startTime = time; }, stop(time) { this.stopTime = time; this.stopped = true; } };
			voices.push(voice); return voice;
		},
		resume() { this.state = 'running'; return Promise.resolve(); }
	};
	const context = vm.createContext({
		window: { matchMedia: () => ({ get matches() { return reduced; } }), AudioContext: function() { return audio; } },
		document: { hidden: false, getElementById: id => id === 'clearCallout' ? callout : null },
		navigator: {}, performance: { now: () => now },
		localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
		setInterval(callback) { timers.set(++nextTimer, callback); return nextTimer; }, clearInterval(id) { timers.delete(id); },
		gameState: 0, score: 18, settings: { scale: 0.65, hexWidth: 60 }, trueCanvas: { width: 390, height: 844 },
		gameRandom() { throw Error('Presentation must not consume gameplay RNG'); },
		ctx: new Proxy({}, { get: (target, key) => key.startsWith('create') ? () => ({ addColorStop() {} }) : () => {} }),
		drawPolygon() {}, rotatePoint: (x, y) => ({ x, y })
	});
	for (const file of ['player', 'feedback', 'music', 'effects', 'Text']) vm.runInContext(readFileSync(path.join(__dirname, '../js', file + '.js'), 'utf8'), context);
	context.MainHex = { angle: 30, ct: 60, comboClock: 60, clearedBlocks: 3, blocks: [[{ deleted: 1, opacity: 1, targetAngle: 60, distFromHex: 80, height: 20, color: '#9b59b6' }]] };
	return { context, audio, voices, timers, storage, callout, animations, setNow: value => { now = value; }, setReduced: value => { reduced = value; } };
}

test('old preferences preserve sound/haptics and music defaults quiet; invalid music/volume are rejected', () => {
	const { context: p, storage } = presentation();
	storage.set(p.preferencesStorageKey, JSON.stringify({ sound: true, haptics: false }));
	assert.deepEqual(JSON.parse(JSON.stringify(p.readPlayerPreferences())), { sound: true, haptics: false, music: 'off', musicVolume: 0.35, tutorialSeen: false });
	for (const musicVolume of ['0.5', -1, 2, null]) {
		storage.set(p.preferencesStorageKey, JSON.stringify({ music: 'unknown', musicVolume }));
		assert.equal(p.readPlayerPreferences().music, 'off');
		assert.equal(p.readPlayerPreferences().musicVolume, 0.35);
	}
	for (const music of ['off', 'chill', 'rock']) for (const musicVolume of [0, 0.45, 1]) {
		storage.set(p.preferencesStorageKey, JSON.stringify({ music, musicVolume }));
		assert.equal(p.readPlayerPreferences().music, music);
		assert.equal(p.readPlayerPreferences().musicVolume, musicVolume);
	}
});

test('music is opt-in, needs unlocked audio, and never plays in menus or hidden tabs', () => {
	const { context: p, voices, timers } = presentation();
	p.gameState = 1; p.syncGameMusic();
	assert.equal(p.gameAudio, null); assert.equal(timers.size, 0);
	p.playerPreferences.music = 'chill'; p.syncGameMusic();
	assert.equal(voices.length, 0, 'saved preference alone cannot autoplay');
	p.gameState = 0; p.unlockGameAudio(); p.syncGameMusic();
	assert.equal(voices.length, 0, 'selecting music in Options stays silent');
	p.gameState = 1; p.syncGameMusic();
	assert.equal(timers.size, 1); assert.ok(voices.length > 0);
	for (const state of [-1, 0, 2]) {
		p.gameState = state; p.syncGameMusic();
		assert.equal(timers.size, 0); assert.equal(p.musicVoices.size, 0);
		p.gameState = 1; p.syncGameMusic();
	}
	p.document.hidden = true;
	for (const callback of [...timers.values()]) callback();
	assert.equal(timers.size, 0); assert.equal(p.musicVoices.size, 0);
});

test('both synthesized styles schedule bounded notes and switching/muting stops the previous voices', () => {
	const { context: p, voices, audio, timers } = presentation();
	p.playerPreferences.music = 'chill'; p.unlockGameAudio(); p.gameState = 1; p.syncGameMusic();
	const first = [...p.musicVoices];
	assert.equal(p.musicStyle, 'chill');
	p.playerPreferences.music = 'rock'; p.syncGameMusic();
	assert.equal(p.musicStyle, 'rock'); assert.equal(timers.size, 1);
	assert.ok(first.every(voice => voice.stopped));
	const before = voices.length;
	audio.currentTime = 1000;
	for (const callback of [...timers.values()]) callback();
	assert.ok(voices.length - before < 10, 'throttled audio does not catch up old beats');
	assert.ok(voices.slice(before).every(voice => voice.startTime >= 1000 && voice.stopTime < 1002));
	for (const voice of [...p.musicVoices]) voice.onended();
	assert.equal(p.musicVoices.size, 0, 'ended oscillators are disconnected and released');
	p.playerPreferences.musicVolume = 0; p.syncGameMusic();
	assert.equal(timers.size, 0);
	assert.equal(p.playerPreferences.sound, false, 'music and sound effects are independent');
});

test('music resumes after audio activation and audio failures never interrupt gameplay', async () => {
	const { context: p, audio, timers } = presentation();
	p.playerPreferences.music = 'rock'; p.gameState = 1; audio.state = 'suspended';
	p.unlockGameAudio(); await Promise.resolve();
	assert.equal(timers.size, 1);
	audio.createOscillator = () => { throw Error('unsupported'); };
	audio.currentTime += 1;
	assert.doesNotThrow(() => { for (const callback of [...timers.values()]) callback(); });
	assert.equal(timers.size, 0); assert.equal(p.gameState, 1);
});

test('clear particles are bounded, expire by presentation time, and do not change gameplay', () => {
	const { context: p, setNow, callout } = presentation();
	p.gameState = 1;
	const before = JSON.stringify([p.MainHex, p.score]);
	p.celebrateClear(2);
	assert.equal(callout.textContent, 'Sweet combo!'); assert.equal(p.clearParticles.length, 6);
	for (let i = 0; i < 50; i++) p.celebrateClear(5);
	assert.equal(p.clearParticles.length, 120);
	p.drawClearEffects();
	assert.equal(JSON.stringify([p.MainHex, p.score]), before);
	setNow(1851); p.drawClearEffects();
	assert.equal(p.clearParticles.length, 0);
	p.celebrateClear(1); p.resetGameEffects();
	assert.equal(callout.hidden, true); assert.equal(p.clearParticles.length, 0);
});

test('reduced motion suppresses particles and uses a static fading callout; menus/hidden tabs do not celebrate', () => {
	const { context: p, setReduced, animations } = presentation();
	p.gameState = 1; setReduced(true); p.celebrateClear(3);
	assert.equal(p.clearParticles.length, 0);
	assert.equal(animations.length, 1);
	assert.ok(animations[0].frames.every(frame => !frame.transform));
	setReduced(false); p.document.hidden = true; p.celebrateClear(3);
	p.document.hidden = false; p.gameState = 0; p.celebrateClear(3);
	assert.equal(animations.length, 1);
});

test('jewel tiles, core and guides draw without accessing simulation RNG or changing clocks', () => {
	const { context: p } = presentation();
	const before = JSON.stringify([p.MainHex, p.score]);
	p.drawJewelTile([{ x: 1, y: 1 }, { x: 4, y: 1 }, { x: 4, y: 4 }, { x: 1, y: 4 }], '#9b59b6', 1);
	p.drawJewelCore(100, 100, 60, 30); p.drawBoardGuides();
	assert.equal(JSON.stringify([p.MainHex, p.score]), before);
});

test('point labels sit above the core, never overlap its score, and remain stationary with reduced motion', () => {
	const { context: p, setReduced } = presentation();
	const positions = [];
	p.gdx = 0; p.gdy = 0; p.MainHex.dt = 1;
	p.renderText = (x, y, size) => positions.push({ y, size });
	const text = new p.Text(195, 422, '+ 10', 'Exo', '#9b59b6', p.fadeUpAndOut);
	setReduced(true); text.draw();
	assert.equal(text.y, 422);
	assert.equal(positions[0].y, 422 - p.settings.hexWidth * 1.4);
	assert.equal(positions[0].size, 36);
	setReduced(false); text.draw(); assert.ok(text.y < 422);
});

function telegramPresentation(version = '8.0') {
	const properties = new Map();
	const events = new Map();
	const chrome = [];
	let scales = 0;
	const app = {
		viewportStableHeight: 760,
		isVersionAtLeast(minimum) {
			const [major, minor] = version.split('.').map(Number);
			const [minMajor, minMinor] = minimum.split('.').map(Number);
			return major > minMajor || (major === minMajor && minor >= minMinor);
		},
		onEvent(name, callback) { assert.equal(events.has(name), false, 'retry must not duplicate native listeners'); events.set(name, callback); },
		setHeaderColor: color => chrome.push(['header', color]),
		setBackgroundColor: color => chrome.push(['background', color]),
		setBottomBarColor: color => chrome.push(['bottom', color])
	};
	const context = vm.createContext({
		document: { documentElement: { style: { setProperty: (key, value) => properties.set(key, value) } } },
		scaleCanvas() { scales++; }
	});
	vm.runInContext(readFileSync(path.join(__dirname, '../js/auth.js'), 'utf8'), context);
	return { context, app, properties, events, chrome, scales: () => scales };
}

test('Telegram chrome and stable viewport work before authentication and register only once', () => {
	const { context, app, properties, events, chrome, scales } = telegramPresentation();
	context.configureTelegramPresentation(app);
	assert.deepEqual(chrome, [['header', '#301441'], ['background', '#301441'], ['bottom', '#301441']]);
	assert.equal(properties.get('--app-height'), '760px');
	assert.equal(scales(), 1);
	context.configureTelegramPresentation(app);
	assert.equal(events.size, 4);
	assert.equal(scales(), 1);
	app.viewportStableHeight = 600;
	events.get('viewportChanged')({ isStateStable: false });
	assert.equal(properties.get('--app-height'), '760px');
	assert.equal(scales(), 1);
	events.get('viewportChanged')({ isStateStable: true });
	assert.equal(properties.get('--app-height'), '600px');
	for (const name of ['safeAreaChanged', 'contentSafeAreaChanged']) events.get(name)();
	assert.equal(scales(), 4);
	events.get('themeChanged')();
	assert.equal(chrome.length, 6, 'Telegram theme changes restore the game palette');
	for (const height of [0, -1, NaN, Infinity, undefined]) {
		app.viewportStableHeight = height; events.get('viewportChanged')();
		assert.equal(properties.get('--app-height'), '600px');
	}
});

test('Telegram presentation respects API versions and optional chrome failures', () => {
	for (const [version, expected] of [['6.0', []], ['6.1', ['background']], ['6.9', ['header', 'background']], ['7.9', ['header', 'background']], ['7.10', ['header', 'background', 'bottom']]]) {
		const { context, app, chrome, events } = telegramPresentation(version);
		context.configureTelegramPresentation(app);
		assert.deepEqual(chrome.map(entry => entry[0]), expected, version);
		assert.equal(events.has('safeAreaChanged'), false, version);
	}
	const { context, app, properties, chrome } = telegramPresentation();
	app.setHeaderColor = () => { throw Error('Unsupported native bridge'); };
	assert.doesNotThrow(() => context.configureTelegramPresentation(app));
	assert.equal(chrome.length, 2);
	assert.equal(properties.get('--app-height'), '760px');
});

test('canvas fits CSS safe-area bounds and HiDPI without changing simulation state', () => {
	const { context: p } = presentation();
	const before = JSON.stringify([p.MainHex, p.score]);
	p.canvas = { getBoundingClientRect: () => ({ left: 20, top: 60, width: 366, height: 670 }) };
	p.window.devicePixelRatio = 2;
	p.settings.baseHexWidth = 87; p.settings.baseBlockHeight = 20;
	vm.runInContext(readFileSync(path.join(__dirname, '../js/main.js'), 'utf8'), p);
	p.scaleCanvas();
	assert.equal(p.canvas.width, 732); assert.equal(p.canvas.height, 1340);
	assert.equal(p.trueCanvas.width, 366); assert.equal(p.trueCanvas.height, 670);
	assert.equal(JSON.stringify([p.MainHex, p.score]), before);
	assert.equal(p.settings.scale, 366 / 600);
	p.window.devicePixelRatio = 3;
	p.scaleCanvas();
	assert.equal(p.canvas.width, 732, 'high-density devices cap fill-rate at 2x');
});

test('jewel tiles avoid per-frame blur, clipping and gradients', () => {
	const { context: p } = presentation();
	const calls = [];
	p.ctx = new Proxy({}, {
		get: (_, key) => () => calls.push(key),
		set: (_, key, value) => { calls.push([key, value]); return true; }
	});
	p.drawJewelTile([{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 10 }, { x: 0, y: 10 }], '#9b59b6', 1);
	assert.ok(calls.includes('fill'));
	assert.equal(calls.filter(call => call === 'stroke').length, 2, 'retains the beveled arcade outline');
	assert.ok(!calls.some(call => ['clip', 'createLinearGradient', 'createRadialGradient'].includes(call)));
	assert.ok(!calls.some(call => Array.isArray(call) && call[0] === 'shadowBlur'));
});

test('rotation easing takes the same time at 30, 60 and 120 Hz and snaps for reduced motion', () => {
	const { context: p, setReduced } = presentation();
	vm.runInContext(readFileSync(path.join(__dirname, '../js/math.js'), 'utf8'), p);
	const angles = [30, 60, 120].map(rate => {
		p.renderFrameStep = 60 / rate;
		let angle = 30;
		for (let frame = 0; frame < rate / 10; frame++) angle = p.easeRotationAngle(angle, -30);
		return angle;
	});
	assert.ok(Math.abs(angles[0] - angles[1]) < 1e-10);
	assert.ok(Math.abs(angles[1] - angles[2]) < 1e-10);
	setReduced(true);
	assert.equal(p.easeRotationAngle(30, -30), -30);
});

test('HUD leaves unchanged text alone and only shows an active chain', () => {
	const { context: p } = presentation();
	let writes = 0;
	const elements = new Map(['liveScore', 'comboLabel', 'comboDetail'].map(id => {
		let text = '';
		return [id, { get textContent() { return text; }, set textContent(value) { text = String(value); writes++; } }];
	}));
	p.document.getElementById = id => elements.get(id);
	p.settings.comboTime = 300;
	vm.runInContext(readFileSync(path.join(__dirname, '../js/scoring.js'), 'utf8'), p);
	vm.runInContext(readFileSync(path.join(__dirname, '../js/view.js'), 'utf8'), p);
	p.updateComboDisplay();
	assert.equal(writes, 1);
	p.updateComboDisplay();
	assert.equal(writes, 1, 'steady score causes no DOM mutation');
	p.MainHex.clearChain = {}; p.MainHex.lastCombo = 0; p.MainHex.comboMultiplier = 2;
	p.updateComboDisplay();
	assert.equal(elements.get('comboLabel').textContent, 'COMBO x2');
	assert.equal(elements.get('comboDetail').textContent, '1.5×');
	assert.equal(writes, 3);
	p.updateComboDisplay();
	assert.equal(writes, 3);
	p.MainHex.comboClock = 300; p.updateComboDisplay();
	assert.equal(elements.get('comboLabel').textContent, '');
	assert.equal(elements.get('comboDetail').textContent, '');
});