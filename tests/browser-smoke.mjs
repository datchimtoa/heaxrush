// Requires Node.js 22+ and Firefox with WebDriver BiDi; no npm dependencies.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createRequire } from 'node:module';

const { createReplay } = createRequire(import.meta.url)('../server/replay.cjs');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = resolve(root, '.test-artifacts');
await mkdir(artifacts, { recursive: true });
const requests = [];
const publicFiles = new Set(['index.html', 'credits.html', 'LICENSE.md', 'README.md', 'CHANGELOG.md', 'favicon.ico']);
const publicDirectories = new Set(['js', 'style', 'vendor', 'images']);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.otf': 'font/otf' };
const server = createServer(async (req, res) => {
	const pathname = new URL(req.url, 'http://localhost').pathname;
	const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
	try {
		assert.ok(file.startsWith(root + sep));
		const relative = file.slice(root.length + 1).split(sep);
		assert.ok(relative.every(part => !part.startsWith('.')));
		assert.ok(publicFiles.has(relative.join('/')) || publicDirectories.has(relative[0]));
		const data = await readFile(file);
		requests.push({ pathname, status: 200 });
		res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
		res.end(data);
	} catch {
		requests.push({ pathname, status: 404 });
		res.writeHead(404).end();
	}
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = process.env.SMOKE_BASE_URL || `http://127.0.0.1:${server.address().port}`;
let browser;
let socket;
let nextId = 0;
const pending = new Map();
const errors = [];
const external = [];
const reducedMotionTest = process.env.SMOKE_REDUCED_MOTION === '1';

async function connect(address) {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(address);
		const timer = setTimeout(() => { ws.close(); reject(Error('Firefox connection timeout')); }, 2000);
		ws.onopen = () => { clearTimeout(timer); resolve(ws); };
		ws.onerror = () => { clearTimeout(timer); reject(Error('Firefox connection failed')); };
	});
}
function command(method, params = {}) {
	return new Promise((resolve, reject) => {
		const id = ++nextId;
		const timeout = ['session.new', 'browsingContext.navigate', 'script.evaluate'].includes(method) ? 60000 : 15000;
		const timer = setTimeout(() => { pending.delete(id); reject(Error(method + ' timed out')); }, timeout);
		pending.set(id, { resolve, reject, timer });
		socket.send(JSON.stringify({ id, method, params }));
	});
}

async function runSmoke() {
try {
	const port = Number(process.env.FIREFOX_BIDI_PORT || 9235);
	if (!process.env.FIREFOX_BIDI_PORT) {
		const profile = resolve(artifacts, reducedMotionTest ? 'browser-reduced-motion-profile' : 'browser-profile');
		await mkdir(profile, { recursive: true });
		if (reducedMotionTest) await writeFile(resolve(profile, 'user.js'), 'user_pref("ui.prefersReducedMotion", 1);\n');
		browser = spawn(process.env.FIREFOX_BIN || 'firefox', ['--headless', '--no-remote', '--profile', profile, '--remote-debugging-port', String(port), 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
		browser.on('error', error => errors.push(error.message));
		browser.stderr.on('data', data => process.stderr.write(data));
	}
	for (let attempt = 0; attempt < 30 && !socket; attempt++) {
		try { socket = await connect(`ws://127.0.0.1:${port}/session`); }
		catch { await delay(500); }
	}
	assert.ok(socket, 'Firefox WebDriver BiDi endpoint unavailable');
	socket.onmessage = event => {
		const message = JSON.parse(event.data);
		if (pending.has(message.id)) {
			const request = pending.get(message.id);
			clearTimeout(request.timer);
			pending.delete(message.id);
			if (message.type === 'error') request.reject(Error(message.error + ': ' + message.message));
			else request.resolve(message.result);
		}
		if (message.method === 'log.entryAdded' && message.params.level === 'error') errors.push(message.params.text);
		if (message.method === 'network.beforeRequestSent' && /^https?:/.test(message.params.request.url) && !message.params.request.url.startsWith(url)) external.push(message.params.request.url);
	};
	try { await command('session.new', { capabilities: {} }); }
	catch (error) {
		if (!error.message.includes('already')) throw error;
	}
	await command('session.subscribe', { events: ['log.entryAdded', 'network.beforeRequestSent'] });
	const tree = await command('browsingContext.getTree');
	const context = tree.contexts[0].context;
	async function evaluate(expression) {
		const result = await command('script.evaluate', { expression: `JSON.stringify((() => { ${expression} })())`, target: { context }, awaitPromise: false });
		assert.equal(result.type, 'success', JSON.stringify(result));
		return JSON.parse(result.result.value || 'null');
	}
	async function waitFor(expression, message) {
		const deadline = Date.now() + 5000;
		while (Date.now() < deadline) {
			if (await evaluate('return ' + expression + ';')) return;
			await delay(50);
		}
		assert.fail(message);
	}
	async function screenshot(name) {
		const image = await command('browsingContext.captureScreenshot', { context });
		await writeFile(resolve(artifacts, name + '.png'), Buffer.from(image.data, 'base64'));
	}
	async function click(selector) {
		const point = await evaluate(`
			const element = document.querySelector(${JSON.stringify(selector)});
			element.scrollIntoView({ block: 'center', behavior: 'instant' });
			const rect = element.getBoundingClientRect();
			return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
		`);
		await command('input.performActions', { context, actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [{ type: 'pointerMove', ...point }, { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 }] }] });
		// Layout assertions sample the settled destination, not its entrance frame.
		await evaluate('document.querySelectorAll("[data-home-panel]").forEach(panel => (panel.querySelector(".menu-sheet") || panel).getAnimations().forEach(animation => animation.finish())); return null;');
	}
	async function openProfile() { await click('#openProfile'); }
	async function openOptions() { await openProfile(); await click('#openSettings'); }
	async function openRecords() { await openProfile(); await click('[data-home-panel="profile"] [data-home-tab="activity"]'); }
	async function checkReferrals() {
		await evaluate(`
			showHomeTab('home', false);
			window.referralPreviousFetch = window.fetch; window.referralPreviousAccount = playerAccount;
			window.referralPreviousShare = Object.getOwnPropertyDescriptor(navigator, 'share'); window.referralFixtureShares = [];
			window.referralPreviousClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard'); window.referralFixtureCopies = [];
			window.referralPreviousViewport = window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.viewportStableHeight;
			Object.defineProperty(navigator, 'share', { configurable: true, value: async data => { referralFixtureShares.push(data); } });
			Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { referralFixtureCopies.push(value); } } });
			window.referralBefore = JSON.stringify([MainHex.ct, score, playerRecords, playerPreferences]);
			window.referralFixtureMode = 'no-link'; window.referralFixtureRequests = []; window.referralFixtureCreated = false;
			window.referralFixtureLink = 'https://t.me/hexarushbot?startapp=ref_67890';
			window.fetch = async (route, options = {}) => {
				referralFixtureRequests.push({ route, method: options.method || 'GET', body: options.body || null, cache: options.cache, credentials: options.credentials });
				if (referralFixtureMode === 'error') throw Error('fixture offline');
				const inviteLink = referralFixtureLink;
				if (route === '/api/referrals/code') { referralFixtureCreated = true; return new Response(JSON.stringify({ inviteLink })); }
				const data = { rulesVersion: HexaSessionRules.version, rewardsEnabled: false, targetGames: 3,
					inviteLink: referralFixtureCreated ? inviteLink : null, invitedAccounts: referralFixtureMode === 'populated' ? 5 : 0, reachedAccounts: referralFixtureMode === 'populated' ? 2 : 0 };
				if (referralFixtureMode === 'delayed') return new Promise(resolve => { window.releaseReferralFixture = () => resolve(new Response(JSON.stringify(data))); });
				return new Response(JSON.stringify(data));
			};
			setPlayerAccount('connected', { id: 'referral-fixture', username: 'fixture_player' }); return null;
		`);
		await click('#appNavigation [data-home-tab="referrals"]');
		await waitFor('!document.querySelector("#referralRefresh").disabled', 'referral no-link fixture did not settle');
		assert.equal(await evaluate('return !document.querySelector("#referralCreate").hidden && document.querySelector("#referralInvite").hidden && referralFixtureRequests.every(r => r.method === "GET");'), true, 'opening Referrals never creates a code');
		await command('browsingContext.setViewport', { context, viewport: { width: 390, height: 844 }, devicePixelRatio: 1 });
		await screenshot('referrals-' + (reducedMotionTest ? 'reduced-' : '') + 'create-fixture');
		await click('#referralCreate');
		await waitFor('!document.querySelector("#referralInvite").hidden', 'explicit invite creation did not settle');
		await evaluate('referralFixtureMode = "populated"; return null;');
		for (const [width, height] of [[390, 844], [320, 568], [568, 320]]) {
			await command('browsingContext.setViewport', { context, viewport: { width, height }, devicePixelRatio: 1 });
			// Transport fixtures keep native stable height in sync with this test's
			// viewport; otherwise a prior 760px Telegram fixture covers a 568px screen.
			await evaluate(`if (window.Telegram && window.Telegram.WebApp) { window.Telegram.WebApp.viewportStableHeight = ${height}; if (window.smokeTelegramEvents && smokeTelegramEvents.viewportChanged) smokeTelegramEvents.viewportChanged({ isStateStable: true }); } return null;`);
			await click('#referralRefresh'); await waitFor('!document.querySelector("#referralRefresh").disabled', 'referral progress did not settle');
			assert.equal(await evaluate(`
				const panel = document.querySelector('[data-home-panel=referrals]'), nav = document.querySelector('#appNavigation').getBoundingClientRect();
				return panel.scrollWidth <= innerWidth && panel.getBoundingClientRect().bottom <= nav.top + 1 &&
					document.querySelector('#referralInvited').textContent === '5' && document.querySelector('#referralReached').textContent === '2' &&
					document.querySelector('#referralLink').readOnly && document.querySelector('#referralLink').value === 'https://t.me/hexarushbot?startapp=ref_67890' &&
					document.querySelector('#referralLink').scrollWidth <= document.querySelector('#referralLink').clientWidth + 1 &&
					document.querySelector('#referralLink').scrollHeight <= document.querySelector('#referralLink').clientHeight + 1 &&
					panel.textContent.includes('Referral rewards are not active') && panel.textContent.includes('FRIENDS JOINED') &&
					panel.textContent.includes('PLAYED 3 GAMES') && !/verified|entitlement|unflagged|backfill|attribution|aggregate counts/i.test(panel.textContent) && panel.querySelectorAll('textarea').length === 1;
			`), true, 'responsive aggregate-only referral display at ' + width + 'x' + height);
			assert.equal(await evaluate(`
				const panel = document.querySelector('[data-home-panel=referrals]'), bounds = panel.getBoundingClientRect();
				return Array.from(panel.querySelectorAll('.referral-hero, #referralStatus, #referralLink, #referralShare, #referralCopy, #referralSummary, .referral-steps, .referral-reward-note')).every(element => {
					element.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = element.getBoundingClientRect();
					return r.top >= bounds.top - 1 && r.bottom <= bounds.bottom + 1 && r.left >= bounds.left && r.right <= bounds.right;
				}) && ['referralShare', 'referralCopy', 'referralRefresh'].every(id => {
					const r = document.getElementById(id).getBoundingClientRect(); return r.height >= 44 && r.width >= 44;
				}) && getComputedStyle(document.querySelector('#referralShare')).backgroundImage.includes('gradient') &&
					document.querySelector('#referralLink').labels.length === 1;
			`), true, 'invite, stats, steps and rewards notice are reachable without navigation overlap; actions have touch-sized targets');
			await click('#referralCopy');
			assert.equal(await evaluate('return referralFixtureCopies.at(-1);'), 'https://t.me/hexarushbot?startapp=ref_67890', 'Copy uses the complete current-bot invite');
			await waitFor('document.querySelector("#referralStatus").textContent.includes("copied")', 'copy confirmation did not appear');
			await click('#referralShare');
			assert.equal(await evaluate('return referralFixtureShares.at(-1).url;'), 'https://t.me/hexarushbot?startapp=ref_67890', 'Share uses the complete Telegram-ID invite');
			assert.equal(await evaluate('return document.querySelector("#referralShare").getBoundingClientRect().bottom <= document.querySelector("#appNavigation").getBoundingClientRect().top + 1;'), true);
			await evaluate('document.querySelector("[data-home-panel=referrals]").scrollTop = 0; return null;');
			if (width === 320) assert.equal(await evaluate('return document.querySelector("#referralShare").getBoundingClientRect().bottom <= document.querySelector("[data-home-panel=referrals]").getBoundingClientRect().bottom;'), true, 'small-phone primary invite action is visible without scrolling');
			await screenshot('referrals-' + (reducedMotionTest ? 'reduced-' : '') + width + 'x' + height + '-fixture');
			if (width === 320) {
				await evaluate('referralFixtureLink = "https://t.me/" + "a".repeat(29) + "bot?startapp=ref_9007199254740991"; return null;');
				await click('#referralRefresh'); await waitFor('!document.querySelector("#referralRefresh").disabled', 'long invite did not settle');
				assert.equal(await evaluate('const field = document.querySelector("#referralLink"); return field.value === referralFixtureLink && field.scrollHeight <= field.clientHeight + 1 && field.scrollWidth <= field.clientWidth + 1;'), true, 'longest bot username and safe numeric ID remain fully visible');
				await click('#referralCopy'); await click('#referralShare');
				assert.equal(await evaluate('return referralFixtureCopies.at(-1) === referralFixtureLink && referralFixtureShares.at(-1).url === referralFixtureLink;'), true, 'long invite Copy/Share are never truncated');
				await evaluate('referralFixtureLink = "https://t.me/hexarushbot?startapp=ref_67890"; return null;');
			}
		}
		await evaluate('referralFixtureMode = "error"; return null;'); await click('#referralRefresh');
		await waitFor('!document.querySelector("#referralRefresh").disabled', 'referral error did not settle');
		assert.equal(await evaluate('return document.querySelector("#referralSummary").hidden && document.querySelector("#referralLink").value === "" && document.querySelector("#referralStatus").textContent.includes("retry");'), true);
		await screenshot('referrals-' + (reducedMotionTest ? 'reduced-' : '') + 'error-fixture');
		await evaluate('referralFixtureMode = "delayed"; window.referralPending = loadReferrals(false); setPlayerAccount("guest"); releaseReferralFixture(); return null;');
		await waitFor('document.querySelector("#referralRefresh").hidden', 'referral guest reset did not settle');
		assert.equal(await evaluate('return document.querySelector("#referralLink").value === "" && document.querySelector("#referralInvited").textContent === "" && document.querySelector("#referralStatus").textContent.includes("Telegram");'), true);
		await command('browsingContext.setViewport', { context, viewport: { width: 390, height: 844 }, devicePixelRatio: 1 });
		await evaluate('if (window.Telegram && window.Telegram.WebApp) { window.Telegram.WebApp.viewportStableHeight = 844; if (window.smokeTelegramEvents && smokeTelegramEvents.viewportChanged) smokeTelegramEvents.viewportChanged({ isStateStable: true }); } document.querySelector("[data-home-panel=referrals]").scrollTop = 0; return null;');
		await screenshot('referrals-' + (reducedMotionTest ? 'reduced-' : '') + 'guest-fixture');
		assert.equal(await evaluate(`return referralFixtureRequests.every(r => r.credentials === 'same-origin' && r.cache === 'no-store' &&
			(r.route === '/api/referrals' ? r.method === 'GET' && r.body === null : r.route === '/api/referrals/code' && r.method === 'POST' && r.body === '{}')) &&
			referralBefore === JSON.stringify([MainHex.ct, score, playerRecords, playerPreferences]);`), true, 'only invite-code write; no claims, practice imports or game changes');
		await click('[data-home-panel="referrals"] [data-home-tab="home"]');
		await evaluate('window.fetch = referralPreviousFetch; if (referralPreviousShare) Object.defineProperty(navigator, "share", referralPreviousShare); else delete navigator.share; if (referralPreviousClipboard) Object.defineProperty(navigator, "clipboard", referralPreviousClipboard); else delete navigator.clipboard; if (window.Telegram && window.Telegram.WebApp) { window.Telegram.WebApp.viewportStableHeight = referralPreviousViewport; if (window.smokeTelegramEvents && smokeTelegramEvents.viewportChanged) smokeTelegramEvents.viewportChanged({ isStateStable: true }); } setPlayerAccount(referralPreviousAccount.state, referralPreviousAccount.user, referralPreviousAccount.reason); return null;');
		console.log('PASS: referral creation and owner-only progress transport fixtures, responsive copy/share controls, private aggregates, error/guest/stale states and no rewards.');
	}
	async function checkDaily() {
		await evaluate(`
			window.dailyPreviousFetch = window.fetch; window.dailyPreviousAccount = playerAccount;
			window.dailyBefore = JSON.stringify([MainHex.ct, score, playerRecords, playerPreferences]);
			window.dailyFixtureMode = 'populated'; window.dailyFixtureRequests = [];
			window.fetch = async (route, options) => {
				dailyFixtureRequests.push({ route, credentials: options.credentials, cache: options.cache, body: options.body || null });
				if (dailyFixtureMode === 'error') throw Error('fixture offline');
				const day = dailyFixtureMode === 'newday' ? '2026-10-14' : '2026-10-13';
				const zero = ['zero', 'newday'].includes(dailyFixtureMode);
				const data = { rulesVersion: HexaSessionRules.version, rewardsEnabled: false, timezone: 'UTC', day,
					startsAt: day + 'T00:00:00.000Z', endsAt: (day === '2026-10-13' ? '2026-10-14' : '2026-10-15') + 'T00:00:00.000Z',
					serverTime: day + (dailyFixtureMode === 'midnight' ? 'T23:59:59.600Z' : 'T12:00:00.000Z'),
					quests: [3, 800, 3].map((target, i) => ({ code: ['play_3', 'score_800', 'combo_3'][i], title: ['Find your flow', 'Aim higher', 'Keep the chain'][i],
						description: ['Finish 3 games today.', 'Score 800 points in one game today.', 'Reach chain level 3 today for 2× points.'][i],
						metric: ['games', 'score', 'chain'][i], target, progress: zero ? 0 : [2, 799.5, 3][i], reached: !zero && i === 2 })),
					streak: zero ? { days: 0, lastLaunchDay: null, checkedInToday: false } : { days: 5, lastLaunchDay: day, checkedInToday: true } };
				if (dailyFixtureMode === 'midnight') dailyFixtureMode = 'newday';
				if (dailyFixtureMode === 'delayed') return new Promise(resolve => { window.releaseDailyFixture = () => resolve(new Response(JSON.stringify(data))); });
				return new Response(JSON.stringify(data));
			};
			showHomeTab('home', false); selectTasksSection('daily'); setPlayerAccount('connected', { id: 'daily-fixture', username: 'fixture_player' }); return null;
		`);
		for (const [width, height] of [[390, 844], [320, 568], [568, 320]]) {
			await command('browsingContext.setViewport', { context, viewport: { width, height }, devicePixelRatio: 1 });
			await click('#appNavigation [data-home-tab="tasks"]');
			await waitFor('!document.querySelector("#dailyRefresh").disabled', 'daily fixture did not settle');
			assert.equal(await evaluate(`
				const panel = document.querySelector('[data-home-panel=tasks]');
				return document.activeElement.id === 'tasksTitle' && panel.scrollWidth <= innerWidth && tasksSection === 'daily' &&
					!document.querySelector('#dailyPanel').hidden && document.querySelector('#achievementPanel').hidden &&
					document.querySelectorAll('#dailyEntries li').length === 3 && document.querySelectorAll('#dailyEntries progress[aria-label]').length === 3 &&
					document.querySelector('#dailyEntries').textContent.includes('2 / 3 games') && document.querySelector('#dailyEntries').textContent.includes('799.5 / 800 points') &&
					document.querySelector('#dailyEntries').textContent.includes('for 2× points') && document.querySelector('#dailyStreakCount').textContent === '5 days' &&
					document.querySelector('#dailyDay').textContent.includes('00:00 UTC') &&
					(!matchMedia('(prefers-reduced-motion: reduce)').matches || panel.querySelector('.menu-sheet').getAnimations().length === 0);
			`), true, 'daily progress and UTC streak fit at ' + width + 'x' + height);
			await screenshot('phase2c-' + (reducedMotionTest ? 'reduced-' : '') + 'daily-' + width + 'x' + height + '-fixture');
			assert.equal(await evaluate(`
				const panel = document.querySelector('[data-home-panel=tasks]').getBoundingClientRect();
				const nav = document.querySelector('#appNavigation').getBoundingClientRect();
				return Array.from(document.querySelectorAll('#dailyEntries li, #dailyStreak, #dailyPanel .achievement-note, #dailyRefresh, .daily-reward-notice, [data-tasks-section]')).every(element => {
					element.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = element.getBoundingClientRect();
					return r.top >= panel.top && r.bottom <= panel.bottom && r.bottom < nav.top && r.left >= panel.left && r.right <= panel.right;
				});
			`), true, 'quests, streak, policy notice and section/refresh controls remain reachable above navigation');
			await evaluate('document.querySelector("#dailyStreak").scrollIntoView({ block: "center", behavior: "instant" }); return null;');
			await screenshot('phase2c-' + (reducedMotionTest ? 'reduced-' : '') + 'streak-' + width + 'x' + height + '-fixture');
		}
		await command('browsingContext.setViewport', { context, viewport: { width: 390, height: 844 }, devicePixelRatio: 1 });
		await evaluate('Object.defineProperty(document, "hidden", { configurable: true, value: true }); document.dispatchEvent(new Event("visibilitychange")); return null;');
		assert.equal(await evaluate('return dailyResetTimer === null && document.querySelector("#dailyEntries").children.length === 0 && document.querySelector("#dailyStreakCount").textContent === "";'), true, 'hidden document clears daily progress and timer');
		await evaluate('delete document.hidden; document.dispatchEvent(new Event("visibilitychange")); return null;');
		await waitFor('document.querySelector("#dailyEntries").children.length === 3 && !document.querySelector("#dailyRefresh").disabled', 'visible Daily section did not refresh');
		await evaluate('dailyFixtureMode = "zero"; setPlayerAccount("connected", { id: "new-daily-fixture" }); return null;');
		await waitFor('!document.querySelector("#dailyRefresh").disabled', 'new account daily progress did not settle');
		assert.equal(await evaluate('return document.querySelectorAll("#dailyEntries .achievement-reached").length === 0 && document.querySelector("#dailyStreakCount").textContent === "0 days";'), true);
		await screenshot('phase2c-' + (reducedMotionTest ? 'reduced-' : '') + 'daily-zero-fixture');
		await evaluate('dailyFixtureMode = "midnight"; return null;'); await click('#dailyRefresh');
		await waitFor('document.querySelector("#dailyDay").textContent.includes("2026-10-14")', 'server-relative UTC midnight reset did not reload next-day progress');
		assert.equal(await evaluate('return document.querySelectorAll("#dailyEntries .achievement-reached").length === 0 && document.querySelector("#dailyStreakCount").textContent === "0 days";'), true);
		await evaluate('dailyFixtureMode = "error"; return null;'); await click('#dailyRefresh');
		await waitFor('!document.querySelector("#dailyRefresh").disabled', 'daily fixture failure did not settle');
		assert.equal(await evaluate('return document.querySelector("#dailyEntries").children.length === 0 && document.querySelector("#dailyStreak").hidden && document.querySelector("#dailyStatus").textContent.includes("retry");'), true);
		await screenshot('phase2c-' + (reducedMotionTest ? 'reduced-' : '') + 'daily-error-fixture');
		await evaluate('dailyFixtureMode = "delayed"; window.dailyPending = loadDailyProgress(); setPlayerAccount("guest"); releaseDailyFixture(); return null;');
		await waitFor('document.querySelector("#dailyRefresh").hidden', 'guest daily display did not reset');
		assert.equal(await evaluate('return document.querySelector("#dailyEntries").children.length === 0 && document.querySelector("#dailyStreakCount").textContent === "" && document.querySelector("#dailyStatus").textContent.includes("Telegram");'), true);
		await click('[data-tasks-section="achievements"]');
		assert.equal(await evaluate('return document.querySelector("#dailyPanel").hidden && !document.querySelector("#achievementPanel").hidden && dailyResetTimer === null;'), true);
		await click('[data-tasks-section="daily"]');
		assert.equal(await evaluate(`
			return dailyFixtureRequests.every(request => request.route === '/api/daily' && request.credentials === 'same-origin' && request.cache === 'no-store' && request.body === null) &&
				dailyBefore === JSON.stringify([MainHex.ct, score, playerRecords, playerPreferences]) && document.querySelector('#dailyEntries button') === null;
		`), true, 'daily progress has no claim/write transport, local history changes or gameplay mutations');
		await click('[data-home-panel="tasks"] [data-home-tab="home"]');
		assert.equal(await evaluate('return activeHomeTab === "home" && dailyResetTimer === null;'), true);
		await evaluate('window.fetch = dailyPreviousFetch; setPlayerAccount(dailyPreviousAccount.state, dailyPreviousAccount.user, dailyPreviousAccount.reason); return null;');
		console.log('PASS: daily/streak read-only transport fixtures, exact UTC reset, accessible responsive sections, reached/zero/error/guest states, account isolation and no rewards.');
	}
	async function checkAchievements() {
		await evaluate(`
			window.achievementPreviousFetch = window.fetch;
			window.achievementPreviousAccount = playerAccount;
			window.achievementBefore = JSON.stringify([MainHex.ct, score, playerRecords, playerPreferences]);
			window.achievementFixtureMode = 'populated'; window.achievementFixtureRequests = [];
			window.fetch = async (route, options) => {
				achievementFixtureRequests.push({ route, credentials: options.credentials, cache: options.cache, body: options.body || null });
				if (achievementFixtureMode === 'error') throw Error('fixture offline');
				const zero = achievementFixtureMode === 'zero';
				const data = { rulesVersion: HexaSessionRules.version, rewardsEnabled: false, milestones: [500, 1000, 2000, 4].map((target, i) => ({
					code: ['score_500', 'score_1000', 'score_2000', 'combo_4'][i],
					title: ['Finding your rhythm', 'Rush regular', 'Hexa master', 'Chain reaction'][i],
					description: i < 3 ? 'Score ' + target.toLocaleString() + ' points in one game.' : 'Reach chain level 4 in one game for 2.5× points.',
					metric: i < 3 ? 'score' : 'chain', target, progress: zero ? 0 : Math.min(i < 3 ? 750.5 : 4, target), reached: !zero && (i === 0 || i === 3)
				})) };
				if (achievementFixtureMode === 'delayed') return new Promise(resolve => { window.releaseAchievementFixture = () => resolve(new Response(JSON.stringify(data))); });
				return new Response(JSON.stringify(data));
			};
			showHomeTab('home', false); selectTasksSection('achievements'); setPlayerAccount('connected', { id: 'achievement-fixture', username: 'fixture_player' }); return null;
		`);
		for (const [width, height] of [[390, 844], [320, 568], [568, 320]]) {
			await command('browsingContext.setViewport', { context, viewport: { width, height }, devicePixelRatio: 1 });
			await click('#appNavigation [data-home-tab="tasks"]');
			await waitFor('!document.querySelector("#achievementRefresh").disabled', 'achievement fixture did not settle');
			assert.equal(await evaluate(`
				const panel = document.querySelector('[data-home-panel=tasks]');
				return document.activeElement.id === 'tasksTitle' && panel.scrollWidth <= innerWidth &&
					document.querySelector('#appNavigation [aria-current=page]').dataset.homeTab === 'tasks' &&
					document.querySelectorAll('#achievementEntries li').length === 4 && document.querySelectorAll('.achievement-reached').length === 2 &&
					document.querySelector('#achievementEntries').textContent.includes('750.5 / 1,000 points') &&
					document.querySelectorAll('#achievementEntries progress[aria-label]').length === 4 &&
					(!matchMedia('(prefers-reduced-motion: reduce)').matches || panel.querySelector('.menu-sheet').getAnimations().length === 0);
			`), true, 'verified achievement progress fits at ' + width + 'x' + height);
			await screenshot('achievements-' + (reducedMotionTest ? 'reduced-' : '') + width + 'x' + height + '-fixture');
			assert.equal(await evaluate(`
				const panel = document.querySelector('[data-home-panel=tasks]').getBoundingClientRect();
				const nav = document.querySelector('#appNavigation').getBoundingClientRect();
				return Array.from(document.querySelectorAll('#achievementEntries li, #achievementPanel .achievement-note, #achievementRefresh')).every(element => {
					element.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = element.getBoundingClientRect();
					return r.top >= panel.top && r.bottom <= panel.bottom && r.bottom < nav.top && r.left >= panel.left && r.right <= panel.right;
				});
			`), true, 'each milestone, disclosure and refresh is reachable above navigation');
		}
		await command('browsingContext.setViewport', { context, viewport: { width: 390, height: 844 }, devicePixelRatio: 1 });
		await evaluate('achievementFixtureMode = "zero"; setPlayerAccount("connected", { id: "new-achievement-fixture" }); return null;');
		await waitFor('!document.querySelector("#achievementRefresh").disabled', 'new account achievements did not settle');
		assert.equal(await evaluate('return document.querySelectorAll(".achievement-reached").length === 0 && document.querySelector("#achievementEntries").textContent.includes("0 / 500 points");'), true);
		await screenshot('achievements-' + (reducedMotionTest ? 'reduced-' : '') + 'zero-fixture');
		await evaluate('achievementFixtureMode = "error"; return null;'); await click('#achievementRefresh');
		await waitFor('!document.querySelector("#achievementRefresh").disabled', 'achievement failure did not settle');
		assert.equal(await evaluate('return document.querySelector("#achievementEntries").children.length === 0 && document.querySelector("#achievementStatus").textContent.includes("retry");'), true);
		await screenshot('achievements-' + (reducedMotionTest ? 'reduced-' : '') + 'error-fixture');
		await evaluate('achievementFixtureMode = "delayed"; window.achievementPending = loadAchievements(); setPlayerAccount("guest"); releaseAchievementFixture(); return null;');
		await waitFor('document.querySelector("#achievementRefresh").hidden', 'guest achievements did not reset');
		assert.equal(await evaluate('return document.querySelector("#achievementEntries").children.length === 0 && document.querySelector("#achievementStatus").textContent.includes("Telegram");'), true, 'late account response cannot restore old progress');
		assert.equal(await evaluate(`
			return achievementFixtureRequests.every(request => request.route === '/api/achievements' && request.credentials === 'same-origin' && request.cache === 'no-store' && request.body === null) &&
				achievementBefore === JSON.stringify([MainHex.ct, score, playerRecords, playerPreferences]) && document.querySelector('#achievementEntries button') === null;
		`), true, 'progress uses only read-only transport and leaves gameplay/storage/rewards alone');
		await click('[data-home-panel="tasks"] [data-home-tab="home"]');
		assert.equal(await evaluate('return activeHomeTab === "home";'), true);
		await evaluate('window.fetch = achievementPreviousFetch; setPlayerAccount(achievementPreviousAccount.state, achievementPreviousAccount.user, achievementPreviousAccount.reason); return null;');
		console.log('PASS: read-only achievements transport fixtures, responsive accessible progress, reached/zero/error/guest states, account isolation and no rewards.');
	}
	await command('browsingContext.setViewport', { context, viewport: { width: 1280, height: 900 }, devicePixelRatio: 1 });
	await command('browsingContext.navigate', { context, url, wait: 'complete' });
	await evaluate('for (const key of [highScoreStorageKey, playerStorageKey, preferencesStorageKey]) localStorage.removeItem(key); return null;');
	await command('browsingContext.navigate', { context, url, wait: 'complete' });
	await delay(700);
	const start = await evaluate('return { title: document.title, state: gameState, colors: colors.length, preview: MainHex.blocks.flat().length, play: !document.querySelector("#startScreen").hidden };');
	assert.match(start.title, /Hexa Rush/);
	assert.equal(await evaluate('return document.querySelector("#accountStatus, #titleMode, #homeHelp, #openSideBar, .title-hint") === null;'), true, 'title and HUD have no repeated help or connection labels');
	assert.deepEqual({ ...start, title: undefined }, { title: undefined, state: 0, colors: 5, preview: 0, play: true });
	assert.equal(await evaluate('return document.querySelector("#homeRuns").textContent;'), '0');
	assert.equal(await evaluate('return document.querySelector(".home-hero") === null && document.querySelector("#aboutGame").open === false;'), true, 'title remains game-first with no dashboard or legal banner');
	assert.deepEqual(await evaluate('return Array.from(document.querySelectorAll("#appNavigation button span"), label => label.textContent);'), ['Home', 'Tasks', 'Referrals', 'Wallet', 'Profile']);
	assert.equal(await evaluate('return document.querySelector("[data-home-panel=home] #openSettings") === null && document.querySelector("#openLeaderboards").textContent === "Leaderboards";'), true);
	assert.equal(await evaluate('return getComputedStyle(document.body).backgroundColor;'), 'rgb(48, 20, 65)', 'plum canvas surround matches native chrome');
	const iconColors = await evaluate('return Array.from(document.querySelectorAll("#appNavigation button > svg"), svg => getComputedStyle(svg).fill);');
	assert.equal(new Set(iconColors).size, 5, 'each destination has a different filled icon color');
	assert.ok(iconColors.every(color => color !== 'none'));
	assert.equal(await evaluate('return document.querySelectorAll("#openProfile svg circle").length > 0 && document.querySelectorAll(".feature-symbol svg").length === 4 && document.querySelectorAll("[data-home-panel=profile] .menu-symbol svg").length === 3;'), true, 'local smiley, feature and Profile action artwork');
	if (process.env.SMOKE_REFERRALS_ONLY === '1') {
		await checkReferrals();
		assert.deepEqual(errors, []); assert.deepEqual(external, []);
		return;
	}
	if (reducedMotionTest) {
		for (const [width, height] of [[390, 844], [320, 568], [568, 320]]) {
			await command('browsingContext.setViewport', { context, viewport: { width, height }, devicePixelRatio: 1 });
			assert.equal(await evaluate(`
				const before = JSON.stringify([MainHex.ct, score, playerRecords]);
				const valid = ['home', 'leaderboards', 'tasks', 'referrals', 'wallet', 'profile', 'settings', 'activity', 'home'].every(tab => {
					showHomeTab(tab, true);
					const panel = document.querySelector('[data-home-panel="' + tab + '"]');
					const surface = panel.querySelector('.menu-sheet') || panel;
					return !panel.hidden && surface.getAnimations().length === 0 && getComputedStyle(surface).transform === 'none';
				});
				showHomeTab('profile', true);
				return valid && matchMedia('(prefers-reduced-motion: reduce)').matches && document.querySelector('#openProfile svg').getAnimations().length === 0 && getComputedStyle(document.querySelector('#openProfile')).transitionDuration === '0s' && before === JSON.stringify([MainHex.ct, score, playerRecords]);
			`), true, 'real reduced-motion preference disables panel/icon motion at ' + width + 'x' + height);
		}
		await evaluate(`
			window.reducedFixtureFetch = window.fetch;
			setPlayerAccount('connected', { id: 'reduced-fixture', username: 'fixture_player' });
			window.fetch = async (route) => {
				const period = new URL(route, location.origin).searchParams.get('period');
				return new Response(JSON.stringify({ period, timezone: 'UTC', rewardsEnabled: false, limit: period === 'daily' ? 50 : 100,
					startsAt: '2026-10-11T00:00:00.000Z', endsAt: '2026-10-12T00:00:00.000Z', own: { rank: 2, score: 800 },
					entries: [{ rank: 1, score: 1000.5, label: '@abcdefghijklmnopqrstuvwxyz_12345', isYou: false }, { rank: 2, score: 800, label: 'Player old-label', isYou: true }]
				}));
			}; return null;
		`);
		for (const [width, height] of [[390, 844], [320, 568], [568, 320]]) {
			await command('browsingContext.setViewport', { context, viewport: { width, height }, devicePixelRatio: 1 });
			await evaluate('showHomeTab("leaderboards", true); return null;');
			await waitFor('!document.querySelector("#leaderboardRefresh").disabled', 'reduced-motion leaderboard fixture did not settle');
			assert.equal(await evaluate(`
				const panel = document.querySelector('[data-home-panel=leaderboards]');
				return panel.scrollWidth <= innerWidth && panel.querySelector('.menu-sheet').getAnimations().length === 0 &&
					document.querySelector('#leaderboardOwn .leaderboard-name').textContent === '@fixture_player' &&
					document.querySelector('#leaderboardEntries .leaderboard-you .leaderboard-name').textContent === '@fixture_player';
			`), true, 'populated reduced-motion rankings fit and use confirmed identity');
			await screenshot('leaderboard-ui-reduced-' + width + 'x' + height + '-fixture');
		}
		await checkAchievements();
		await checkDaily();
		await checkReferrals();
		await evaluate('window.fetch = reducedFixtureFetch; setPlayerAccount("guest"); showHomeTab("profile", true); return null;');
		await screenshot('berry-reduced-motion-profile');
		await click('#appNavigation [data-home-tab=home]');
		await click('#startBtn');
		assert.equal(await evaluate('return gameState === 1 && getComputedStyle(document.querySelector("#appNavigation")).display === "none";'), true);
		assert.deepEqual(errors, []); assert.deepEqual(external, []);
		console.log('PASS: real Firefox reduced-motion preference, static tab icons/panels, rapid navigation, responsive menus and gameplay isolation.');
		return;
	}
	assert.equal(await evaluate(`
		const before = JSON.stringify([MainHex.ct, score, playerRecords]);
		showHomeTab('tasks', true);
		const oldAnimation = document.querySelector('[data-home-panel=tasks] .menu-sheet').getAnimations()[0];
		const frames = oldAnimation.effect.getKeyframes();
		showHomeTab('profile', true);
		const panel = document.querySelector('[data-home-panel=profile] .menu-sheet');
		const current = panel.getAnimations();
		const iconAnimation = document.querySelector('#openProfile svg').getAnimations()[0];
		const valid = oldAnimation.playState === 'idle' && frames.some(frame => frame.transform.includes('8px')) && current.length === 1 && current[0].effect.getTiming().duration === 180 && iconAnimation && iconAnimation.effect.getTiming().duration === 240 && document.querySelectorAll('[data-home-panel]:not([hidden])').length === 1 && before === JSON.stringify([MainHex.ct, score, playerRecords]);
		current.forEach(animation => animation.finish());
		showHomeTab('home', false);
		const homeAnimations = document.querySelector('[data-home-panel=home]').getAnimations();
		const homeStatic = homeAnimations.length === 1 && homeAnimations[0].effect.getKeyframes().every(frame => !frame.transform);
		homeAnimations.forEach(animation => animation.finish());
		return valid && homeStatic;
	`), true, 'rapid switching cancels old entrance animation without touching gameplay');
	const attractTime = await evaluate('return MainHex.ct;');
	await delay(200);
	assert.equal(await evaluate('return MainHex.ct;'), attractTime, 'attract animation does not advance a run');
	assert.equal(await evaluate('return blocks.length;'), 0);
	assert.equal(await evaluate('return getComputedStyle(canvas).display !== "none";'), true, 'title shows the actual canvas');
	assert.equal(await evaluate('return document.querySelector(".title-tagline").getBoundingClientRect().bottom < innerHeight / 2 - 157 * settings.scale;'), true, 'desktop title clears the attract board');
	await screenshot('desktop-home');
	await openRecords();
	assert.equal(await evaluate('return activeHomeTab === "activity" && !document.querySelector("#activityEmpty").hidden && document.querySelector("#runHistory").children.length === 0;'), true);
	await screenshot('desktop-activity-empty');
	await click('#activityPlay');
	assert.equal(await evaluate('return gameState;'), 1, 'empty Activity can start a run');
	assert.equal(await evaluate('return !document.querySelector("#tutorialTip").hidden && playerPreferences.tutorialSeen;'), true, 'first Play shows the live guide');
	await evaluate('rotatePlayer(1); updateFirstRunTutorial(); return null;');
	assert.equal(await evaluate('return document.querySelector("#tutorialMessage").textContent;'), 'Match 3 of the same color');
	await screenshot('desktop-first-play-guide');
	await click('#skipTutorial');
	assert.equal(await evaluate('return document.querySelector("#tutorialTip").hidden;'), true);
	assert.equal(await evaluate('return document.activeElement === canvas;'), true, 'dismissing the guide restores gameplay keyboard controls');
	await evaluate('setStartScreen(); return null;');
	assert.equal(await evaluate('return playerRecords.runs;'), 0, 'abandoned run is not recorded');
	await openOptions();
	assert.equal(await evaluate('return document.querySelector("#soundToggle").getAttribute("aria-checked");'), 'false');
	assert.equal(await evaluate('return playerPreferences.music === "off" && musicTimer === null && gameAudio === null;'), true, 'audio is quiet until explicit interaction');
	assert.equal(await evaluate('const key = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }); document.querySelector("#musicStyle").dispatchEvent(key); return !key.defaultPrevented;'), true, 'game shortcuts do not swallow keyboard selection in Options');
	assert.equal(await evaluate('return document.querySelector("#hapticsToggle").getAttribute("aria-checked");'), 'false');
	await click('#hapticsToggle');
	assert.equal(await evaluate('return JSON.parse(localStorage.getItem(preferencesStorageKey)).haptics;'), true);
	await click('#hapticsToggle');
	assert.equal(await evaluate('return JSON.parse(localStorage.getItem(preferencesStorageKey)).haptics;'), false);
	await click('#soundToggle');
	await delay(100);
	assert.equal(await evaluate('return playerPreferences.sound && !!gameAudio;'), true);
	await evaluate('document.querySelector("#musicStyle").value = "chill"; document.querySelector("#musicStyle").dispatchEvent(new Event("change")); document.querySelector("#musicVolume").value = "45"; document.querySelector("#musicVolume").dispatchEvent(new Event("input")); return null;');
	assert.equal(await evaluate('return playerPreferences.music === "chill" && playerPreferences.musicVolume === 0.45 && musicTimer === null;'), true, 'soundtrack selection is saved but menus stay silent');
	await screenshot('desktop-settings');
	await click('#aboutGame summary');
	assert.equal(await evaluate('return document.querySelector("#aboutGame a").getAttribute("href");'), 'credits.html', 'legal notices stay accessible through About');
	await click('#aboutGame summary');
	await click('#soundToggle');
	await click('#settingsHelp');
	assert.equal(await evaluate('return !document.querySelector("#helpScreen").hidden;'), true);
	await command('input.performActions', { context, actions: [{ type: 'key', id: 'keyboard', actions: [{ type: 'keyDown', value: '\uE00C' }, { type: 'keyUp', value: '\uE00C' }] }] });
	assert.equal(await evaluate('return activeHomeTab === "settings" && document.activeElement.id === "settingsHelp";'), true, 'help returns focus to its home launcher');
	await command('input.performActions', { context, actions: [{ type: 'key', id: 'keyboard', actions: [{ type: 'keyDown', value: '\uE00C' }, { type: 'keyUp', value: '\uE00C' }] }] });
	assert.equal(await evaluate('return activeHomeTab === "profile" && document.activeElement.id === "profileTitle";'), true, 'Escape from Options returns to Profile');
	await command('input.performActions', { context, actions: [{ type: 'key', id: 'keyboard', actions: [{ type: 'keyDown', value: '\uE00C' }, { type: 'keyUp', value: '\uE00C' }] }] });
	assert.equal(await evaluate('return activeHomeTab === "home" && document.activeElement.id === "startBtn";'), true, 'Escape closes secondary menus');
	await click('#startBtn');
	await delay(100);
	assert.equal(await evaluate('return gameState;'), 1);
	const realAudioRunning = await evaluate('return gameAudio.state === "running";');
	assert.equal(await evaluate('return getComputedStyle(document.querySelector("#appNavigation")).display;'), 'none', 'navigation never overlays gameplay');
	if (!realAudioRunning) {
		// Some headless hosts have no audio output device. Use real Web Audio
		// nodes with an offline destination to test the lifecycle, not fake success.
		await evaluate(`
			stopGameMusic();
			const offline = new OfflineAudioContext(1, 48000 * 2, 48000);
			const began = performance.now();
			gameAudio = { state: 'running', get currentTime() { return (performance.now() - began) / 1000; }, destination: offline.destination, createGain: () => offline.createGain(), createOscillator: () => offline.createOscillator() };
			syncGameMusic(); return null;
		`);
		console.log('NOTE: no running headless audio output; soundtrack lifecycle uses real Web Audio nodes with an offline destination fixture. Audible playback needs a device check.');
	}
	const musicStarted = await evaluate('return { timer: musicTimer !== null, style: musicStyle, voices: musicVoices.size > 0, sound: playerPreferences.sound, state: gameAudio && gameAudio.state, hidden: document.hidden };');
	assert.deepEqual(musicStarted, { timer: true, style: 'chill', voices: true, sound: false, state: 'running', hidden: false }, 'music plays independently of sound effects');
	await command('input.performActions', { context, actions: [{ type: 'key', id: 'keyboard', actions: [{ type: 'keyDown', value: '\uE014' }, { type: 'keyUp', value: '\uE014' }] }] });
	assert.equal(await evaluate('return MainHex.position;'), 5);
	await delay(100);
	await evaluate('document.querySelector("#rotateLeft").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); return null;');
	assert.equal(await evaluate('return MainHex.position;'), 0);
	await delay(3200);
	assert.ok(await evaluate('return blocks.length + MainHex.blocks.flat().length > 0;'), 'blocks spawn during live gameplay');
	await screenshot('desktop-playing');
	await evaluate('document.querySelector("#pauseBtn").click(); return null;');
	const clock = await evaluate('return MainHex.ct;');
	await delay(150);
	assert.equal(await evaluate('return MainHex.ct;'), clock);
	assert.equal(await evaluate('return !document.querySelector("#pauseScreen").hidden;'), true);
	assert.equal(await evaluate('return getComputedStyle(document.querySelector("#appNavigation")).display;'), 'none', 'navigation stays hidden while paused');
	assert.equal(await evaluate('return musicTimer === null && musicVoices.size === 0;'), true, 'pause stops all music voices');
	await click('#pauseMusicToggle');
	assert.equal(await evaluate('return playerPreferences.music === "off" && document.querySelector("#musicToggle").getAttribute("aria-checked") === "false" && musicTimer === null;'), true, 'pause can turn music off and synchronize Options');
	await click('#pauseHapticsToggle');
	assert.equal(await evaluate('return playerPreferences.haptics && document.querySelector("#hapticsToggle").getAttribute("aria-checked") === "true";'), true);
	await click('#pauseHapticsToggle');
	await screenshot('desktop-paused');
	await command('input.performActions', { context, actions: [{ type: 'key', id: 'keyboard', actions: [{ type: 'keyDown', value: '\uE00C' }, { type: 'keyUp', value: '\uE00C' }] }] });
	assert.equal(await evaluate('return gameState;'), 1, 'Escape resumes while the dialog button has focus');
	assert.equal(await evaluate('return musicTimer === null && musicVoices.size === 0;'), true, 'music stays off after resume');
	await click('#pauseBtn');
	await click('#pauseMusicToggle');
	await click('#resumeBtn');
	assert.equal(await evaluate('return musicTimer !== null;'), true, 'explicitly re-enabling music restarts on resume');
	await evaluate('document.querySelector("#pauseBtn").click(); document.querySelector("#pauseHelp").click(); return null;');
	assert.equal(await evaluate('return gameState;'), -1);
	assert.equal(await evaluate('return musicTimer === null;'), true, 'instructions pause the music');
	await command('input.performActions', { context, actions: [{ type: 'key', id: 'keyboard', actions: [{ type: 'keyDown', value: '\uE00C' }, { type: 'keyUp', value: '\uE00C' }] }] });
	assert.equal(await evaluate('return gameState;'), -1, 'Controls returns to pause rather than resuming behind it');
	await evaluate('document.querySelector("#pauseHelp").click(); document.querySelector("#closeHelp").focus(); return null;');
	assert.equal(await evaluate('return document.querySelector("#helpScreen a") === null;'), true, 'instructions do not display legal links');
	await command('input.performActions', { context, actions: [{ type: 'key', id: 'keyboard', actions: [{ type: 'keyDown', value: '\uE004' }, { type: 'keyUp', value: '\uE004' }] }] });
	assert.equal(await evaluate('return document.activeElement.id;'), 'closeHelp', 'Tab stays inside the open dialog');
	await evaluate('document.querySelector("#closeHelp").click(); return null;');
	await click('#resumeBtn');
	const scoring = await evaluate(`
		blocks = [];
		MainHex.blocks = [[], [], [], [], [], []];
		[5, 0, 1].forEach(side => {
			const b = new Block(0, '#9b59b6', 1, 75, true);
			b.initializing = 0; b.attachedLane = side; MainHex.blocks[side].push(b);
		});
		consolidateBlocks(MainHex, 0, 0);
		consolidateBlocks(MainHex, 1, 0);
		return { score, particles: clearParticles.length, callout: document.querySelector('#clearCallout').textContent, reduced: reducedGameMotion() };
	`);
	assert.equal(scoring.score, 10);
	assert.deepEqual(scoring, { score: 10, particles: 18, callout: 'Nice match!', reduced: false }, 'a clear produces presentation-only sparkle feedback');
	await delay(160);
	await screenshot('desktop-clear-effects');
	await evaluate(`
		MainHex.blocks = [[], [], [], [], [], []];
		for (let i = 0; i <= settings.rows; i++) MainHex.blocks[0].push(new Block(0, colors[i % 5], 1, 75 + i * settings.blockHeight, true));
		return null;
	`);
	await delay(200);
	assert.equal(await evaluate('return gameState;'), 2);
	assert.equal(await evaluate('return getComputedStyle(document.querySelector("#appNavigation")).display;'), 'none', 'navigation stays hidden on results');
	assert.equal(await evaluate('return musicTimer === null && musicVoices.size === 0;'), true, 'results stop music');
	assert.equal(await evaluate('return document.querySelector("#cScore").textContent;'), '10');
	assert.equal(await evaluate('return document.querySelector("#bestScore").textContent;'), '10');
	assert.equal(await evaluate('return document.querySelector("#resultCleared").textContent;'), '3');
	assert.equal(await evaluate('return playerRecords.runs;'), 1);
	assert.equal(await evaluate('gameOverDisplay(); return playerRecords.runs;'), 1, 'results do not double-save');
	await screenshot('desktop-results');
	await click('#homeBtn');
	assert.equal(await evaluate('return document.body.dataset.screen === "home" && document.querySelector("#homeRuns").textContent === "1" && document.querySelector("#homeBest").textContent === "10";'), true);
	await openRecords();
	assert.equal(await evaluate('return document.querySelector("#runHistory").children.length;'), 1);
	assert.equal(await evaluate('return document.querySelector("#totalCleared").textContent;'), '3');
	await screenshot('desktop-activity');
	await click('#appNavigation [data-home-tab="home"]');
	await click('#startBtn');
	await click('#pauseBtn');
	await click('#pauseHomeBtn');
	assert.equal(await evaluate('return gameState === 0 && playerRecords.runs === 1;'), true, 'pause menu can abandon a run without recording it');
	await click('#startBtn');
	await evaluate('gameState = 2; gameOverDisplay(); return null;');
	await evaluate('document.querySelector("#restart").click(); return null;');
	assert.equal(await evaluate('return gameState === 1 && score === 0 && MainHex.blocks.flat().length === 0 && document.querySelector("#gameoverscreen").hidden;'), true);
	await command('browsingContext.navigate', { context, url, wait: 'complete' });
	await delay(200);
	assert.equal(await evaluate('return document.querySelector("#currentHighScore").textContent;'), '10');
	assert.equal(await evaluate('return playerRecords.runs;'), 2, 'abandoned/refresh-ended runs are not counted');
	assert.equal(await evaluate('return playerPreferences.haptics;'), false, 'preferences survive a reload');
	assert.equal(await evaluate('return playerPreferences.music === "chill" && playerPreferences.musicVolume === 0.45 && gameAudio === null;'), true, 'music preference survives reload without autoplay');
	assert.equal(await evaluate('return playerPreferences.tutorialSeen && document.querySelector("#tutorialTip").hidden;'), true, 'first-visit guide is not repeated after reload');
	const offlineSound = await command('script.evaluate', { expression: `(async () => {
		const results = [];
		for (const style of ['chill', 'rock']) {
			const offline = new OfflineAudioContext(1, 48000, 48000);
			gameAudio = { state: 'running', currentTime: 0, destination: offline.destination, createGain: () => offline.createGain(), createOscillator: () => offline.createOscillator() };
			playerPreferences.music = style; gameState = 1; syncGameMusic();
			clearInterval(musicTimer); musicTimer = null;
			const buffer = await offline.startRendering();
			const samples = buffer.getChannelData(0);
			results.push({ style, finite: samples.every(Number.isFinite), peak: samples.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0) });
			stopGameMusic();
		}
		gameAudio = null; playerPreferences.music = 'chill'; gameState = 0;
		return JSON.stringify(results);
	})()`, target: { context }, awaitPromise: true });
	assert.equal(offlineSound.type, 'success');
	for (const rendered of JSON.parse(offlineSound.result.value)) {
		assert.equal(rendered.finite, true);
		assert.ok(rendered.peak > 0.001 && rendered.peak < 0.8, rendered.style + ' renders non-silent audio without clipping');
	}
	console.log('PASS: both soundtrack styles render finite, non-silent, non-clipping samples with OfflineAudioContext.');
	for (const [width, height, name] of [[390, 844, 'mobile-home'], [320, 568, 'small-mobile-home'], [844, 390, 'landscape-home'], [568, 320, 'small-landscape-home']]) {
		await command('browsingContext.setViewport', { context, viewport: { width, height }, devicePixelRatio: 1 });
		await delay(150);
		const layout = await evaluate(`
			const r = document.querySelector('#startBtn').getBoundingClientRect();
			const menu = document.querySelector('.title-menu').getBoundingClientRect();
			const title = document.querySelector('.title-copy').getBoundingClientRect();
			return { width: innerWidth, canvas: canvas.width, horizontalOverflow: document.documentElement.scrollWidth > innerWidth, buttonVisible: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth, menuVisible: menu.top >= 0 && menu.bottom <= innerHeight && menu.left >= 0 && menu.right <= innerWidth, buttonClear: r.right <= title.left || r.left >= title.right || r.top >= title.bottom || r.bottom <= title.top, menuClear: r.bottom + 6 <= menu.top || r.right <= menu.left || r.left >= menu.right };
		`);
		assert.equal(layout.width, width);
		assert.equal(layout.canvas, width);
		assert.equal(layout.horizontalOverflow, false, name);
		assert.equal(layout.buttonVisible, true, name);
		assert.equal(layout.menuVisible, true, name + ' menu is in view');
		assert.equal(layout.buttonClear, true, name + ' play button does not overlap the title');
		assert.equal(layout.menuClear, true, name + ' title menu does not overlap Play');
		await screenshot(name);
		const navigation = await evaluate(`
			const bar = document.querySelector('#appNavigation').getBoundingClientRect();
			return { visible: bar.top >= 0 && bar.bottom <= innerHeight && bar.left >= 0 && bar.right <= innerWidth,
				clear: document.querySelector('.title-menu').getBoundingClientRect().bottom + 6 <= bar.top,
				touch: Array.from(document.querySelectorAll('#appNavigation button')).every(button => button.getBoundingClientRect().height >= 44 && button.getBoundingClientRect().width >= 44) };
		`);
		assert.deepEqual(navigation, { visible: true, clear: true, touch: true }, name + ' navigation bounds');
		for (const tab of ['tasks', 'referrals', 'wallet', 'profile']) {
			await click('#appNavigation [data-home-tab="' + tab + '"]');
			assert.equal(await evaluate('return activeHomeTab;'), tab);
			assert.equal(await evaluate('return document.activeElement === document.querySelector("[data-home-panel=' + tab + '] h1");'), true, name + ' ' + tab + ' focuses its visible heading');
			assert.equal(await evaluate('return document.querySelector("#appNavigation [aria-current=page]").dataset.homeTab;'), tab);
			assert.equal(await evaluate('return Array.from(document.querySelectorAll("[data-home-panel]")).filter(panel => !panel.hidden).length;'), 1);
			assert.equal(await evaluate('return document.querySelector("[data-home-panel=' + tab + ']").scrollWidth <= innerWidth;'), true, name + ' ' + tab + ' fits');
			if (name === 'mobile-home' && tab !== 'profile') await screenshot('berry-' + tab);
		}
		await screenshot(name.replace('home', 'profile'));
		assert.equal(await evaluate(`
			const panel = document.querySelector('[data-home-panel=profile]');
			const bounds = panel.getBoundingClientRect();
			const bar = document.querySelector('#appNavigation').getBoundingClientRect();
			return Array.from(panel.querySelectorAll('[data-home-tab], summary')).every(element => {
				element.scrollIntoView({ block: 'center', behavior: 'instant' });
				const r = element.getBoundingClientRect();
				return r.top >= bounds.top && r.bottom <= bounds.bottom && r.bottom < bar.top && r.left >= bounds.left && r.right <= bounds.right;
			});
		`), true, name + ' every Profile action is reachable above navigation');
		await click('#profileConnection summary');
		assert.equal(await evaluate(`
			const detail = document.querySelector('#connectionDetail');
			detail.scrollIntoView({ block: 'center', behavior: 'instant' });
			const r = detail.getBoundingClientRect();
			const panel = document.querySelector('[data-home-panel=profile]').getBoundingClientRect();
			return document.querySelector('#profileConnection').open && r.top >= panel.top && r.bottom <= panel.bottom;
		`), true, name + ' Connection details remain reachable');
		await screenshot(name.replace('home', 'profile-connection'));
		await click('#profileConnection summary');
		await click('#openSettings');
		assert.equal(await evaluate('return document.querySelector("[data-home-panel=settings]").scrollWidth <= innerWidth;'), true, name + ' settings layout');
		await click('#aboutGame summary');
		await evaluate('document.querySelector("#aboutGame a").scrollIntoView({ block: "center" }); return null;');
		assert.equal(await evaluate('const r = document.querySelector("#aboutGame a").getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight;'), true, name + ' About link remains reachable');
		await click('#aboutGame summary');
		await evaluate('document.querySelector("[data-home-panel=settings]").scrollTop = 0; return null;');
		await screenshot(name.replace('home', 'settings'));
		await click('[data-home-panel="settings"] [data-home-tab="profile"]');
		await click('[data-home-panel="profile"] [data-home-tab="activity"]');
		assert.equal(await evaluate('return document.querySelector("#runHistory").children.length;'), 2);
		await screenshot(name.replace('home', 'activity'));
		await click('#appNavigation [data-home-tab="home"]');
		await click('#openLeaderboards');
		assert.equal(await evaluate('return activeHomeTab === "leaderboards" && document.querySelector("#appNavigation [aria-current=page]").dataset.homeTab === "home";'), true);
		assert.equal(await evaluate('return document.querySelector("[data-home-panel=leaderboards] #runHistory") === null;'), true, 'practice history is never passed off as rankings');
		assert.equal(await evaluate('return document.querySelector("[data-home-panel=leaderboards]").scrollWidth <= innerWidth;'), true, name + ' leaderboards fits');
		await screenshot(name.replace('home', 'leaderboards'));
		await click('[data-home-panel="leaderboards"] [data-home-tab="home"]');
	}
	await command('browsingContext.setViewport', { context, viewport: { width: 390, height: 844 }, devicePixelRatio: 2 });
	console.log('PASS: responsive game-first Home, five-tab navigation, Profile/Options, preserved personal records and honest unavailable destinations across phone/landscape sizes.');
	await evaluate('document.querySelector("#startBtn").click(); return null;');
	await delay(100);
	await command('input.performActions', { context, actions: [{ type: 'pointer', id: 'finger', parameters: { pointerType: 'touch' }, actions: [{ type: 'pointerMove', x: 330, y: 430 }, { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 }] }] });
	assert.equal(await evaluate('return MainHex.position;'), 5);
	assert.equal(await evaluate('return canvas.width;'), 780);
	await delay(3000);
	await screenshot('mobile-playing');
	console.log('PASS: mobile gameplay and HiDPI rendering.');
	await evaluate('Object.defineProperty(document, "hidden", { configurable: true, value: true }); document.dispatchEvent(new Event("visibilitychange")); return null;');
	assert.equal(await evaluate('return gameState === -1 && musicTimer === null && musicVoices.size === 0;'), true, 'hidden-tab lifecycle pauses play and audio');
	await evaluate('delete document.hidden; document.querySelector("#resumeBtn").click(); return null;');
	await evaluate('gameState = 2; gameOverDisplay(); return null;');
	await screenshot('mobile-results');
	await click('#homeBtn');
	await openProfile();
	const beforeProfile = await evaluate('return playerRecords.runs;');
	await evaluate('setPlayerAccount("connected", { firstName: "<img src=x onerror=alert(1)>" }); return null;');
	assert.equal(await evaluate('return document.querySelector("#playerName").textContent;'), '<img src=x onerror=alert(1)>');
	assert.equal(await evaluate('return document.querySelector("#playerName img");'), null);
	assert.equal(await evaluate('return document.querySelector("#profileName").textContent;'), '<img src=x onerror=alert(1)>');
	assert.equal(await evaluate('return document.querySelector("#profileName img");'), null);
	assert.equal(await evaluate('return playerRecords.runs;'), beforeProfile, 'identity does not migrate or authorize local records');
	await evaluate('setPlayerAccount("error"); return null;');
	assert.equal(await evaluate('return document.querySelector("#retryLogin").hidden;'), false);
	assert.equal(await evaluate('return document.querySelector("#playerName").textContent;'), 'Guest player');
	await evaluate('setPlayerAccount("guest"); return null;');
	// Browser transport fixture: validates the real Firefox engine/client against
	// Node replay, not a live Telegram account or PostgreSQL deployment.
	const replayEvents = [{ tick: 0, type: 'rush', value: true }, { tick: 30, type: 'rotate', value: -1 }, { tick: 70, type: 'rotate', value: 1 }, { tick: 120, type: 'rush', value: false }];
	const expectedReplay = createReplay(42);
	let expectedTick = 0;
	while (!expectedReplay.result().ended && expectedTick < 18000) {
		expectedReplay.advance(expectedTick + 1, replayEvents.filter(event => event.tick === expectedTick));
		expectedTick++;
	}
	assert.equal(expectedReplay.result().ended, true);
	const expectedResult = { ...expectedReplay.result(), bestScore: expectedReplay.result().score, verified: true, coins: { awarded: 0, balance: 0, held: 0, issuanceEnabled: false } };
	const beforeOfficial = await evaluate('return playerRecords.runs;');
	await evaluate(`
		window.smokeRequests = [];
		window.originalGameRequest = gameRequest;
		gameRequest = async (route, body) => {
			smokeRequests.push({ route, body: JSON.parse(JSON.stringify(body)) });
			if (route === 'start') return { id: 'fixture-run', seed: 42, tick: 0, rulesVersion: HexaSessionRules.version };
			if (route.endsWith('/events')) return { tick: body.toTick };
			if (route.endsWith('/finish')) return ${JSON.stringify(expectedResult)};
			return { status: 'abandoned' };
		};
		setStartScreen();
		setPlayerAccount('connected', { firstName: 'Fixture player', officialBest: 0 });
		startPlayerRun();
		return null;
	`);
	await delay(100);
	assert.equal(await evaluate('return officialRun && officialRun.id;'), 'fixture-run');
	console.log('Checking Firefox/Node parity over a complete fixture run with jewel rendering enabled…');
	const firefoxRun = await evaluate(`
		// Start from tick zero synchronously to make the parity comparison exact.
		const descriptor = officialRun;
		officialRun = null;
		init(42);
		officialRun = descriptor;
		$('#gameMode').text('Chase your next best!');
		while (!isInfringing(MainHex) && gameTicks < 18000) {
			if (gameTicks === 0) setPlayerRush(true);
			if (gameTicks === 30) rotatePlayer(-1);
			if (gameTicks === 70) rotatePlayer(1);
			if (gameTicks === 120) setPlayerRush(false);
			update(rush);
			gameTicks++;
			// Fast-forward thousands of ticks with skipped frames; the Node test
			// also covers frequent jewel drawing at three sizes/reduced motion.
			if (gameTicks % 30 === 0) render();
		}
		gameState = 2;
		const computed = { score, tick: gameTicks, blocksCleared: MainHex.clearedBlocks, maxCombo: MainHex.bestCombo };
		gameOverDisplay();
		return computed;
	`);
	assert.equal(firefoxRun.score, expectedResult.score, 'Firefox and Node determine the same score');
	assert.equal(firefoxRun.tick, expectedResult.tick, 'Firefox and Node overflow on the same tick');
	assert.equal(firefoxRun.blocksCleared, expectedResult.blocksCleared);
	await delay(100);
	assert.equal(await evaluate('return officialRun.verified;'), true);
	assert.equal(await evaluate('return document.querySelector("#gameMode").textContent;'), 'NICE RUN');
	assert.equal(await evaluate('return document.querySelector("#resultSaveNote").textContent;'), 'Score saved to your account');
	assert.match(await evaluate('return document.querySelector("#resultCoins").textContent;'), /Coins 0.*Rewards are not active/);
	assert.equal(await evaluate('return playerRecords.runs;'), beforeOfficial, 'verified runs do not enter practice records');
	const uploaded = await evaluate('return smokeRequests.filter(request => request.route.endsWith("/events")).flatMap(request => request.body.events);');
	assert.deepEqual(uploaded, replayEvents);
	assert.equal(await evaluate('return smokeRequests.find(request => request.route.endsWith("/finish")).body.score === undefined;'), true);
	await screenshot('mobile-verified-result-fixture');
	await evaluate('setStartScreen(); gameRequest = originalGameRequest; setPlayerAccount("guest"); return null;');
	const preload = await command('script.addPreloadScript', { functionDeclaration: '() => { Object.defineProperty(window, "localStorage", { get() { throw new DOMException("Blocked", "SecurityError"); } }); }', contexts: [context] });
	await command('browsingContext.navigate', { context, url, wait: 'complete' });
	await delay(200);
	assert.equal(await evaluate('return storageUnavailable && !document.querySelector("#storageNotice").hidden;'), true);
	await click('#startBtn');
	await evaluate('gameState = 2; gameOverDisplay(); return null;');
	assert.equal(await evaluate('return playerRecords.runs;'), 1);
	assert.equal(await evaluate('return document.querySelector("#resultCoins").hidden;'), true, 'practice never displays account Coins as rewards');
	assert.match(await evaluate('return document.querySelector("#resultSaveNote").textContent;'), /Storage unavailable/);
	await command('script.removePreloadScript', { script: preload.script });
	assert.deepEqual(errors, [], 'browser JavaScript errors');
	assert.deepEqual(external, [], 'no third-party network requests');
	assert.deepEqual(requests.filter(request => request.status !== 200), [], 'all local assets loaded');
	console.log('PASS: desktop + mobile + landscape UI, keyboard/touch controls, live spawning, pause/help, purple clear, overflow results, replay, persisted best score, and HiDPI canvas.');
	console.log('PASS: no browser errors, missing assets, or third-party network requests.');
	console.log('PASS: animated game-first Home, Profile/Options and personal records, About-only legal access, preferences/audio, pause-to-title, run metrics/history, focus, blocked storage, and safe account names.');
	console.log('PASS: Firefox/Node deterministic parity and official client batching/result isolation with test transport fixtures (not live Telegram/PostgreSQL).');
	// Native API fixture only: no fake Telegram identity or signed launch data.
	await command('browsingContext.setViewport', { context, viewport: { width: 390, height: 844 }, devicePixelRatio: 2 });
	await evaluate(`
		setStartScreen();
		window.smokeTelegramEvents = {}; window.smokeTelegramChrome = [];
		window.smokeTelegramApp = {
			viewportStableHeight: 760,
			isVersionAtLeast: () => true,
			onEvent: (name, callback) => { smokeTelegramEvents[name] = callback; },
			setHeaderColor: color => smokeTelegramChrome.push(color),
			setBackgroundColor: color => smokeTelegramChrome.push(color),
			setBottomBarColor: color => smokeTelegramChrome.push(color)
		};
		const style = document.documentElement.style;
		style.setProperty('--tg-safe-area-inset-top', '24px');
		style.setProperty('--tg-content-safe-area-inset-top', '36px');
		style.setProperty('--tg-safe-area-inset-bottom', '20px');
		style.setProperty('--tg-content-safe-area-inset-bottom', '10px');
		style.setProperty('--tg-safe-area-inset-left', '20px');
		style.setProperty('--tg-content-safe-area-inset-right', '4px');
		configureTelegramPresentation(smokeTelegramApp);
		return null;
	`);
	await delay(150);
	assert.deepEqual(await evaluate('return smokeTelegramChrome;'), ['#301441', '#301441', '#301441']);
	const telegramBounds = await evaluate(`
		const board = canvas.getBoundingClientRect();
		const play = document.querySelector('#startBtn').getBoundingClientRect();
		const menu = document.querySelector('.title-menu').getBoundingClientRect();
		return { left: board.left, top: board.top, width: board.width, height: board.height,
			pixels: canvas.width, menuClear: play.bottom + 6 <= menu.top,
			playVisible: play.top >= 60 && play.bottom <= 730 && play.left >= 20 && play.right <= 386,
			menuVisible: menu.bottom <= 730 && menu.left >= 20 && menu.right <= 386 };
	`);
	assert.deepEqual(telegramBounds, { left: 20, top: 60, width: 366, height: 594, pixels: 732, menuClear: true, playVisible: true, menuVisible: true });
	assert.equal(await evaluate('const r = document.querySelector("#appNavigation").getBoundingClientRect(); return r.left >= 20 && r.right <= 386 && r.bottom <= 730 && document.querySelector(".title-menu").getBoundingClientRect().bottom + 6 < r.top;'), true, 'bottom navigation respects Telegram device and content safe areas');
	assert.equal(await evaluate('return document.querySelector("#storageNotice").getBoundingClientRect().bottom < document.querySelector(".title-copy").getBoundingClientRect().top;'), true, 'session-only warning stays clear of title and menu controls');
	await screenshot('telegram-safe-area-home-fixture');
	await evaluate('smokeTelegramApp.viewportStableHeight = 600; smokeTelegramEvents.viewportChanged({ isStateStable: false }); return null;');
	assert.equal(await evaluate('return trueCanvas.height;'), 594, 'unstable sheet drags do not move controls');
	await evaluate('smokeTelegramEvents.viewportChanged({ isStateStable: true }); return null;');
	assert.equal(await evaluate('return trueCanvas.height;'), 434, 'stable native viewport resizes Home above bottom navigation');
	assert.equal(await evaluate('return document.querySelector("#startBtn").getBoundingClientRect().bottom + 6 < document.querySelector(".title-menu").getBoundingClientRect().top;'), true, 'short Telegram sheet keeps title actions separate');
	await screenshot('telegram-short-sheet-home-fixture');
	await evaluate('playerPreferences.tutorialSeen = false; startPracticeRun(); gameState = -1; updateFirstRunTutorial(); return null;');
	await evaluate('gameState = 1; updateFirstRunTutorial(); return null;');
	assert.equal(await evaluate('return trueCanvas.height;'), 510, 'gameplay reclaims full usable viewport');
	assert.equal(await evaluate('return getComputedStyle(document.querySelector("#appNavigation")).display;'), 'none', 'short-sheet gameplay hides the bar');
	assert.equal(await evaluate(`
		const tip = document.querySelector('#tutorialTip').getBoundingClientRect();
		const controls = document.querySelector('#playControls').getBoundingClientRect();
		const scores = document.querySelector('.scoreboard').getBoundingClientRect();
		const board = canvas.getBoundingClientRect();
		const radius = settings.rows * settings.blockHeight * 2 / Math.sqrt(3) + settings.hexWidth;
		const boardTop = board.top + board.height / 2 - radius * Math.cos(Math.PI / 6);
		return tip.left >= 20 && tip.right <= 386 && tip.top > scores.bottom && tip.bottom <= boardTop && tip.bottom <= controls.top;
	`), true, 'first-play guide fits between scores and playfield without covering board or rotation controls');
	await screenshot('telegram-first-play-guide-fixture');
	await click('#skipTutorial');
	await click('#pauseBtn');
	assert.equal(await evaluate('return document.querySelector("#tutorialTip").hidden && !document.querySelector("#pauseScreen").hidden;'), true);
	for (const id of ['pauseMusicToggle', 'pauseSoundToggle', 'pauseHapticsToggle', 'resumeBtn', 'pauseHelp', 'pauseHomeBtn']) {
		await evaluate(`document.getElementById('${id}').scrollIntoView({ block: 'center', behavior: 'instant' }); return null;`);
		assert.equal(await evaluate(`const r = document.getElementById('${id}').getBoundingClientRect(); return r.top >= 60 && r.bottom <= 570 && r.left >= 20 && r.right <= 386;`), true, id + ' remains reachable in short Telegram sheet');
	}
	await screenshot('telegram-short-sheet-pause-fixture');
	await evaluate('smokeTelegramApp.viewportStableHeight = 760; smokeTelegramEvents.viewportChanged({ isStateStable: true }); init(17); gameState = -1; return null;');
	assert.equal(await evaluate(`
		let direction;
		const original = rotatePlayer;
		rotatePlayer = value => { direction = value; };
		gameState = 1;
		canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 195, bubbles: true, cancelable: true }));
		gameState = -1; rotatePlayer = original;
		return direction;
	`), 1, 'tap rotation uses the safe-area-adjusted board center');
	assert.equal(await evaluate('const r = document.querySelector("#pauseBtn").getBoundingClientRect(); return r.top >= 60 && r.right <= 386;'), true);
	assert.equal(await evaluate('const r = document.querySelector("#playControls").getBoundingClientRect(); return r.bottom <= 730 && r.left >= 20 && r.right <= 386;'), true);
	await evaluate('render(); return null;');
	await screenshot('telegram-safe-area-playing-fixture');
	await evaluate(`
		setStartScreen();
		for (const name of ['--app-height', '--tg-safe-area-inset-top', '--tg-content-safe-area-inset-top', '--tg-safe-area-inset-bottom', '--tg-content-safe-area-inset-bottom', '--tg-safe-area-inset-left', '--tg-content-safe-area-inset-right']) document.documentElement.style.removeProperty(name);
		scaleCanvas(); return null;
	`);
	// The blocked-storage fixture affects its document until a real reload.
	await command('browsingContext.navigate', { context, url, wait: 'complete' });
	await openOptions();
	await evaluate('playerPreferences.music = "chill"; renderPlayerPreferences(); return null;');
	await click('#musicToggle');
	await command('browsingContext.navigate', { context, url, wait: 'complete' });
	assert.equal(await evaluate('return playerPreferences.music === "off" && playerPreferences.haptics === false && gameAudio === null;'), true, 'Music off and Vibration off persist on reload');
	await click('#startBtn');
	assert.equal(await evaluate('return musicTimer === null && gameAudio === null && document.querySelector("#tutorialTip").hidden;'), true, 'returning players start quietly without another tutorial');
	// Authentication transport fixtures, not live Telegram/PostgreSQL. Exercise
	// real DOM state and requests without trusting the SDK's unverified profile.
	await evaluate(`
		setStartScreen();
		window.authFixtureRequests = [];
		window.authFixtureFetch = window.fetch;
		window.Telegram = { WebApp: {
			initData: 'fixture-signed-launch', initDataUnsafe: { user: { first_name: 'FORGED' } },
			ready() {}, expand() {}
		} };
		window.authFixtureUser = { id: 'fixture-account', telegramId: '12345', firstName: 'Verified fixture', username: 'fixture_player', officialBest: 54 };
		window.fetch = async (route, options) => {
			authFixtureRequests.push({ route, body: options.body ? JSON.parse(options.body) : null, credentials: options.credentials });
			return new Response(JSON.stringify({ user: authFixtureUser }), { status: 200, headers: { 'Content-Type': 'application/json' } });
		};
		startTelegramAuth(); return null;
	`);
	await waitFor('playerAccount.state !== "connecting" && telegramLoginPromise === null', 'authentication fixture did not settle');
	assert.equal(await evaluate('return playerAccount.state;'), 'connected');
	assert.deepEqual(await evaluate('return authFixtureRequests;'), [
		{ route: '/api/auth/telegram', body: { initData: 'fixture-signed-launch' }, credentials: 'same-origin' },
		{ route: '/api/auth/me', body: null, credentials: 'same-origin' }
	]);
	await openProfile();
	await click('#profileConnection summary');
	assert.equal(await evaluate('return document.querySelector("#playerName").textContent;'), '@fixture_player');
	assert.equal(await evaluate('return document.querySelector("#profileName").textContent;'), '@fixture_player');
	assert.match(await evaluate('return document.querySelector("#connectionTitle").textContent;'), /@fixture_player/);
	assert.doesNotMatch(await evaluate('return document.querySelector("#connectionDetail").textContent;'), /12345|FORGED/);
	await screenshot('leaderboard-ui-profile-fixture');
	// Read-only leaderboard transport fixtures: no synthetic database players,
	// scores, prizes or Coin writes. SQL behavior is covered separately.
	await evaluate(`
		window.leaderboardFixtureRequests = [];
		window.leaderboardFixtureMode = 'populated';
		window.fetch = async (route, options) => {
			leaderboardFixtureRequests.push({ route, credentials: options.credentials, cache: options.cache, body: options.body || null });
			if (leaderboardFixtureMode === 'error') throw new Error('fixture offline');
			const period = new URL(route, location.origin).searchParams.get('period');
			const empty = leaderboardFixtureMode === 'empty';
			return new Response(JSON.stringify({ period, timezone: 'UTC', rewardsEnabled: false, limit: period === 'daily' ? 50 : 100,
				startsAt: period === 'daily' ? '2026-10-11T00:00:00.000Z' : '2026-10-05T00:00:00.000Z', endsAt: '2026-10-12T00:00:00.000Z',
				own: empty ? null : { rank: period === 'daily' ? 184 : 42, score: 100.5 },
				entries: empty ? [] : [{ rank: 1, score: 1200.5, label: '<img src=x onerror=alert(1)>', isYou: false },
					{ rank: 2, score: 980, label: '@puzzle_master', isYou: false }, { rank: 3, score: 750, label: '@rush_champion', isYou: false },
					{ rank: 4, score: 500, label: '@abcdefghijklmnopqrstuvwxyz_12345', isYou: false }]
			}), { status: 200, headers: { 'Content-Type': 'application/json' } });
		}; return null;
	`);
	await click('#appNavigation [data-home-tab="home"]');
	await click('#openLeaderboards');
	await waitFor('!document.querySelector("#leaderboardRefresh").disabled', 'daily leaderboard fixture did not settle');
	assert.match(await evaluate('return document.querySelector("#leaderboardOwn").textContent;'), /#184.*100.5/);
	assert.equal(await evaluate('return document.querySelector("#leaderboardEntries img") === null && document.querySelector("#leaderboardEntries .leaderboard-name").textContent === "<img src=x onerror=alert(1)>";'), true, 'standings text never executes markup');
	assert.equal(await evaluate('return authFixtureUser.coinBalance === undefined && document.querySelector("#leaderboardEntries").children.length === 4;'), true, 'standings do not change account Coins');
	assert.equal(await evaluate('return document.querySelector("#leaderboardOwn .leaderboard-name").textContent === "@fixture_player" && document.querySelector("#leaderboardStatus").hidden;'), true, 'own standing uses the verified username without technical copy');
	assert.equal(await evaluate('return document.querySelector("[data-home-panel=leaderboards] .local-disclosure") === null;'), true);
	await evaluate('document.querySelector("#leaderboardEntries .leaderboard-name").textContent = "@color_captain"; return null;');
	await screenshot('leaderboard-ui-daily-fixture');
	await click('[data-leaderboard-period="weekly"]');
	await waitFor('!document.querySelector("#leaderboardRefresh").disabled', 'weekly leaderboard fixture did not settle');
	assert.match(await evaluate('return document.querySelector("#leaderboardOwn").textContent;'), /#42/);
	assert.equal(await evaluate('return document.querySelector("[data-leaderboard-period=weekly]").getAttribute("aria-pressed");'), 'true');
	assert.equal(await evaluate('return document.querySelector("#leaderboardMetric").textContent;'), 'Total points · Top 100');
	await evaluate('document.querySelector("#leaderboardEntries .leaderboard-name").textContent = "@color_captain"; return null;');
	await screenshot('leaderboard-ui-weekly-fixture');
	for (const [width, height] of [[320, 568], [568, 320]]) {
		await command('browsingContext.setViewport', { context, viewport: { width, height }, devicePixelRatio: 1 });
		assert.equal(await evaluate(`
			const panel = document.querySelector('[data-home-panel=leaderboards]');
			const bar = document.querySelector('#appNavigation').getBoundingClientRect();
			return panel.scrollWidth <= innerWidth && panel.getBoundingClientRect().bottom <= bar.top;
		`), true, 'populated standings fit ' + width + 'x' + height + ' above bottom navigation');
		for (const selector of ['[data-leaderboard-period="daily"]', '[data-leaderboard-period="weekly"]', '#leaderboardOwn', '#leaderboardEntries li:last-child', '#leaderboardRefresh']) {
			await evaluate(`document.querySelector('${selector}').scrollIntoView({ block: 'center', behavior: 'instant' }); return null;`);
			assert.equal(await evaluate(`const r = document.querySelector('${selector}').getBoundingClientRect(); const bar = document.querySelector('#appNavigation').getBoundingClientRect(); return r.top >= 0 && r.bottom <= bar.top && r.left >= 0 && r.right <= innerWidth;`), true, selector + ' reachable at ' + width + 'x' + height);
		}
		await evaluate('document.querySelector("[data-home-panel=leaderboards]").scrollTop = 0; return null;');
		assert.equal(await evaluate('return Array.from(document.querySelectorAll(".leaderboard-name"), name => parseFloat(getComputedStyle(name).fontSize) >= 15).every(Boolean);'), true, 'player names stay readable rather than shrinking');
		await screenshot('leaderboard-ui-' + width + 'x' + height + '-fixture');
	}
	await command('browsingContext.setViewport', { context, viewport: { width: 390, height: 844 }, devicePixelRatio: 2 });
	await evaluate(`
		const previousFetch = window.fetch;
		window.fetch = async (route, options) => {
			const response = await previousFetch(route, options); const data = await response.json();
			if (data.entries.length) { data.own = { rank: 3, score: 750 }; data.entries[2] = { rank: 3, score: 750, label: 'Player old-label', isYou: true }; }
			return new Response(JSON.stringify(data));
		}; loadLeaderboard(); return null;
	`);
	await waitFor('!document.querySelector("#leaderboardRefresh").disabled', 'own top-slice row fixture did not settle');
	assert.equal(await evaluate('return document.querySelector("#leaderboardEntries .leaderboard-you .leaderboard-name").textContent === "@fixture_player";'), true, 'own list row matches Profile rather than an anonymous label');
	await evaluate('document.querySelector("#leaderboardEntries .leaderboard-name").textContent = "@color_captain"; return null;');
	await screenshot('leaderboard-ui-you-in-top-fixture');
	await evaluate('setPlayerAccount("connected", { ...authFixtureUser, id: "second-fixture", username: "another_player" }); return null;');
	assert.equal(await evaluate('return !document.querySelector("#leaderboardOwn").textContent.includes("fixture_player") && document.querySelector("#profileName").textContent === "@another_player";'), true, 'account switch clears the previous handle');
	await evaluate('setPlayerAccount("connected", { ...authFixtureUser, username: null, firstName: "Minh", lastName: "Café 🟣" }); return null;');
	await click('#leaderboardRefresh');
	await waitFor('!document.querySelector("#leaderboardRefresh").disabled', 'name fallback fixture did not settle');
	assert.equal(await evaluate('return document.querySelector("#profileName").textContent === "Minh Café 🟣" && document.querySelector("#leaderboardOwn .leaderboard-name").textContent === "Minh Café 🟣";'), true);
	await evaluate('setPlayerAccount("connected", authFixtureUser); return null;');
	await evaluate('leaderboardFixtureMode = "empty"; return null;');
	await click('#leaderboardRefresh');
	await waitFor('!document.querySelector("#leaderboardRefresh").disabled', 'empty leaderboard fixture did not settle');
	assert.equal(await evaluate('return document.querySelector("#leaderboardEntries").children.length === 0 && document.querySelector("#leaderboardOwn").textContent.includes("Not ranked");'), true);
	await screenshot('leaderboard-ui-empty-fixture');
	await evaluate('leaderboardFixtureMode = "error"; return null;');
	await click('#leaderboardRefresh');
	await waitFor('!document.querySelector("#leaderboardRefresh").disabled', 'failed leaderboard fixture did not settle');
	assert.match(await evaluate('return document.querySelector("#leaderboardStatus").textContent;'), /retry/i);
	assert.equal(await evaluate('return leaderboardFixtureRequests.every(request => request.route.startsWith("/api/leaderboards?period=") && request.credentials === "same-origin" && request.cache === "no-store" && request.body === null);'), true);
	await screenshot('leaderboard-ui-error-fixture');
	await evaluate('setPlayerAccount("guest"); return null;');
	assert.equal(await evaluate('return document.querySelector("#leaderboardOwn").textContent === "" && document.querySelector("#leaderboardRefresh").hidden;'), true, 'logout clears own leaderboard identity');
	await evaluate('setPlayerAccount("connected", authFixtureUser); return null;');
	await checkAchievements();
	await checkDaily();
	await checkReferrals();
	await openProfile();
	await evaluate(`
		window.fetch = async (route, options) => {
			authFixtureRequests.push({ route, credentials: options.credentials });
			const more = route.includes('?before=');
			return new Response(JSON.stringify({ balance: 0, held: 0, issuanceEnabled: false, policyStatus: 'awaiting_achievement_payout_policy',
				daily: { day: '2026-10-11', timezone: 'UTC', earned: 5, gameplayEarned: 0, gameplayLimit: 100, totalLimit: 200, remainingGameplay: 100, remainingTotal: 195 }, entries: more ? [] : [
				{ type: 'earn', amount: 5, source: 'browser_fixture', reason: '<b>Fixture only, not live Coins</b>', createdAt: '2026-10-11T00:00:00Z' },
				{ type: 'reverse', amount: 5, source: 'browser_fixture', reason: 'Fixture reversal', createdAt: '2026-10-11T00:00:01Z' }
			], nextCursor: more ? null : '00000000-0000-0000-0000-000000000001' }), { status: 200 });
		}; return null;
	`);
	await click('[data-home-panel="profile"] [data-home-tab="coins"]');
	await waitFor('!coinHistoryLoading', 'Coins fixture did not settle');
	assert.equal(await evaluate('return document.querySelector("#coinBalance").textContent;'), '0');
	assert.equal(await evaluate('return document.querySelector("#coinEarnedToday").textContent;'), '5', 'daily gross earnings are not reset by reversal');
	assert.equal(await evaluate('return document.querySelector("#coinGameplayRemaining").textContent;'), '100 / 100');
	assert.equal(await evaluate('return document.querySelector("#coinTotalRemaining").textContent;'), '195 / 200');
	assert.equal(await evaluate('return document.querySelector("#coinDailyRow").hidden;'), true, 'inactive earning allowances are not presented as available rewards');
	assert.equal(await evaluate('return document.querySelector("#coinHistory b") === null && document.querySelector("#coinHistory").children.length === 2;'), true, 'ledger reasons are plain text, never HTML');
	assert.match(await evaluate('return document.querySelector("#coinStatus").textContent;'), /rewards are not active/);
	assert.equal(await evaluate('return document.querySelector("[data-home-panel=coins]").scrollWidth <= innerWidth;'), true);
	await screenshot('mobile-coins-ledger-fixture');
	await click('#coinMore');
	await waitFor('!coinHistoryLoading', 'Coins pagination fixture did not settle');
	assert.equal(await evaluate('return document.querySelector("#coinMore").hidden;'), true);
	await evaluate('window.fetch = async () => { throw Error("fixture offline"); }; return null;');
	await click('#coinRefresh');
	await waitFor('!coinHistoryLoading', 'Coins refresh fixture did not settle');
	assert.match(await evaluate('return document.querySelector("#coinStatus").textContent;'), /Retry/);
	assert.equal(await evaluate('return document.querySelector("#coinBalance").textContent;'), '0', 'refresh failure does not fabricate or reset the balance');
	await click('#coinBack');
	assert.equal(await evaluate('return activeHomeTab;'), 'profile');
	await click('#appNavigation [data-home-tab="wallet"]');
	await click('[data-home-panel="wallet"] [data-home-tab="coins"]');
	await waitFor('!coinHistoryLoading', 'Wallet Coins fixture did not settle');
	assert.equal(await evaluate('return document.querySelector("#coinBack").textContent;'), '← Wallet');
	assert.equal(await evaluate('return document.querySelector("#appNavigation [aria-current=page]").dataset.homeTab;'), 'wallet');
	await click('#coinBack');
	assert.equal(await evaluate('return activeHomeTab;'), 'wallet');
	await openProfile();
	await evaluate(`
		window.fetch = async () => new Response(JSON.stringify({ code: 'AUTH_NOT_CONFIGURED' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
		startTelegramAuth(); return null;
	`);
	await waitFor('playerAccount.state !== "connecting" && telegramLoginPromise === null', 'unconfigured authentication fixture did not settle');
	assert.equal(await evaluate('return playerAccount.state === "error" && playerAccount.reason === "not_configured" && playerAccount.user === null;'), true);
	assert.equal(await evaluate('return document.querySelector("#coinBalanceRow").hidden && document.querySelector("#coinDailyRow").hidden && document.querySelector("#coinEarnedToday").textContent === "—" && document.querySelector("#coinBalance").textContent === "—" && document.querySelector("#coinHistory").children.length === 0;'), true, 'failed login clears account Coins and daily earnings');
	assert.match(await evaluate('return document.querySelector("#connectionDetail").textContent;'), /Account play.*unavailable/i);
	await screenshot('telegram-auth-unconfigured-fixture');
	await click('#appNavigation [data-home-tab="home"]');
	await click('#startBtn');
	assert.equal(await evaluate('return gameState === 0 && !document.querySelector("#practiceBtn").hidden;'), true, 'failed login does not silently start device-only play');
	await click('#practiceBtn');
	assert.equal(await evaluate('return gameState === 1 && officialRun === null;'), true, 'explicit device-only choice still works');
	await evaluate(`
		setStartScreen(); window.fetch = authFixtureFetch;
		Telegram.WebApp.initData = ''; startTelegramAuth(); return null;
	`);
	await waitFor('playerAccount.state !== "connecting" && telegramLoginPromise === null', 'missing-launch authentication fixture did not settle');
	assert.equal(await evaluate('return playerAccount.reason;'), 'missing_init_data');
	await evaluate('delete window.Telegram; setPlayerAccount("guest"); return null;');
	assert.deepEqual(errors, [], 'browser JavaScript errors after Telegram presentation fixtures');
	console.log('PASS: Telegram signed-data forwarding, confirmed cookie identity, actionable configuration/launch errors, and explicit guest fallback (transport fixtures).');
	console.log('PASS: authenticated Coins display, disabled issuance, safe transaction text, pagination, refresh failure and account isolation (transport fixtures, not live rewards).');
	console.log('PASS: daily/weekly verified leaderboard display, outside-top own rank, safe text, responsive populated standings, empty/error states and account isolation (read-only transport fixtures, no prizes).');
	console.log('PASS: Telegram native chrome, stable viewport and combined device/content safe-area layout with API fixtures (not a real Telegram device test).');
	console.log('PASS: jewel rendering, clear sparkles, opt-in synthesized soundtrack, independent sound/music preferences, and music pause/resume/end lifecycle.');
	console.log('Screenshots:', artifacts);
} finally {
	if (socket) socket.close();
	if (browser) browser.kill('SIGTERM');
	for (const request of pending.values()) clearTimeout(request.timer);
	server.closeAllConnections();
	await new Promise(resolve => server.close(resolve));
}
}
await runSmoke();