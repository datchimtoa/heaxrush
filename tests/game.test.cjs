const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { groupBaseScore, comboScoreMultiplier, advanceClearChain } = require('../js/scoring.js');

const root = path.resolve(__dirname, '..');
function engine() {
	const sandbox = vm.createContext({
		settings: { comboTime: 300, scale: 1, hexWidth: 87, baseHexWidth: 87, blockHeight: 20, baseBlockHeight: 20, rows: 7, creationDt: 1, startDist: 350, speedModifier: 0.65, creationSpeedModifier: 0.65 },
		trueCanvas: { width: 600, height: 800 }, angularVelocityConst: 4,
		gameState: 1, score: 0, blocks: [], rush: 1, history: {},
		navigator: { userAgent: 'test' }, Date, colors: ['red', 'yellow', 'blue', 'green', '#9b59b6'],
		window: { devicePixelRatio: 1, matchMedia: () => ({ matches: false }) }, gdx: 0, gdy: 0,
		playerPreferences: { sound: false, haptics: false },
		ctx: new Proxy({}, { get: () => () => {} })
	});
	for (const file of ['scoring', 'feedback', 'math', 'Hex', 'Block', 'Text', 'checking', 'wavegen', 'update', 'main', 'render']) {
		vm.runInContext(fs.readFileSync(path.join(root, 'js', file + '.js'), 'utf8'), sandbox);
	}
	vm.runInContext('MainHex = new Hex(87); waveone = new waveGen(MainHex);', sandbox);
	return sandbox;
}

test('approved group scores, including seven-block example and invalid groups', () => {
	for (const [size, expected] of [[0, 0], [2, 0], [3, 10], [4, 18], [5, 30], [6, 42], [7, 54], [10, 90], [3.5, 0]]) {
		assert.equal(groupBaseScore(size), expected);
	}
});

test('combo multipliers use 2.5 at x4 and cap at 3', () => {
	assert.deepEqual([1, 2, 3, 4, 5, 6, 99].map(comboScoreMultiplier), [1, 1.5, 2, 2.5, 3, 3, 3]);
});

test('the entire chain uses its highest multiplier without double awarding', () => {
	let chain = null;
	let awarded = 0;
	for (let i = 0; i < 6; i++) {
		chain = advanceClearChain(chain, 3, i * 30, 300);
		awarded += chain.awarded;
		assert.equal(awarded, (i + 1) * 10 * comboScoreMultiplier(i + 1));
	}
	assert.equal(awarded, 180);
});

test('chain resets exactly at five gameplay seconds', () => {
	const chain = advanceClearChain(null, 7, 0, 300);
	assert.equal(advanceClearChain(chain, 3, 299, 300).level, 2);
	const expired = advanceClearChain(chain, 3, 300, 300);
	assert.equal(expired.level, 1);
	assert.equal(expired.awarded, 10);
});

test('a connected purple group clears across the wraparound side only once', () => {
	const game = engine();
	vm.runInContext(`
		[5, 0, 1].forEach(function(side) {
			var b = new Block(0, '#9b59b6', 1, 75, true);
			b.attachedLane = side;
			MainHex.blocks[side].push(b);
		});
		consolidateBlocks(MainHex, 0, 0);
		consolidateBlocks(MainHex, 1, 0);
	`, game);
	assert.equal(game.score, 10);
	assert.equal(game.MainHex.bestCombo, 1);
	assert.equal(game.MainHex.clearedBlocks, 3);
	assert.equal(game.MainHex.blocks[5][0].deleted, 1);
});

test('two blocks and diagonal-only neighbors do not clear', () => {
	const game = engine();
	vm.runInContext(`
		MainHex.blocks[0] = [new Block(0, 'red', 1, 75, true), new Block(0, 'red', 1, 95, true)];
		MainHex.blocks[1] = [new Block(1, 'blue', 1, 75, true), new Block(1, 'blue', 1, 95, true), new Block(1, 'red', 1, 115, true)];
		consolidateBlocks(MainHex, 0, 0);
	`, game);
	assert.equal(game.score, 0);
	assert.equal(game.MainHex.blocks[0][0].deleted, 0);
});

test('gravity forms a second match and scores it as part of the chain', () => {
	const game = engine();
	vm.runInContext(`
		var stack = ['blue', 'red', 'red', 'red', 'blue', 'blue'];
		MainHex.blocks[0] = stack.map(function(color, index) {
			var b = new Block(0, color, 1, 87 * Math.sqrt(3) / 2 + index * 20, true);
			b.initializing = 0;
			b.attachedLane = 0;
			return b;
		});
		consolidateBlocks(MainHex, 0, 1);
		for (var frame = 0; frame < 160; frame++) {
			update(1);
		}
	`, game);
	assert.equal(game.score, 30);
	assert.equal(game.MainHex.bestCombo, 2);
	assert.equal(game.MainHex.clearedBlocks, 6);
	assert.equal(game.MainHex.blocks[0].length, 0);
});

test('rush accelerates blocks but not the five-second combo clock', () => {
	const game = engine();
	vm.runInContext('rush = 4; update(4);', game);
	assert.equal(game.MainHex.ct, 4);
	assert.equal(game.MainHex.comboClock, 1);
});

test('overflow counts only blocks that are not being cleared', () => {
	const game = engine();
	game.MainHex.blocks[0] = Array.from({ length: 8 }, () => ({ deleted: 0 }));
	assert.equal(game.isInfringing(game.MainHex), true);
	game.MainHex.blocks[0][0].deleted = 1;
	assert.equal(game.isInfringing(game.MainHex), false);
});

test('rotation wraps all six sides and respects paused state', () => {
	const game = engine();
	game.MainHex.lastRotate = -5;
	game.MainHex.rotate(-1);
	assert.equal(game.MainHex.position, 5);
	game.MainHex.comboClock = 5;
	game.MainHex.rotate(1);
	assert.equal(game.MainHex.position, 0);
	game.gameState = -1;
	game.MainHex.lastRotate = 0;
	game.MainHex.rotate(1);
	assert.equal(game.MainHex.position, 0);
});

test('difficulty starts slowly and scales by cleared blocks with limits', () => {
	const game = engine();
	for (let i = 0; i < 60; i++) game.blockDestroyed();
	assert.equal(game.waveone.difficulty, 1);
	assert.equal(game.waveone.nextGen, 2700);
	for (let i = 0; i < 1000; i++) game.blockDestroyed();
	assert.equal(game.waveone.difficulty, 35);
	assert.equal(game.waveone.nextGen, 650);
});

test('practice records are isolated, sorted, fractional-safe, and handle blocked storage', () => {
	const sandbox = vm.createContext({ localStorage: { getItem: () => '[18, 2, 70.5, -1, "99", null]', setItem: () => { throw Error('blocked'); } } });
	vm.runInContext(fs.readFileSync(path.join(root, 'js/save-state.js'), 'utf8'), sandbox);
	assert.equal(sandbox.highScoreStorageKey, 'hexaRush.practice.highscores.v1');
	assert.deepEqual(Array.from(sandbox.readHighScores()), [70.5, 18, 2]);
	sandbox.highscores = [18, 70.5];
	assert.doesNotThrow(() => sandbox.writeHighScores());
	sandbox.localStorage.getItem = () => '{bad json';
	assert.deepEqual(Array.from(sandbox.readHighScores()), []);
});

test('runtime scripts parse and no longer load legacy advertisements or telemetry', () => {
	const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
	for (const [, source] of html.matchAll(/<script\b[^>]*src="([^"]+)"/g)) {
		assert.ok(!source.startsWith('http'), source);
		const script = fs.readFileSync(path.join(root, source), 'utf8');
		assert.doesNotThrow(() => new vm.Script(script, { filename: source }));
		assert.doesNotMatch(script, /hextris\.io\/.*a\.js|google-analytics\.com|54\.183\.184\.126|exportSaveState/);
	}
	assert.match(html, /Hexa Rush/);
	assert.match(html, /GPLv3/);
	assert.match(html, /href="credits.html"/);
	assert.match(html, /<details id="aboutGame"[\s\S]*?href="credits.html"[\s\S]*?<\/details>/);
	assert.doesNotMatch(html, /home-hero|settings-card/);
	assert.match(html, /id="appNavigation"/);
	assert.doesNotMatch(html, /Logan Engstrom|Garrett Finucane|Noah Moroze|Michael Yang/);
	const credits = fs.readFileSync(path.join(root, 'credits.html'), 'utf8');
	for (const name of ['Logan Engstrom', 'Garrett Finucane', 'Noah Moroze', 'Michael Yang']) assert.ok(credits.includes(name));
	assert.match(credits, /Copyright \(C\) 2018 Logan Engstrom/);
	assert.doesNotMatch(html, /https?:[^"']+a\.js|google-analytics|fonts\.googleapis/);
});

test('animated title board is decorative and reduced motion freezes its rotation', () => {
	const game = engine();
	const angles = [];
	game.drawPolygon = (x, y, sides, radius, angle) => angles.push(angle);
	game.clearGameBoard = () => {};
	game.renderText = () => {};
	game.hexagonBackgroundColor = '#101525';
	const before = [game.MainHex.ct, game.MainHex.comboClock, game.score, game.MainHex.clearedBlocks, game.blocks.length];
	game.renderTitleBoard(0);
	game.renderTitleBoard(6000);
	assert.notEqual(angles[0], angles[1]);
	game.window.matchMedia = () => ({ matches: true });
	game.renderTitleBoard(0);
	game.renderTitleBoard(6000);
	assert.equal(angles[2], angles[3]);
	assert.deepEqual([game.MainHex.ct, game.MainHex.comboClock, game.score, game.MainHex.clearedBlocks, game.blocks.length], before);
});

test('title drawing stops in Records, Options, and hidden tabs', () => {
	const game = engine();
	let draws = 0;
	game.gameState = 0;
	game.lastTime = 0;
	game.activeHomeTab = 'home';
	game.officialRun = null;
	game.document = { hidden: false };
	game.renderTitleBoard = () => draws++;
	game.requestAnimationFrame = () => {};
	game.animLoop(20);
	assert.equal(draws, 1);
	for (const tab of ['activity', 'settings']) {
		game.activeHomeTab = tab;
		game.animLoop(40);
		assert.equal(draws, 1);
	}
	game.activeHomeTab = 'home';
	game.document.hidden = true;
	game.animLoop(60);
	assert.equal(draws, 1);
	assert.equal(game.MainHex.ct, 0);
});