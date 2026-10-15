// Versioned deterministic rules shared by the browser and authoritative replay.
var HexaSessionRules = {
	version: 'hexa-rush-v1', tickRate: 60, rotationTicks: 5,
	maxTicks: 108000, batchTicks: 600, batchEvents: 200, maxEvents: 20000,
	lifetimeMs: 30 * 60 * 1000
};

function seededGameRandom(seed) {
	var state = seed >>> 0;
	var random = function() {
		state = (state + 0x6D2B79F5) >>> 0;
		var value = Math.imul(state ^ state >>> 15, 1 | state);
		value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
		return ((value ^ value >>> 14) >>> 0) / 4294967296;
	};
	random.getState = function() { return state; };
	return random;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { rules: HexaSessionRules, seededGameRandom: seededGameRandom };