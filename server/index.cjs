const { Pool } = require('pg');
const { readConfig } = require('./config.cjs');
const { createStore } = require('./store.cjs');
const { createApp } = require('./app.cjs');
const { migrate } = require('./migrate.cjs');
const { createGameStore } = require('./game-store.cjs');
const { createCoinStore } = require('./coins.cjs');
const { createLeaderboardStore } = require('./leaderboards.cjs');
const { createAchievementStore } = require('./achievements.cjs');
const { createDailyStore } = require('./daily.cjs');
const { createReferralStore } = require('./referrals.cjs');

async function start() {
	const config = readConfig();
	const pool = config.databaseUrl ? new Pool({ connectionString: config.databaseUrl, ssl: config.ssl, max: 10, connectionTimeoutMillis: 5000 }) : null;
	if (pool) {
		pool.on('error', () => console.error('Idle database connection failed.'));
		try { await migrate(pool); }
		catch (error) { await pool.end(); throw error; }
	}
	const referralsEnabled = Boolean(pool && config.botToken && config.botUsername);
	const app = createApp({ config, store: pool ? createStore(pool, Date.now, { referralsEnabled }) : null, games: pool && config.botToken ? createGameStore(pool) : null, coins: pool && config.botToken ? createCoinStore(pool) : null, leaderboards: pool && config.botToken ? createLeaderboardStore(pool) : null, achievements: pool && config.botToken ? createAchievementStore(pool) : null, daily: pool && config.botToken ? createDailyStore(pool) : null, referrals: referralsEnabled ? createReferralStore(pool, config.botUsername) : null });
	const server = app.listen(config.port, '0.0.0.0', () => console.log(`Hexa Rush listening on port ${config.port}. ${pool && config.botToken ? 'Telegram authentication and authoritative sessions configured.' : 'Practice only; Telegram authentication unavailable.'}`));
	async function shutdown() {
		server.close(async () => { if (pool) await pool.end(); });
	}
	process.once('SIGTERM', shutdown);
	process.once('SIGINT', shutdown);
}

start().catch(() => { console.error('Startup failed. Check configuration and PostgreSQL availability.'); process.exitCode = 1; });