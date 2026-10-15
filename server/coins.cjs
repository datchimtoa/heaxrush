const { randomUUID } = require('node:crypto');
const { GameError } = require('./replay.cjs');
const { rewardPolicy, dayBounds, dailyView } = require('./reward-policy.cjs');

async function dailyEarnings(client, userId, time) {
	const { start, end } = dayBounds(time);
	const result = await client.query(`SELECT
		COALESCE(SUM(amount) FILTER (WHERE change_type = 'earn'), 0) AS total_earned,
		COALESCE(SUM(amount) FILTER (WHERE change_type = 'earn' AND source IN ('gameplay', 'achievement')), 0) AS gameplay_earned
		FROM coin_ledger WHERE user_id = $1 AND created_at >= $2 AND created_at < $3`, [userId, start, end]);
	return dailyView(result.rows[0], time);
}

// Reused inside the verified-finish transaction; never open a nested transaction.
async function changeCoins(client, userId, { type, amount, source, referenceId, reason, sessionId = null }, time = Date.now(), allowBlocked = false) {
	if (!['earn', 'spend', 'hold', 'release', 'reverse'].includes(type) || !Number.isSafeInteger(amount) || amount <= 0 ||
		![[source, 64], [referenceId, 128], [reason, 256]].every(([value, max]) => typeof value === 'string' && value.trim() && value.length <= max)) throw new GameError('Invalid ledger operation');
	const user = await client.query(`SELECT coin_balance, coins_held FROM users WHERE id = $1${allowBlocked ? '' : " AND status = 'active'"} FOR UPDATE`, [userId]);
	if (!user.rowCount) throw new GameError('Account unavailable', 403);
	const previous = await client.query('SELECT * FROM coin_ledger WHERE user_id = $1 AND source = $2 AND reference_id = $3 AND change_type = $4', [userId, source, referenceId, type]);
	if (previous.rowCount) {
		const entry = previous.rows[0];
		if (Number(entry.amount) !== amount || entry.reason !== reason || (entry.session_id || null) !== sessionId) throw new GameError('Conflicting ledger retry', 409);
		return entryView(entry);
	}
	// Read the clock after acquiring the account lock, not before waiting on it.
	time = typeof time === 'function' ? time() : time;
	if (type === 'earn') {
		const daily = await dailyEarnings(client, userId, time);
		if (amount > daily.remainingTotal || (['gameplay', 'achievement'].includes(source) && amount > daily.remainingGameplay)) throw new GameError('Daily Coin cap reached', 409);
	}
	const balance = Number(user.rows[0].coin_balance), held = Number(user.rows[0].coins_held);
	const after = balance + (type === 'earn' || type === 'release' ? amount : -amount);
	const heldAfter = held + (type === 'hold' ? amount : type === 'release' ? -amount : 0);
	if (![after, heldAfter].every(value => Number.isSafeInteger(value) && value >= 0)) throw new GameError('Insufficient Coins or balance limit exceeded', 409);
	const inserted = await client.query(`INSERT INTO coin_ledger
		(id, user_id, change_type, amount, balance_before, balance_after, held_before, held_after, source, reference_id, reason, created_at, session_id)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`, [randomUUID(), userId, type, amount, balance, after, held, heldAfter, source, referenceId, reason, new Date(time), sessionId]);
	await client.query('UPDATE users SET coin_balance = $2, coins_held = $3 WHERE id = $1', [userId, after, heldAfter]);
	return entryView(inserted.rows[0]);
}

function entryView(row) {
	return {
		id: row.id, type: row.change_type, amount: Number(row.amount),
		balanceBefore: Number(row.balance_before), balanceAfter: Number(row.balance_after),
		heldBefore: Number(row.held_before), heldAfter: Number(row.held_after),
		source: row.source, referenceId: row.reference_id, reason: row.reason, createdAt: row.created_at
	};
}

function createCoinStore(pool, now = Date.now) {
	return {
		async summary(userId, before = null) {
			const time = now(), { start, end } = dayBounds(time);
			// One statement gives balances and history from the same database snapshot.
			const result = await pool.query(`SELECT u.coin_balance, u.coins_held,
				(SELECT COALESCE(SUM(amount), 0) FROM coin_ledger WHERE user_id = u.id AND change_type = 'earn' AND created_at >= $3 AND created_at < $4) AS total_earned,
				(SELECT COALESCE(SUM(amount), 0) FROM coin_ledger WHERE user_id = u.id AND change_type = 'earn' AND source IN ('gameplay', 'achievement') AND created_at >= $3 AND created_at < $4) AS gameplay_earned,
				COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.created_at DESC, e.id DESC) FROM (
					SELECT * FROM coin_ledger WHERE user_id = u.id AND
					($2::uuid IS NULL OR (created_at, id) < (SELECT created_at, id FROM coin_ledger WHERE id = $2 AND user_id = u.id))
					ORDER BY created_at DESC, id DESC LIMIT 21
				) e), '[]'::jsonb) AS entries FROM users u WHERE u.id = $1 AND u.status = 'active'`, [userId, before, start, end]);
			if (!result.rowCount) throw new GameError('Account unavailable', 403);
			const row = result.rows[0], entries = row.entries.slice(0, 20).map(entryView);
			return { balance: Number(row.coin_balance), held: Number(row.coins_held), issuanceEnabled: rewardPolicy.issuanceEnabled,
				daily: dailyView(row, time), policyStatus: 'awaiting_achievement_payout_policy',
				entries, nextCursor: row.entries.length > 20 ? entries[entries.length - 1].id : null };
		},
		// Trusted backend primitive only. No HTTP route accepts ledger mutations.
		async change(userId, operation) {
			if (['gameplay', 'achievement'].includes(operation.source)) throw new GameError('Game rewards require verified finish');
			const client = await pool.connect();
			try {
				await client.query('BEGIN');
				const entry = await changeCoins(client, userId, operation, now);
				await client.query('COMMIT');
				return entry;
			} catch (error) { await client.query('ROLLBACK'); throw error; }
			finally { client.release(); }
		}
	};
}

module.exports = { createCoinStore, changeCoins, dailyEarnings };
