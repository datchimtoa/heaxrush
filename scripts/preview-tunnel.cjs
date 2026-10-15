// Development-only local process manager. Never changes Telegram settings or player data.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { parseEnv } = require('node:util');
const { setTimeout: delay } = require('node:timers/promises');
const { readConfig } = require('../server/config.cjs');
const { checkDatabase, checkPublicEndpoints } = require('./release-check.cjs');

const root = path.resolve(__dirname, '..'), directory = path.join(root, '.preview');
const envFile = path.join(root, '.env'), stateFile = path.join(directory, 'state.json');

function nextMidnight(now) {
	const date = new Date(now);
	date.setUTCHours(24, 0, 0, 0);
	return date.getTime();
}

function renewalDue(state, now) {
	return !state || state.renewedAt.slice(0, 10) !== new Date(now).toISOString().slice(0, 10);
}

function replaceOrigin(bytes, origin) {
	if (!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(origin)) throw Error('Invalid quick-tunnel origin');
	let count = 0;
	const result = bytes.toString('utf8').replace(/^APP_ORIGIN=[^\r\n]*/gm, () => { count++; return 'APP_ORIGIN=' + origin; });
	if (count !== 1) throw Error('Expected exactly one APP_ORIGIN entry');
	return Buffer.from(result);
}

function identity(pid) {
	try {
		const base = '/proc/' + pid, stat = fs.readFileSync(base + '/stat', 'utf8');
		return { pid: Number(pid), started: stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19],
			cwd: fs.readlinkSync(base + '/cwd'), args: fs.readFileSync(base + '/cmdline').toString().split('\0').filter(Boolean) };
	} catch { return null; }
}

function sameProcess(record) {
	const actual = record && identity(record.pid);
	return Boolean(actual && JSON.stringify(actual) === JSON.stringify(record));
}

function managed(record, kind) {
	if (!sameProcess(record) || record.cwd !== root) return false;
	return kind === 'server' ? record.args.length === 3 && record.args[1] === '--env-file=.env' && record.args[2] === 'server/index.cjs' :
		path.basename(record.args[0]) === 'cloudflared' && record.args[1] === 'tunnel' && record.args.includes('--url') && record.args.includes('http://127.0.0.1:8001');
}

function readState() {
	try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); }
	catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function atomic(file, bytes, mode = 0o600) {
	const temporary = file + '.' + process.pid + '.tmp';
	try { fs.writeFileSync(temporary, bytes, { mode, flag: 'wx' }); fs.renameSync(temporary, file); }
	finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

function lock(name) {
	fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
	const file = path.join(directory, name + '.lock');
	if (fs.existsSync(file)) {
		const previous = JSON.parse(fs.readFileSync(file, 'utf8'));
		if (sameProcess(previous)) throw Error('Preview operation already running');
		fs.unlinkSync(file);
	}
	fs.writeFileSync(file, JSON.stringify(identity(process.pid)), { flag: 'wx', mode: 0o600 });
	return () => fs.unlinkSync(file);
}

function adopt(name, kind) {
	const file = path.join(root, '.test-artifacts', name);
	const record = identity(Number(fs.readFileSync(file, 'utf8').trim()));
	if (!managed(record, kind)) throw Error('Preview identity mismatch; refusing to adopt process');
	return record;
}

async function terminate(record, kind) {
	if (!sameProcess(record)) return;
	if (!managed(record, kind)) throw Error('Process ownership mismatch');
	process.kill(record.pid, 'SIGTERM');
	for (let i = 0; i < 150; i++) { if (!sameProcess(record)) return; await delay(200); }
	throw Error('Preview process did not stop; no forced kill attempted');
}

function launch(command, args, log) {
	const output = fs.openSync(log, 'a', 0o600);
	try {
		const child = spawn(command, args, { cwd: root, stdio: ['ignore', output, output], detached: true });
		return new Promise((resolve, reject) => {
			child.once('error', reject);
			child.once('spawn', () => { child.unref(); resolve(identity(child.pid)); });
		});
	} finally { fs.closeSync(output); }
}

async function until(check, attempts = 30) {
	for (let i = 0; i < attempts; i++) { try { if (await check()) return; } catch {} await delay(1000); }
	throw Error('Preview readiness timeout');
}

async function ready(base) {
	const response = await fetch(base + '/api/health', { signal: AbortSignal.timeout(3000), redirect: 'error' });
	return response.ok && (await response.json()).status === 'ok';
}

async function freePort() {
	const server = net.createServer();
	await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
	const port = server.address().port;
	await new Promise(resolve => server.close(resolve));
	return port;
}

async function renew() {
	const unlock = lock('renew');
	let candidate, previous, oldBytes, newBytes, serverStopped = false, replacement, committed = false;
	try {
		console.log('Renewal preflight: private config, read-only migrations and local health.');
		oldBytes = fs.readFileSync(envFile);
		if ((fs.statSync(envFile).mode & 0o777) !== 0o600) throw Error('Private environment must have mode 0600');
		const config = readConfig(parseEnv(oldBytes.toString()));
		if (config.production || config.port !== 8001 || !config.origin.endsWith('.trycloudflare.com')) throw Error('Development quick preview only');
		await checkDatabase(config);
		if (!await ready('http://127.0.0.1:8001')) throw Error('Local backend unavailable');
		previous = readState() || { server: adopt('telegram-id-referrals-server.pid', 'server'), tunnel: adopt('referral-recheck-tunnel.pid', 'tunnel'), origin: config.origin };
		if (!managed(previous.server, 'server') || previous.origin !== config.origin) throw Error('Preview state/origin mismatch');
		const stamp = new Date().toISOString().replace(/[:.]/g, '-'), port = await freePort();
		const log = path.join(directory, stamp + '-tunnel.log');
		console.log('Starting candidate tunnel; prior origin/server remain active.');
		candidate = await launch('cloudflared', ['tunnel', '--url', 'http://127.0.0.1:8001', '--protocol', 'http2', '--edge-ip-version', '4', '--no-prechecks', '--no-autoupdate', '--metrics', '127.0.0.1:' + port], log);
		let origin;
		await until(async () => {
			const match = fs.readFileSync(log, 'utf8').match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
			if (!match) return false;
			origin = match[0];
			if (origin === config.origin) return false;
			const response = await fetch('http://127.0.0.1:' + port + '/ready', { signal: AbortSignal.timeout(2000) });
			return response.ok && (await response.json()).readyConnections > 0 && await ready(origin);
		});
		await checkPublicEndpoints(origin, { appOrigin: config.origin });
		console.log('Candidate readiness and public boundaries passed; switching preview origin.');
		newBytes = replaceOrigin(oldBytes, origin);
		if (!fs.readFileSync(envFile).equals(oldBytes)) throw Error('Environment changed concurrently');
		atomic(envFile, newBytes);
		console.log('Stopping identified preview before starting replacement.');
		serverStopped = true;
		await terminate(previous.server, 'server');
		console.log('Starting replacement preview.');
		replacement = await launch(process.execPath, ['--env-file=.env', 'server/index.cjs'], path.join(directory, stamp + '-server.log'));
		await until(() => ready('http://127.0.0.1:8001'));
		await until(() => ready(origin));
		await checkPublicEndpoints(origin);
		const obsolete = await fetch(origin + '/api/auth/telegram', { method: 'POST', redirect: 'error', headers: { Origin: config.origin, 'Content-Type': 'application/json' }, body: '{"initData":""}', signal: AbortSignal.timeout(8000) });
		if (obsolete.status !== 403) throw Error('Old origin still accepted after rotation');
		await obsolete.text();
		const state = { origin, renewedAt: new Date().toISOString(), server: replacement, tunnel: candidate, metricsPort: port,
			telegramUrlUpdateRequired: true, serverLog: stamp + '-server.log', tunnelLog: stamp + '-tunnel.log' };
		atomic(stateFile, JSON.stringify(state, null, 2) + '\n'); committed = true;
		atomic(path.join(directory, 'current-url.txt'), origin + '\n');
		// Compatibility files aid manual recovery; state.json is authoritative.
		for (const name of ['telegram-id-referrals-server.pid', 'referral-recheck-server.pid', 'phase2e-tunnel-20261014-server.pid', 'player-copy-server.pid']) atomic(path.join(root, '.test-artifacts', name), String(replacement.pid) + '\n');
		try { await terminate(previous.tunnel, 'tunnel'); } catch { console.error('Old tunnel cleanup needs manual review; new preview remains active.'); }
		console.log('Preview ready: ' + origin + '\nOwner must update Main Mini App/menu URLs in Telegram. No bot settings changed.');
		return state;
	} catch (error) {
		if (!committed) {
			try {
				if (newBytes && fs.readFileSync(envFile).equals(newBytes)) atomic(envFile, oldBytes);
				if (replacement) await terminate(replacement, 'server');
				if (serverStopped && !sameProcess(previous.server)) {
					const restored = await launch(process.execPath, ['--env-file=.env', 'server/index.cjs'], path.join(directory, 'rollback-server.log'));
					if (fs.existsSync(stateFile)) { previous.server = restored; atomic(stateFile, JSON.stringify(previous, null, 2) + '\n'); }
					atomic(path.join(root, '.test-artifacts/telegram-id-referrals-server.pid'), String(restored.pid) + '\n');
					await until(() => ready('http://127.0.0.1:8001'));
				}
				if (candidate) await terminate(candidate, 'tunnel');
			} catch { console.error('Rollback needs manual review. No additional processes were force-killed.'); }
		}
		throw error;
	} finally { unlock(); }
}

async function watch() {
	const unlock = lock('watch');
	let stopping = false;
	const controller = new AbortController();
	const stop = () => { stopping = true; controller.abort(); };
	process.once('SIGTERM', stop); process.once('SIGINT', stop);
	console.log('Daily quick-tunnel watcher active; renewal at 00:00 UTC while host stays running.');
	try {
		while (!stopping) {
			if (renewalDue(readState(), Date.now())) {
				try { await renew(); }
				catch { console.error('Renewal failed; keeping prior preview state and retrying in five minutes.'); await delay(300000, undefined, { signal: controller.signal }); continue; }
			}
			if (!stopping) await delay(Math.min(60000, Math.max(1, nextMidnight(Date.now()) - Date.now())), undefined, { signal: controller.signal });
		}
	} catch (error) { if (error.name !== 'AbortError') throw error; }
	finally { process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop); unlock(); }
}

if (require.main === module) {
	(async () => {
		const command = process.argv[2];
		if (command === 'renew') await renew();
		else if (command === 'watch') await watch();
		else if (command === 'status') {
			const state = readState();
			const watcher = fs.existsSync(path.join(directory, 'watch.lock')) ? JSON.parse(fs.readFileSync(path.join(directory, 'watch.lock'), 'utf8')) : null;
			console.log(JSON.stringify({ origin: state?.origin || null, renewedAt: state?.renewedAt || null,
				serverRunning: managed(state?.server, 'server'), tunnelRunning: managed(state?.tunnel, 'tunnel'),
				watcherRunning: sameProcess(watcher),
				nextRenewal: new Date(nextMidnight(Date.now())).toISOString(), telegramUrlUpdateRequired: Boolean(state?.telegramUrlUpdateRequired) }, null, 2));
		} else throw Error('Use renew, watch or status');
	})().catch(error => { console.error('Preview operation failed (' + (error.code || error.name) + '). Check local health/configuration and .preview logs; no secret values logged.'); process.exitCode = 1; });
}

module.exports = { nextMidnight, renewalDue, replaceOrigin, identity, sameProcess, managed, renew };