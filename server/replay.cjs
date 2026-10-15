const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { rules, seededGameRandom } = require('../js/session-rules.js');
const sources = ['scoring', 'math', 'Block', 'Hex', 'Text', 'checking', 'wavegen', 'update'].map(name =>
	new vm.Script(readFileSync(path.join(__dirname, '../js', name + '.js'), 'utf8'), { filename: name + '.js' }));

class GameError extends Error {
	constructor(message, status = 400) { super(message); this.status = status; }
}

function createReplay(seed, snapshot = null) {
	const state = vm.createContext({
		settings: { baseHexWidth: 87, baseBlockHeight: 20, hexWidth: 87, blockHeight: 20, scale: 1, prevScale: 1, rows: 7, startDist: 350, creationDt: 18, speedModifier: 0.65, creationSpeedModifier: 0.65, comboTime: 300 },
		colors: ['#e74c3c', '#f1c40f', '#3498db', '#2ecc71', '#9b59b6'],
		gameRandom: seededGameRandom(seed), trueCanvas: { width: 600, height: 1000 },
		gameState: 1, blocks: [], score: 0, rush: 1, angularVelocityConst: 4,
		window: { devicePixelRatio: 1 }, gameFeedback() {}
	});
	for (const script of sources) script.runInContext(state);
	state.addNewBlock = (lane, color, speed, distance, settled) => state.blocks.push(new state.Block(lane, color, speed * state.settings.speedModifier, distance, settled));
	state.MainHex = new state.Hex(87);
	state.waveone = new state.waveGen(state.MainHex);
	let tick = snapshot ? snapshot.tick : 0;
	let ended = snapshot ? snapshot.ended : false;
	if (snapshot) {
		state.rush = snapshot.rush;
		state.score = snapshot.score;
		state.gameRandom = seededGameRandom(snapshot.randomState);
		function hydrate(block) { return Object.assign(new state.Block(block.fallingLane, block.color, block.iter), block); }
		Object.assign(state.MainHex, snapshot.hex);
		state.MainHex.blocks = snapshot.hex.blocks.map(side => side.map(hydrate));
		state.blocks = snapshot.blocks.map(hydrate);
		Object.assign(state.waveone, snapshot.wave);
		state.waveone.currentFunction = state.waveone[snapshot.pattern];
	}
	return {
		advance(toTick, events) {
			let index = 0;
			while (tick < toTick) {
				if (ended) throw new GameError('Inputs or ticks after game over');
				while (index < events.length && events[index].tick === tick) {
					const event = events[index++];
					if (event.type === 'rotate') {
						if (!state.MainHex.rotate(event.value)) throw new GameError('Rotation rate exceeded');
					} else {
						if ((state.rush === 4) === event.value) throw new GameError('Redundant rush input');
						state.rush = event.value ? 4 : 1;
					}
				}
				state.update(state.rush);
				state.MainHex.texts = [];
				state.MainHex.shakes = [];
				tick++;
				ended = state.MainHex.blocks.some(side => side.filter(block => !block.deleted).length > 7);
			}
			if (index !== events.length) throw new GameError('Unconsumed input');
		},
		result() { return { tick, ended, score: state.score, maxCombo: state.MainHex.bestCombo, blocksCleared: state.MainHex.clearedBlocks, durationMs: Math.floor(tick * 1000 / rules.tickRate) }; },
		snapshot() {
			const wave = {};
			for (const [key, value] of Object.entries(state.waveone)) if (typeof value === 'number') wave[key] = value;
			const pattern = Object.keys(state.waveone).find(key => key !== 'currentFunction' && state.waveone[key] === state.waveone.currentFunction);
			return JSON.parse(JSON.stringify({ tick, ended, rush: state.rush, score: state.score, randomState: state.gameRandom.getState(), hex: state.MainHex, blocks: state.blocks, wave, pattern }));
		}
	};
}

function validateBatch(body) {
	if (!body || Object.keys(body).sort().join(',') !== 'events,fromTick,toTick' || !Number.isInteger(body.fromTick) || !Number.isInteger(body.toTick) || body.fromTick < 0 || body.toTick <= body.fromTick || body.toTick > rules.maxTicks || body.toTick - body.fromTick > rules.batchTicks || !Array.isArray(body.events) || body.events.length > rules.batchEvents) throw new GameError('Invalid input batch');
	let previous = body.fromTick;
	for (const event of body.events) {
		if (!event || Object.keys(event).sort().join(',') !== 'tick,type,value' || !Number.isInteger(event.tick) || event.tick < previous || event.tick >= body.toTick || !['rotate', 'rush'].includes(event.type) || (event.type === 'rotate' ? ![-1, 1].includes(event.value) : typeof event.value !== 'boolean')) throw new GameError('Invalid or unordered input');
		previous = event.tick;
	}
	return body;
}

module.exports = { GameError, createReplay, validateBatch, rules };