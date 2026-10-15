const { readdir, readFile } = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');
const { readConfig } = require('./config.cjs');

async function migrate(pool) {
	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		await client.query('SELECT pg_advisory_xact_lock(71380201)');
		await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
		const directory = path.join(__dirname, 'migrations');
		for (const name of (await readdir(directory)).filter(name => /^\d+.*\.sql$/.test(name)).sort()) {
			const existing = await client.query('SELECT name FROM schema_migrations WHERE name = $1', [name]);
			if (existing.rowCount) continue;
			await client.query(await readFile(path.join(directory, name), 'utf8'));
			await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
		}
		await client.query('COMMIT');
	} catch (error) {
		await client.query('ROLLBACK');
		throw error;
	} finally {
		client.release();
	}
}

if (require.main === module) {
	(async () => {
		const config = readConfig();
		if (!config.databaseUrl) throw new Error('DATABASE_URL is required for migrations');
		const pool = new Pool({ connectionString: config.databaseUrl, ssl: config.ssl });
		try { await migrate(pool); console.log('Database migrations applied.'); }
		finally { await pool.end(); }
	})().catch(() => { console.error('Database migration failed. Check environment and database availability.'); process.exitCode = 1; });
}

module.exports = { migrate };