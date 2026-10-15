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
	assert.equal((workflow.match(/persist-credentials: false/g) || []).length, 3);
	assert.match(workflow.split('  postgres:')[0], /with:\n\s+# [^\n]+\n\s+fetch-depth: 2\n\s+persist-credentials: false/,
		'unit whitespace checks need the parent commit so upstream files are not treated as newly added');
	assert.equal((workflow.match(/uses: actions\/[\w-]+@[a-f0-9]{40}/g) || []).length, 7);
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

test('Firefox CI runs both motion modes sequentially on an isolated allowlisted Node service', () => {
	const workflow = readFileSync(path.join(root, '.github/workflows/release-checks.yml'), 'utf8');
	const browser = workflow.split('  browser:')[1].split('  postgres:')[0];
	assert.match(browser, /runs-on: ubuntu-24\.04/);
	assert.match(browser, /timeout-minutes: 15/);
	for (const key of ['DATABASE_URL', 'TEST_DATABASE_URL', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_BOT_USERNAME']) assert.match(browser, new RegExp(key + ": ''"));
	assert.match(browser, /NODE_ENV: test/);
	assert.match(browser, /SMOKE_BASE_URL: http:\/\/127\.0\.0\.1:8001/);
	assert.match(browser, /firefox --version/);
	assert.match(browser, /node server\/index\.cjs > \.test-artifacts\/browser-server\.log/);
	assert.match(browser, /trap 'kill "\$server_pid"[^\n]+wait "\$server_pid"[^\n]+EXIT/);
	assert.match(browser, /npm run test:browser 2>&1 \| tee \.test-artifacts\/browser-normal\.log\n\s+SMOKE_REDUCED_MOTION=1 npm run test:browser 2>&1 \| tee \.test-artifacts\/browser-reduced\.log/);
	assert.doesNotMatch(browser, /continue-on-error|SMOKE_REFERRALS_ONLY|FIREFOX_BIDI_PORT|python.*http\.server|npx|npm start\s/);
	assert.match(browser, /if: always\(\)/);
	assert.match(browser, /retention-days: 7/);
	assert.match(browser, /include-hidden-files: true/);
	const artifactPaths = browser.split('          path: |\n')[1].trim().split('\n').map(line => line.trim());
	assert.deepEqual(artifactPaths, ['.test-artifacts/*.png', '.test-artifacts/browser-normal.log', '.test-artifacts/browser-reduced.log', '.test-artifacts/browser-server.log']);
	const smoke = readFileSync(path.join(root, 'tests/browser-smoke.mjs'), 'utf8');
	assert.match(smoke, /const profile = await mkdtemp\(/, 'each managed browser starts with fresh storage and no stale profile lock');
	assert.match(smoke, /browser\.once\('close', resolve\)/);
	assert.match(smoke, /browser && browser\.pid && browser\.exitCode === null && browser\.signalCode === null/, 'a failed spawn has no owned PID or future close event to wait for');
	assert.match(smoke, /try \{ await closed; \} finally \{ clearTimeout\(timeout\); \}/, 'sequential modes wait for their owned browser to close');
});