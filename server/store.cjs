const { randomUUID } = require('node:crypto');
const { AuthError } = require('./telegram.cjs');
const { recordLoginDay } = require('./daily.cjs');
const { attributeReferral } = require('./referrals.cjs');

function publicUser(row) {
	return { id: row.id, telegramId: String(row.telegram_id), firstName: row.first_name, lastName: row.last_name, username: row.username, languageCode: row.language_code, officialBest: Number(row.best_score || 0), officialTotal: Number(row.total_score || 0), officialGames: row.games_played || 0, coinBalance: Number(row.coin_balance || 0), coinsHeld: Number(row.coins_held || 0) };
}

function createStore(pool, now = Date.now, { referralsEnabled = false } = {}) {
	return {
		async health() { await pool.query('SELECT 1'); },
		async login({ user, tokenHash, launchHash, expiresAt, startParam }) {
			const client = await pool.connect();
			try {
				await client.query('BEGIN');
				const newId = randomUUID();
				const result = await client.query(`
					INSERT INTO users (id, telegram_id, first_name, last_name, username, language_code)
					VALUES ($1, $2, $3, $4, $5, $6)
					ON CONFLICT (telegram_id) DO UPDATE SET
						first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name,
						username = EXCLUDED.username, language_code = EXCLUDED.language_code, updated_at = NOW()
					RETURNING *`, [newId, user.telegramId, user.firstName, user.lastName, user.username, user.languageCode]);
				const account = result.rows[0];
				if (account.status !== 'active') throw new AuthError('Account unavailable', 403);
				await client.query(`INSERT INTO auth_sessions (token_hash, user_id, launch_hash, expires_at) VALUES ($1, $2, $3, $4)`, [tokenHash, account.id, launchHash, expiresAt]);
				await recordLoginDay(client, account.id, now());
				// The upsert returns the generated UUID only for the winning new insert.
				// Existing/concurrent accounts never gain or replace a relationship.
				if (referralsEnabled && account.id === newId) await attributeReferral(client, account.id, startParam);
				await client.query('COMMIT');
				return publicUser(account);
			} catch (error) {
				await client.query('ROLLBACK');
				if (error.code === '23505') throw new AuthError('Telegram launch already used; reopen the Mini App');
				throw error;
			} finally { client.release(); }
		},
		// Same-launch, same-cookie POST retries still pass signed-data validation.
		// No GET/profile read calls this operation.
		async recordLaunch(userId) {
			const client = await pool.connect();
			try {
				await client.query('BEGIN');
				const account = await client.query("SELECT id FROM users WHERE id = $1 AND status = 'active' FOR UPDATE", [userId]);
				if (!account.rowCount) throw new AuthError('Account unavailable', 403);
				await recordLoginDay(client, userId, now());
				await client.query('COMMIT');
			} catch (error) { await client.query('ROLLBACK'); throw error; }
			finally { client.release(); }
		},
		async getSession(tokenHash) {
			const result = await pool.query(`
				SELECT u.*, s.launch_hash FROM auth_sessions s JOIN users u ON u.id = s.user_id
				WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > NOW() AND u.status = 'active'`, [tokenHash]);
			if (!result.rowCount) return null;
			return { user: publicUser(result.rows[0]), launchHash: result.rows[0].launch_hash };
		},
		async revoke(tokenHash) {
			await pool.query('UPDATE auth_sessions SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL', [tokenHash]);
		}
	};
}

module.exports = { createStore };