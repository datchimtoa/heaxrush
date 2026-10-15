// Hexa Rush scoring. Shared as a plain browser script and a Node.js module.
function groupBaseScore(size) {
	if (!Number.isInteger(size) || size < 3) return 0;
	if (size === 3) return 10;
	if (size === 4) return 18;
	return 30 + Math.max(0, size - 5) * 12;
}

function comboScoreMultiplier(level) {
	return Math.min(3, 1 + Math.max(0, level - 1) * 0.5);
}

function advanceClearChain(previous, size, time, windowSize) {
	var continued = previous && time - previous.lastClear < windowSize;
	var level = continued ? previous.level + 1 : 1;
	var base = (continued ? previous.base : 0) + groupBaseScore(size);
	var total = base * comboScoreMultiplier(level);
	return {
		level: level,
		base: base,
		total: total,
		lastClear: time,
		awarded: total - (continued ? previous.total : 0)
	};
}

if (typeof module !== 'undefined' && module.exports) {
	module.exports = { groupBaseScore: groupBaseScore, comboScoreMultiplier: comboScoreMultiplier, advanceClearChain: advanceClearChain };
}