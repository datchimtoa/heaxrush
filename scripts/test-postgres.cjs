// CI-only database shape: never loads .env or falls back to the player database.
const { spawnSync } = require('node:child_process');
const path = require('node:path');

function validateTestDatabase(env) {
	if (!env.TEST_DATABASE_URL || env.DATABASE_URL || env.TELEGRAM_BOT_TOKEN) throw Error('Disposable test configuration required');
	const url = new URL(env.TEST_DATABASE_URL);
	if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
		url.pathname !== '/hexa_rush_ci' || url.username !== 'hexa_rush_ci' || !url.password || url.search || url.hash) throw Error('Disposable loopback database required');
}

if (require.main === module) {
	try {
		validateTestDatabase(process.env);
		const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1',
			path.join(__dirname, '../tests/postgres.test.cjs'), path.join(__dirname, '../tests/referrals-postgres.test.cjs')],
		{ stdio: 'inherit', timeout: 240000 });
		process.exitCode = result.status ?? 1;
	} catch {
		console.error('PostgreSQL integration requires an explicit disposable loopback hexa_rush_ci database, with DATABASE_URL and TELEGRAM_BOT_TOKEN unset. No database URL or credentials logged.');
		process.exitCode = 1;
	}
}

module.exports = { validateTestDatabase };