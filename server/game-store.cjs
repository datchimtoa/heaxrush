const { randomUUID, randomBytes, createHash } = require('node:crypto');
const { GameError, createReplay, validateBatch, rules } = require('./replay.cjs');
const { rewardPolicy } = require('./reward-policy.cjs');
const { accountFinishedGame, reverseGameRewards } = require('./game-rewards.cjs');

function sessionView(row) {
	return { id: row.id, seed: Number(row.seed), rulesVersion: row.rules_version, status: row.status, tick: row.last_tick, expiresAt: row.expires_at, maxTicks: rules.maxTicks };
}
function resultView(row) {
	return { sessionId: row.id, score: Number(row.server_score), maxCombo: row.max_combo, blocksCleared: row.blocks_cleared, durationMs: row.duration_ms, verified: true };
}

function createGameStore(pool, now = Date.now, issuanceEnabled = rewardPolicy.issuanceEnabled) {
	async function transaction(userId, callback, allowBlocked = false) {
		const client = await pool.connect();
		try {
			await client.query('BEGIN');
			const user = await client.query(`SELECT id FROM users WHERE id = $1${allowBlocked ? '' : " AND status = 'active'"} FOR UPDATE`, [userId]);
			if (!user.rowCount) throw new GameError('Account unavailable', 403);
			const value = await callback(client);
			await client.query('COMMIT');
			return value;
		} catch (error) { await client.query('ROLLBACK'); throw error; }
		finally { client.release(); }
	}
	async function getOwned(client, userId, id) {
		const found = await client.query('SELECT * FROM game_sessions WHERE id = $1 AND user_id = $2 FOR UPDATE', [id, userId]);
		if (!found.rowCount) throw new GameError('Game session not found', 404);
		return found.rows[0];
	}
	function requireActive(row) {
		if (row.status !== 'active' || new Date(row.expires_at).getTime() <= now()) throw new GameError('Session is no longer active', 409);
		if (row.rules_version !== rules.version) throw new GameError('Unsupported game version', 409);
	}
	async function officialResult(client, userId, row) {
		const user = await client.query('SELECT best_score, coin_balance, coins_held FROM users WHERE id = $1', [userId]);
		return { ...resultView(row), bestScore: Number(user.rows[0].best_score),
			coins: { awarded: Number(row.coins_awarded || 0), balance: Number(user.rows[0].coin_balance || 0), held: Number(user.rows[0].coins_held || 0), issuanceEnabled,
				reversed: Number(row.coins_reversed || 0), flagged: Boolean(row.flagged_at) } };
	}
	return {
		async start(userId, requestId) {
			return transaction(userId, async client => {
				const existing = await client.query('SELECT * FROM game_sessions WHERE user_id = $1 AND request_id = $2', [userId, requestId]);
				if (existing.rowCount) { requireActive(existing.rows[0]); return sessionView(existing.rows[0]); }
				await client.query('UPDATE game_sessions SET status = \'expired\', ended_at = $2 WHERE user_id = $1 AND status = \'active\' AND expires_at <= $2', [userId, new Date(now())]);
				// A deliberate new Play replaces an abandoned/refreshed run. Same-key
				// retries above never invalidate an existing session.
				await client.query('UPDATE game_sessions SET status = \'abandoned\', ended_at = $2 WHERE user_id = $1 AND status = \'active\'', [userId, new Date(now())]);
				const row = await client.query(`INSERT INTO game_sessions (id, user_id, request_id, rules_version, seed, started_at, expires_at, reward_eligible) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [randomUUID(), userId, requestId, rules.version, randomBytes(4).readUInt32LE(), new Date(now()), new Date(now() + rules.lifetimeMs), issuanceEnabled]);
				return sessionView(row.rows[0]);
			});
		},
		async events(userId, id, body) {
			validateBatch(body);
			const hash = createHash('sha256').update(JSON.stringify({ fromTick: body.fromTick, toTick: body.toTick, events: body.events.map(event => ({ tick: event.tick, type: event.type, value: event.value })) })).digest('hex');
			return transaction(userId, async client => {
				const row = await getOwned(client, userId, id);
				const duplicate = await client.query('SELECT payload_hash FROM game_event_batches WHERE session_id = $1 AND from_tick = $2', [id, body.fromTick]);
				if (duplicate.rowCount) {
					if (duplicate.rows[0].payload_hash !== hash) throw new GameError('Conflicting batch retry', 409);
					return { tick: row.last_tick, status: row.status };
				}
				requireActive(row);
				if (row.last_tick !== body.fromTick) throw new GameError('Input sequence gap or overlap', 409);
				if (body.toTick * 1000 / rules.tickRate > now() - new Date(row.started_at).getTime() + 1000) throw new GameError('Simulation runs ahead of server time');
				if (row.events.length + body.events.length > rules.maxEvents) throw new GameError('Input limit exceeded');
				// Only server-created snapshots are restored. Each batch runs <=600 ticks.
				const events = row.events.concat(body.events);
				const replay = createReplay(Number(row.seed), row.engine_state);
				replay.advance(body.toTick, body.events);
				await client.query('INSERT INTO game_event_batches (session_id, from_tick, to_tick, payload_hash) VALUES ($1,$2,$3,$4)', [id, body.fromTick, body.toTick, hash]);
				await client.query('UPDATE game_sessions SET events = $2::jsonb, last_tick = $3, engine_state = $4::jsonb WHERE id = $1', [id, JSON.stringify(events), body.toTick, JSON.stringify(replay.snapshot())]);
				return { tick: body.toTick, status: 'active', ended: replay.result().ended };
			});
		},
		async finish(userId, id) {
			return transaction(userId, async client => {
				const row = await getOwned(client, userId, id);
				if (row.status === 'finished') return officialResult(client, userId, row);
				requireActive(row);
				if (row.flagged_at) throw new GameError('Game session is flagged', 409);
				const replay = createReplay(Number(row.seed), row.engine_state);
				const result = replay.result();
				if (!result.ended) throw new GameError('Run has not reached game over', 409);
				const time = now();
				const saved = await client.query(`UPDATE game_sessions SET status = 'finished', ended_at = $2, server_score = $3, max_combo = $4, blocks_cleared = $5, duration_ms = $6 WHERE id = $1 RETURNING *`, [id, new Date(time), result.score, result.maxCombo, result.blocksCleared, result.durationMs]);
				await client.query('UPDATE users SET best_score = GREATEST(best_score, $2), total_score = total_score + $2, games_played = games_played + 1 WHERE id = $1', [userId, result.score]);
				const rewarded = await accountFinishedGame(client, userId, saved.rows[0], time, issuanceEnabled);
				return officialResult(client, userId, rewarded);
			});
		},
		// Trusted moderation operation only. It is deliberately not an HTTP action.
		async flag(userId, id, reason) {
			if (typeof reason !== 'string' || !reason.trim() || reason.length > 220) throw new GameError('Expected a flag reason');
			return transaction(userId, async client => {
				let row = await getOwned(client, userId, id);
				const time = now();
				if (!row.flagged_at) {
					const saved = await client.query('UPDATE game_sessions SET flagged_at = $2, flag_reason = $3 WHERE id = $1 RETURNING *', [id, new Date(time), reason]);
					row = saved.rows[0];
				}
				const reversed = await reverseGameRewards(client, userId, row, time);
				return { flagged: true, reversed };
			}, true);
		},
		async abandon(userId, id) {
			return transaction(userId, async client => {
				const row = await getOwned(client, userId, id);
				if (row.status === 'active') await client.query('UPDATE game_sessions SET status = \'abandoned\', ended_at = $2 WHERE id = $1', [id, new Date(now())]);
				return { status: row.status === 'active' ? 'abandoned' : row.status };
			});
		}
	};
}

module.exports = { createGameStore };