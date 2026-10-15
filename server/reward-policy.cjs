// Draft calendar accounting only. Activation requires an approved achievement/cap
// policy and day boundary. There is deliberately no environment activation switch.
const rewardPolicy = Object.freeze({ issuanceEnabled: false, gameplayLimit: 100, totalLimit: 200, timezone: 'UTC' });
const achievements = Object.freeze([
	{ code: 'score_500', score: 500, amount: 50 },
	{ code: 'score_1000', score: 1000, amount: 150 },
	{ code: 'score_2000', score: 2000, amount: 500 },
	// x4 is the clear-chain level (2.5x points), not a 4x points multiplier.
	{ code: 'combo_4', combo: 4, amount: 100 }
]);

function dayBounds(time) {
	const start = new Date(time);
	start.setUTCHours(0, 0, 0, 0);
	return { day: start.toISOString().slice(0, 10), start, end: new Date(start.getTime() + 86400000) };
}

function dailyView(row, time) {
	const earned = Number(row.total_earned || 0), gameplayEarned = Number(row.gameplay_earned || 0);
	return { day: dayBounds(time).day, timezone: rewardPolicy.timezone, earned, gameplayEarned,
		totalLimit: rewardPolicy.totalLimit, gameplayLimit: rewardPolicy.gameplayLimit,
		remainingTotal: Math.max(0, rewardPolicy.totalLimit - earned), remainingGameplay: Math.max(0, rewardPolicy.gameplayLimit - gameplayEarned) };
}

module.exports = { rewardPolicy, achievements, dayBounds, dailyView };