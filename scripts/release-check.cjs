// Read-only release checks. Never submits a real Telegram launch or creates test players.
const { readdir } = require('node:fs/promises');
const path = require('node:path');
const { readConfig } = require('../server/config.cjs');
const { rewardPolicy } = require('../server/reward-policy.cjs');

function parseOrigin(value) {
	const url = new URL(value);
	if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
		(url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw Error('Expected HTTPS or a loopback HTTP origin');
	return url.origin;
}

async function checkPublicEndpoints(base, { appOrigin = base, fetchImpl = fetch } = {}) {
	base = parseOrigin(base); appOrigin = parseOrigin(appOrigin);
	const routes = [
		['/api/health', 200], ['/', 200], ['/js/referrals.js', 200], ['/style/home.css', 200],
		...['auth/me', 'coins', 'daily', 'achievements', 'leaderboards?period=daily', 'referrals'].map(route => ['/api/' + route, 401]),
		...['.env', '.git/config', 'server/config.cjs', 'scripts/preview-tunnel.cjs', 'package.json', 'tests/referrals.test.cjs', '.preview/state.json', '.test-artifacts/private', 'api/referrals/claim', 'api/daily/check-in'].map(route => ['/' + route, 404])
	];
	const results = await Promise.all(routes.map(async ([route, expected]) => {
		const response = await fetchImpl(base + route, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(12000) });
		if (response.status !== expected) throw Error('Unexpected status at ' + route);
		if (route.startsWith('/api/') && response.headers.get('cache-control') !== 'no-store') throw Error('API caching at ' + route);
		if (route === '/api/health' && (await response.json()).status !== 'ok') throw Error('Backend not ready');
		else if (route !== '/api/health') await response.text();
		return { route, status: response.status };
	}));
	for (const [origin, expected] of [[appOrigin, 401], ['https://foreign-origin.invalid', 403]]) {
		const response = await fetchImpl(base + '/api/auth/telegram', { method: 'POST', redirect: 'error',
			headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{"initData":""}', signal: AbortSignal.timeout(12000) });
		if (response.status !== expected) throw Error('Invalid-launch/Origin boundary failed');
		await response.text();
		results.push({ route: '/api/auth/telegram', status: response.status });
	}
	return results;
}

async function checkDatabase(config) {
	if (!config.databaseUrl || !config.botToken || !config.botUsername) throw Error('Required private configuration missing');
	if (rewardPolicy.issuanceEnabled !== false) throw Error('Issuance must remain disabled');
	const { Pool } = require('pg');
	const pool = new Pool({ connectionString: config.databaseUrl, ssl: config.ssl, max: 1, connectionTimeoutMillis: 5000 });
	let client;
	try {
		client = await pool.connect();
		await client.query('BEGIN READ ONLY');
		await client.query("SET LOCAL statement_timeout = '8000ms'");
		const applied = await client.query('SELECT name FROM schema_migrations');
		const names = (await readdir(path.join(__dirname, '../server/migrations'))).filter(name => /^\d+.*\.sql$/.test(name));
		if (names.some(name => !applied.rows.some(row => row.name === name))) throw Error('Pending migration; stop before preview restart');
		await client.query('ROLLBACK');
		return { migrations: names.length, readOnly: true, issuanceEnabled: false };
	} finally { if (client) client.release(); await pool.end(); }
}

if (require.main === module) {
	(async () => {
		const config = readConfig();
		const database = await checkDatabase(config);
		const checks = await checkPublicEndpoints(process.argv[2] || config.origin);
		console.log(JSON.stringify({ database, endpointsPassed: checks.length,
			pending: ['stable Render deployment/backup approval', 'disposable database integration', 'genuine Telegram/device checks'] }));
	})().catch(() => { console.error('Release check failed. No credentials/launch data logged; inspect configuration and endpoint availability.'); process.exitCode = 1; });
}

module.exports = { parseOrigin, checkPublicEndpoints, checkDatabase };