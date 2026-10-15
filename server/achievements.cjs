const { rules } = require('./replay.cjs');
const { achievements } = require('./reward-policy.cjs');

const descriptions = {
	score_500: ['Finding your rhythm', 'Score 500 points in one game.'],
	score_1000: ['Rush regular', 'Score 1,000 points in one game.'],
	score_2000: ['Hexa master', 'Score 2,000 points in one game.'],
	combo_4: ['Chain reaction', 'Reach chain level 4 in one game for 2.5× points.']
};

function createAchievementStore(pool) {
	return {
		async progress(userId) {
			// Display-only progress, not reward eligibility or saved entitlements.
			// Recompute after flags; never use user aggregates or practice records.
			const result = await pool.query(`
				SELECT COALESCE(MAX(g.server_score), 0) AS best_score,
					COALESCE(MAX(g.max_combo), 0) AS best_combo
				FROM game_sessions g JOIN users u ON u.id = g.user_id
				WHERE g.user_id = $1 AND u.status = 'active' AND g.status = 'finished'
					AND g.flagged_at IS NULL AND g.rules_version = $2
					AND g.server_score IS NOT NULL AND g.ended_at IS NOT NULL`, [userId, rules.version]);
			const row = result.rows[0];
			return { rulesVersion: rules.version, rewardsEnabled: false, milestones: achievements.map(achievement => {
				const metric = achievement.score ? 'score' : 'chain';
				const target = achievement.score || achievement.combo;
				const progress = Math.min(target, Number(metric === 'score' ? row.best_score : row.best_combo));
				return { code: achievement.code, title: descriptions[achievement.code][0], description: descriptions[achievement.code][1],
					metric, target, progress, reached: progress >= target };
			}) };
		}
	};
}

module.exports = { createAchievementStore };