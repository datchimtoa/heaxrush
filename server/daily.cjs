const { rules } = require('./replay.cjs');

function utcDay(time) {
	const start = new Date(time);
	start.setUTCHours(0, 0, 0, 0);
	return { day: start.toISOString().slice(0, 10), start, end: new Date(start.getTime() + 86400000) };
}

// Only call after signed-launch validation and while holding the active user lock.
// The upsert serializes concurrent launches; older requests cannot roll state back.
async function recordLoginDay(client, userId, time) {
	await client.query(`INSERT INTO login_streaks (user_id, last_launch_day, days) VALUES ($1, $2::date, 1)
		ON CONFLICT (user_id) DO UPDATE SET
			days = CASE WHEN login_streaks.last_launch_day = EXCLUDED.last_launch_day - 1
				THEN login_streaks.days + 1 ELSE 1 END,
			last_launch_day = EXCLUDED.last_launch_day
		WHERE login_streaks.last_launch_day < EXCLUDED.last_launch_day`, [userId, utcDay(time).day]);
}

function streakView(row, day) {
	const last = row.last_launch_day || null;
	const yesterday = utcDay(Date.parse(day + 'T00:00:00Z') - 86400000).day;
	return { days: last === day || last === yesterday ? Number(row.streak_days) : 0,
		lastLaunchDay: last, checkedInToday: last === day };
}

function createDailyStore(pool, now = Date.now) {
	return {
		async progress(userId) {
			const time = now(), { day, start, end } = utcDay(time);
			// Both progress and streak share one snapshot; reads never record visits.
			const result = await pool.query(`
				WITH progress AS (
					SELECT COUNT(*) AS completed_games, COALESCE(MAX(g.server_score), 0) AS best_score,
						COALESCE(MAX(g.max_combo), 0) AS best_combo
					FROM game_sessions g JOIN users u ON u.id = g.user_id
					WHERE g.user_id = $1 AND u.status = 'active' AND g.status = 'finished'
						AND g.flagged_at IS NULL AND g.rules_version = $2 AND g.server_score IS NOT NULL
						AND g.ended_at >= $3 AND g.ended_at < $4
				)
				SELECT p.*, TO_CHAR(s.last_launch_day, 'YYYY-MM-DD') AS last_launch_day, s.days AS streak_days
				FROM progress p LEFT JOIN (login_streaks s JOIN users u ON u.id = s.user_id AND u.status = 'active')
					ON s.user_id = $1`, [userId, rules.version, start, end]);
			const row = result.rows[0];
			const definitions = [
				['play_3', 'Find your flow', 'Finish 3 games today.', 'games', 3, Number(row.completed_games)],
				['score_800', 'Aim higher', 'Score 800 points in one game today.', 'score', 800, Number(row.best_score)],
				['combo_3', 'Keep the chain', 'Reach chain level 3 today for 2× points.', 'chain', 3, Number(row.best_combo)]
			];
			return { rulesVersion: rules.version, rewardsEnabled: false, timezone: 'UTC', day,
				serverTime: new Date(time).toISOString(), startsAt: start.toISOString(), endsAt: end.toISOString(),
				quests: definitions.map(([code, title, description, metric, target, value]) => ({ code, title, description, metric, target,
					progress: Math.min(target, value), reached: value >= target })), streak: streakView(row, day) };
		}
	};
}

module.exports = { createDailyStore, recordLoginDay, streakView, utcDay };