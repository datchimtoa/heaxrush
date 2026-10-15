const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { validateTestDatabase } = require('../scripts/test-postgres.cjs');

const root = path.join(__dirname, '..');
const database = 'postgresql://' + 'hexa_rush_ci:local_ci_only@127.0.0.1:5432/hexa_rush_ci';

test('CI integration accepts only an explicit throwaway loopback database, without live configuration', () => {
	for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
		assert.doesNotThrow(() => validateTestDatabase({ TEST_DATABASE_URL: database.replace('127.0.0.1', host) }));
	}
	for (const value of ['', 'not a URL', database.replace('127.0.0.1', 'players.example'),
		database.replace(/\/hexa_rush_ci$/, '/players'), database.replace('hexa_rush_ci:', 'player:'),
		database.replace(':local_ci_only', ''), database.replace('postgresql:', 'https:'),
		database + '?host=players.example', database + '#ignored']) {
		assert.throws(() => validateTestDatabase({ TEST_DATABASE_URL: value }));
	}
	assert.throws(() => validateTestDatabase({ TEST_DATABASE_URL: database, DATABASE_URL: database }));
	assert.throws(() => validateTestDatabase({ TEST_DATABASE_URL: database, TELEGRAM_BOT_TOKEN: 'fixture-only' }));
});

test('integration command fails rather than silently skipping or loading the private .env', () => {
	for (const value of ['', 'https://private-user:private-password@players.example/players']) {
		const result = spawnSync(process.execPath, [path.join(root, 'scripts/test-postgres.cjs')], {
			env: { ...process.env, TEST_DATABASE_URL: value, DATABASE_URL: '', TELEGRAM_BOT_TOKEN: '' },
			encoding: 'utf8', timeout: 8000
		});
		assert.equal(result.status, 1);
		assert.equal(result.stdout, '');
		assert.match(result.stderr, /explicit disposable loopback/);
		assert.doesNotMatch(result.stderr, /private-user|private-password|players\.example|tests skipped/);
	}
});

test('release workflow is read-only, isolated, pinned and never imports production secrets or deploys', () => {
	const workflow = readFileSync(path.join(root, '.github/workflows/release-checks.yml'), 'utf8');
	assert.match(workflow, /permissions:\n  contents: read/);
	assert.match(workflow, /pull_request:/); assert.match(workflow, /workflow_dispatch:/);
	assert.equal((workflow.match(/persist-credentials: false/g) || []).length, 2);
	assert.equal((workflow.match(/uses: actions\/[\w-]+@[a-f0-9]{40}/g) || []).length, 4);
	assert.match(workflow, /image: postgres:16/);
	assert.match(workflow, /POSTGRES_DB: hexa_rush_ci/);
	assert.match(workflow, /pg_isready -U hexa_rush_ci -d hexa_rush_ci/);
	assert.match(workflow, /TEST_DATABASE_URL: postgresql:\/\/hexa_rush_ci:local_ci_only@127\.0\.0\.1:5432\/hexa_rush_ci/);
	assert.match(workflow, /run: npm run test:postgres/);
	assert.doesNotMatch(workflow, /secrets\.|vars\.|pull_request_target|self-hosted|--env-file|render\.com|git push|deployHook|npm start/i);
	const runner = readFileSync(path.join(root, 'scripts/test-postgres.cjs'), 'utf8');
	assert.match(runner, /--test-concurrency=1/);
	assert.match(runner, /tests\/postgres\.test\.cjs/);
	assert.match(runner, /tests\/referrals-postgres\.test\.cjs/);
	assert.doesNotMatch(runner, /dotenv|--env-file|\.\/server\/index|\.\/server\/migrate/);
});