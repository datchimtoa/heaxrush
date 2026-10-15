const { createHash } = require('node:crypto');
const { GameError, rules } = require('./replay.cjs');
const { telegramUsername } = require('../js/identity.js');

function leaderboardWindow(period, time) {
	if (!['daily', 'weekly'].includes(period)) throw new GameError('Expected daily or weekly leaderboard');
	const start = new Date(time);
	start.setUTCHours(0, 0, 0, 0);
	if (period === 'weekly') start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
	return { start, end: new Date(start.getTime() + (period === 'daily' ? 1 : 7) * 86400000) };
}

function createLeaderboardStore(pool, now = Date.now) {
	return {
		async standings(userId, period) {
			const { start, end } = leaderboardWindow(period, now());
			const limit = period === 'daily' ? 50 : 100;
			// Rank and top rows share one PostgreSQL snapshot. Ties share a rank;
			// UUID ordering only makes the bounded displayed slice deterministic.
			const result = await pool.query(`
				WITH scores AS (
					SELECT g.user_id, ${period === 'daily' ? 'MAX' : 'SUM'}(g.server_score) AS points
					FROM game_sessions g JOIN users u ON u.id = g.user_id
					WHERE g.status = 'finished' AND g.flagged_at IS NULL AND u.status = 'active'
						AND g.server_score IS NOT NULL
						AND g.ended_at >= $1 AND g.ended_at < $2 AND g.rules_version = $5
					GROUP BY g.user_id
				), ranked AS (
					SELECT user_id, points, RANK() OVER (ORDER BY points DESC) AS rank,
						ROW_NUMBER() OVER (ORDER BY points DESC, user_id) AS position
					FROM scores
				)
				SELECT r.user_id, r.points, r.rank, r.position, u.username FROM ranked r
				JOIN users u ON u.id = r.user_id
				WHERE position <= $4 OR user_id = $3 ORDER BY position`, [start, end, userId, limit, rules.version]);
			const own = result.rows.find(row => row.user_id === userId);
			const entries = result.rows.filter(row => Number(row.position) <= limit).map(row => ({
				rank: Number(row.rank), score: Number(row.points), isYou: row.user_id === userId,
				// Only public handles, never personal names, Telegram IDs or profile links.
				label: telegramUsername(row) || 'Player ' + createHash('sha256').update(row.user_id).digest('hex').slice(0, 10)
			}));
			return { period, timezone: 'UTC', startsAt: start.toISOString(), endsAt: end.toISOString(),
				limit, metric: period === 'daily' ? 'best_score' : 'total_score', rewardsEnabled: false,
				entries, own: own ? { rank: Number(own.rank), score: Number(own.points) } : null };
		}
	};
}

module.exports = { createLeaderboardStore, leaderboardWindow };
