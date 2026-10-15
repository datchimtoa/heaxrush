const { AuthError } = require('./telegram.cjs');
const { rules } = require('./replay.cjs');

const codePattern = /^ref_[a-f0-9]{32}$/;
const accountPattern = /^ref_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const telegramPattern = /^ref_[1-9]\d{0,15}$/;

// Call only for the freshly inserted account inside its validated-login transaction.
// New invitees cannot own a published code yet: lock new invitee, then existing
// referrer. Never take two existing-user locks (including ordinary launch retries).
async function attributeReferral(client, inviteeId, startParam) {
	if (typeof startParam !== 'string') return;
	const accountLink = accountPattern.test(startParam);
	const telegramLink = telegramPattern.test(startParam) && Number.isSafeInteger(Number(startParam.slice(4)));
	if (!accountLink && !telegramLink && !codePattern.test(startParam)) return;
	// Previously shared random-code and UUID links remain valid. New links use the
	// owner's Telegram ID, but still require an explicitly published invite row.
	const result = await client.query(`SELECT u.id FROM referral_codes c JOIN users u ON u.id = c.user_id
		WHERE ${telegramLink ? 'u.telegram_id' : accountLink ? 'c.user_id' : 'c.code'} = $1 AND u.status = 'active' AND u.id <> $2 FOR SHARE OF u`, [telegramLink || accountLink ? startParam.slice(4) : startParam, inviteeId]);
	if (!result.rowCount) return;
	await client.query('INSERT INTO referrals (invitee_id, referrer_id) VALUES ($1, $2)', [inviteeId, result.rows[0].id]);
}

function createReferralStore(pool, botUsername) {
	if (!/^[a-z][a-z0-9_]{1,28}bot$/i.test(botUsername || '')) throw new Error('Invalid bot username');
	const link = telegramId => telegramId ? `https://t.me/${botUsername}?startapp=ref_${telegramId}` : null;
	return {
		async createCode(userId) {
			const client = await pool.connect();
			try {
				await client.query('BEGIN');
				const owner = await client.query("SELECT id, telegram_id FROM users WHERE id = $1 AND status = 'active' FOR UPDATE", [userId]);
				if (!owner.rowCount) throw new AuthError('Account unavailable', 403);
				// Retain migration 006's publication markers and previously shared codes.
				// Display links use the Telegram ID, not this internal UUID-derived marker.
				await client.query(`INSERT INTO referral_codes (user_id, code) VALUES ($1, $2)
					ON CONFLICT (user_id) DO NOTHING`, [userId, 'ref_' + userId.replaceAll('-', '')]);
				await client.query('COMMIT');
				return { inviteLink: link(owner.rows[0].telegram_id) };
			} catch (error) { await client.query('ROLLBACK'); throw error; }
			finally { client.release(); }
		},
		async summary(userId) {
			// One owner-scoped snapshot, recomputed after flags; never reward eligibility.
			const result = await pool.query(`
				WITH progress AS (
					SELECT r.invitee_id, COUNT(g.id) >= 3 AS reached
					FROM referrals r JOIN users invited ON invited.id = r.invitee_id AND invited.status = 'active'
					JOIN users owner ON owner.id = r.referrer_id AND owner.status = 'active'
					LEFT JOIN game_sessions g ON g.user_id = r.invitee_id AND g.status = 'finished'
						AND g.flagged_at IS NULL AND g.rules_version = $2 AND g.server_score IS NOT NULL
						AND g.ended_at >= r.attributed_at
					WHERE r.referrer_id = $1 GROUP BY r.invitee_id
				)
				SELECT u.id, u.telegram_id, c.code, (SELECT COUNT(*) FROM progress) AS invited_accounts,
					(SELECT COUNT(*) FROM progress WHERE reached) AS reached_accounts
				FROM users u LEFT JOIN referral_codes c ON c.user_id = u.id
				WHERE u.id = $1 AND u.status = 'active'`, [userId, rules.version]);
			if (!result.rowCount) throw new AuthError('Account unavailable', 403);
			const row = result.rows[0];
			return { rulesVersion: rules.version, rewardsEnabled: false, targetGames: 3,
				inviteLink: link(row.code ? row.telegram_id : null), invitedAccounts: Number(row.invited_accounts), reachedAccounts: Number(row.reached_accounts) };
		}
	};
}

module.exports = { attributeReferral, createReferralStore };