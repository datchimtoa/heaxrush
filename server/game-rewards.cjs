const { changeCoins, dailyEarnings } = require('./coins.cjs');
const { achievements } = require('./reward-policy.cjs');

// Called only for a newly verified finish while the user/session locks are held.
// The explicit enabled argument is a test seam, not a client or env setting.
async function accountFinishedGame(client, userId, row, time, enabled) {
	if (!enabled || !row.reward_eligible || row.status !== 'finished' || row.flagged_at) return row;
	for (const achievement of achievements) {
		if (achievement.score ? Number(row.server_score) >= achievement.score : row.max_combo >= achievement.combo) {
			await client.query(`INSERT INTO user_achievements (user_id, code, session_id, bonus_amount, unlocked_at)
				VALUES ($1,$2,$3,$4,$5) ON CONFLICT (user_id, code) DO NOTHING`, [userId, achievement.code, row.id, achievement.amount, new Date(time)]);
		}
	}
	// Achievement entitlements are retained, never silently paid partially,
	// forfeited, or carried forward. Their payout policy is still unresolved.
	const daily = await dailyEarnings(client, userId, time);
	if (daily.remainingGameplay < 10 || daily.remainingTotal < 10) return row;
	await changeCoins(client, userId, { type: 'earn', amount: 10, source: 'gameplay', referenceId: row.id,
		reason: 'Verified game completion', sessionId: row.id }, time);
	const saved = await client.query('UPDATE game_sessions SET coins_awarded = $2 WHERE id = $1 RETURNING *', [row.id, 10]);
	return saved.rows[0];
}

async function reverseGameRewards(client, userId, row, time) {
	const earnings = await client.query("SELECT * FROM coin_ledger WHERE user_id = $1 AND session_id = $2 AND change_type = 'earn' ORDER BY created_at, id", [userId, row.id]);
	let reversed = 0;
	for (const entry of earnings.rows) {
		await changeCoins(client, userId, { type: 'reverse', amount: Number(entry.amount), source: 'game_flag',
			referenceId: entry.id, sessionId: row.id, reason: 'Flagged game: ' + row.flag_reason }, time, true);
		reversed += Number(entry.amount);
	}
	await client.query('UPDATE game_sessions SET coins_reversed = $2 WHERE id = $1', [row.id, reversed]);
	await client.query('UPDATE user_achievements SET invalidated_at = COALESCE(invalidated_at, $3) WHERE user_id = $1 AND session_id = $2', [userId, row.id, new Date(time)]);
	return reversed;
}

module.exports = { accountFinishedGame, reverseGameRewards };