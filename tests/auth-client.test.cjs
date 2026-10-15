const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const verifiedUser = { id: 'account-1', telegramId: '12345', firstName: 'Verified player', username: 'verified_player', officialBest: 18 };
function sdk(initData = 'signed-launch') {
	return { initData, initDataUnsafe: { user: { first_name: 'UNVERIFIED', username: 'forged_handle' } }, ready() {}, expand() {} };
}

function client({ hash = '', webApp, stored = null, blockedStorage = false } = {}) {
	const requests = [], scripts = [], elements = new Map();
	const context = vm.createContext({
		window: {
			location: { hash }, ...(webApp ? { Telegram: { WebApp: webApp } } : {}),
			sessionStorage: { getItem(key) { assert.equal(key, '__telegram__initParams'); if (blockedStorage) throw Error('blocked'); return stored; } }
		},
		URLSearchParams, AbortSignal, setTimeout, clearTimeout, highscores: [30],
		document: {
			documentElement: { style: { setProperty() {} } },
			createElement: () => ({ remove() { this.removed = true; } }),
			head: { appendChild: script => scripts.push(script) }
		},
		$(selector) {
			if (!elements.has(selector)) elements.set(selector, {});
			const element = elements.get(selector);
			const chain = { text(value) { element.text = value; return chain; }, prop(key, value) { element[key] = value; return chain; } };
			return chain;
		},
		fetch: async (url, options) => {
			requests.push({ url, options });
			return { ok: true, status: 200, json: async () => ({ user: verifiedUser }) };
		}
	});
	for (const file of ['identity', 'player', 'auth']) vm.runInContext(readFileSync(path.join(__dirname, '../js', file + '.js'), 'utf8'), context);
	return { context, requests, scripts, elements };
}

test('plain browsers, unrelated hashes and blocked or corrupt SDK storage remain request-free guests', async () => {
	for (const options of [{}, { hash: '#records' }, { stored: '{bad' }, { blockedStorage: true }, { stored: '{}' }]) {
		const { context: p, requests, scripts } = client(options);
		await p.startTelegramAuth();
		assert.equal(p.playerAccount.state, 'guest');
		assert.equal(requests.length, 0);
		assert.equal(scripts.length, 0);
	}
});

test('Telegram launches and SDK-restored reloads load the official SDK even without a data marker', async () => {
	for (const options of [
		{ hash: '#tgWebAppData=signed-launch&tgWebAppVersion=8.0' },
		{ hash: '#tgWebAppPlatform=android&tgWebAppVersion=8.0' },
		{ stored: JSON.stringify({ tgWebAppData: 'signed-launch', tgWebAppVersion: '8.0' }) }
	]) {
		const { context: p, scripts, requests } = client(options);
		const login = p.startTelegramAuth();
		assert.equal(p.playerAccount.state, 'connecting');
		assert.equal(scripts.length, 1);
		assert.equal(scripts[0].src, 'https://telegram.org/js/telegram-web-app.js');
		p.window.Telegram = { WebApp: sdk() };
		scripts[0].onload();
		await login;
		assert.equal(p.playerAccount.state, 'connected');
		assert.deepEqual(JSON.parse(requests[0].options.body), { initData: 'signed-launch' });
	}
});

test('empty initData shows launch instructions, never a fake Telegram account or login request', async () => {
	const { context: p, requests, elements } = client({ webApp: sdk('') });
	await p.startTelegramAuth();
	assert.equal(p.playerAccount.state, 'error');
	assert.equal(p.playerAccount.reason, 'missing_init_data');
	assert.equal(p.playerAccount.user, null);
	assert.equal(requests.length, 0);
	assert.match(elements.get('#connectionDetail').text, /Tap Play in the bot/);
	assert.equal(elements.get('#retryLogin').hidden, false);
});

test('raw signed data is posted once and the cookie session is confirmed before displaying verified identity', async () => {
	const { context: p, requests, elements } = client({ webApp: sdk() });
	await p.startTelegramAuth();
	assert.deepEqual(requests.map(request => request.url), ['/api/auth/telegram', '/api/auth/me']);
	assert.deepEqual(JSON.parse(requests[0].options.body), { initData: 'signed-launch' });
	assert.ok(requests.every(request => request.options.credentials === 'same-origin'));
	assert.equal(requests[1].options.cache, 'no-store');
	assert.equal(p.playerAccount.state, 'connected');
	assert.equal(p.playerAccount.user.telegramId, '12345');
	assert.equal(elements.get('#playerName').text, '@verified_player');
	assert.equal(elements.get('#profileName').text, '@verified_player');
	assert.equal(elements.get('#profileAvatar').text, 'V');
	assert.equal(elements.get('#connectionTitle').text, 'Connected as @verified_player');
	assert.equal(elements.get('#profileBest').text, 18);
	assert.equal(elements.get('#profileBestLabel').text, 'PERSONAL BEST');
	assert.equal(elements.get('#profileGamesLabel').text, 'DEVICE PRACTICE RUNS');
	assert.equal(elements.get('#profileGames').text, 0, 'local run count is never relabeled as official games');
	assert.doesNotMatch(elements.get('#connectionDetail').text, /12345|UNVERIFIED/);
	assert.equal(elements.get('#homeBest').text, 18);
});

test('pending login retries share one request instead of consuming the launch twice', async () => {
	const { context: p, requests } = client({ webApp: sdk() });
	const fetch = p.fetch;
	let release;
	p.fetch = async (...args) => {
		if (args[0] === '/api/auth/telegram') await new Promise(resolve => { release = resolve; });
		return fetch(...args);
	};
	const first = p.startTelegramAuth();
	const second = p.startTelegramAuth();
	for (let i = 0; i < 10 && !release; i++) await Promise.resolve();
	assert.ok(release);
	release();
	await Promise.all([first, second]);
	assert.equal(requests.filter(request => request.url === '/api/auth/telegram').length, 1);
	assert.equal(p.playerAccount.state, 'connected');
});

test('Profile never mixes official best with practice best/counts and clears identity after auth failure', () => {
	const { context: p, elements } = client();
	p.highscores = [9000]; p.playerRecords.runs = 7;
	p.setPlayerAccount('connected', { ...verifiedUser, username: null, firstName: '<img src=x>', officialBest: 54, officialGames: 99 });
	assert.equal(elements.get('#profileName').text, '<img src=x>');
	assert.equal(elements.get('#profileBest').text, 54);
	assert.equal(elements.get('#profileGames').text, 7);
	assert.equal(elements.get('#profileGamesLabel').text, 'DEVICE PRACTICE RUNS');
	p.setPlayerAccount('error', null, 'session_unavailable');
	assert.equal(elements.get('#profileName').text, 'Guest player');
	assert.equal(elements.get('#profileAvatar').text, 'H');
	assert.equal(elements.get('#profileBest').text, 9000);
	assert.equal(elements.get('#profileBestLabel').text, 'PRACTICE BEST');
	assert.equal(elements.get('#profileGames').text, 7);
	assert.doesNotMatch(elements.get('#profileAccount').text, /verified_player/);
});

test('all account surfaces prefer the confirmed username, use name fallbacks and replace identity on account changes', () => {
	const { context: p, elements } = client({ webApp: sdk() });
	for (const [user, name, initial] of [
		[{ ...verifiedUser, username: ' new_handle ' }, '@new_handle', 'N'],
		[{ ...verifiedUser, username: '@next_handle' }, '@next_handle', 'N'],
		[{ ...verifiedUser, username: null, firstName: ' Minh ', lastName: ' Café 🟣 ' }, 'Minh Café 🟣', 'M'],
		[{ ...verifiedUser, username: '<img src=x>', firstName: '<b>Name</b>' }, '<b>Name</b>', '<'],
		[{ id: 'empty', username: '' }, 'Telegram player', 'T']
	]) {
		p.setPlayerAccount('connected', user);
		assert.equal(elements.get('#profileName').text, name);
		assert.equal(elements.get('#playerName').text, name);
		assert.equal(elements.get('#connectionTitle').text, 'Connected as ' + name);
		assert.equal(elements.get('#profileAvatar').text, initial);
		assert.equal(elements.get('#profileAccount').text, 'Telegram account');
	}
	p.setPlayerAccount('guest');
	assert.equal(elements.get('#profileName').text, 'Guest player');
	assert.doesNotMatch(elements.get('#connectionTitle').text, /next_handle|Minh/);
});

test('login errors distinguish missing configuration, wrong origin, invalid launch, limits and outages', async () => {
	for (const [status, code, reason, message] of [
		[503, 'AUTH_NOT_CONFIGURED', 'not_configured', /Account play.*unavailable/i],
		[403, 'ORIGIN_NOT_ALLOWED', 'origin_mismatch', /open Hexa Rush from the bot/],
		[401, null, 'invalid_init_data', /tap Play/i],
		[429, null, 'rate_limited', /minute/],
		[503, null, 'unavailable', /unavailable|reach/i],
		[403, null, 'access_denied', /rejected|unavailable/i]
	]) {
		const { context: p, elements } = client({ webApp: sdk() });
		p.fetch = async () => ({ ok: false, status, json: async () => ({ code, error: 'PRIVATE launch or token must never be displayed' }) });
		await p.startTelegramAuth();
		assert.equal(p.playerAccount.state, 'error');
		assert.equal(p.playerAccount.reason, reason);
		assert.equal(p.playerAccount.user, null);
		assert.match(elements.get('#connectionDetail').text, message);
		assert.doesNotMatch(elements.get('#connectionDetail').text, /PRIVATE/);
	}
});

test('missing or different cookie identity never authorizes official play and failed login can retry', async () => {
	for (const response of [
		{ ok: false, status: 401 },
		{ ok: true, json: async () => ({ user: { ...verifiedUser, telegramId: '999' } }) },
		{ ok: true, json: async () => ({ user: { ...verifiedUser, id: 'different' } }) }
	]) {
		const { context: p } = client({ webApp: sdk() });
		const fetch = p.fetch;
		p.fetch = (url, options) => url === '/api/auth/me' ? Promise.resolve(response) : fetch(url, options);
		await p.startTelegramAuth();
		assert.equal(p.playerAccount.state, 'error');
		assert.equal(p.playerAccount.reason, 'session_unavailable');
		p.fetch = fetch;
		await p.startTelegramAuth();
		assert.equal(p.playerAccount.state, 'connected');
	}
});

test('network and SDK failures stay visible and SDK loading can be retried', async () => {
	const { context: p, elements } = client({ webApp: sdk() });
	p.fetch = async () => { throw Error('offline'); };
	await p.startTelegramAuth();
	assert.equal(p.playerAccount.reason, 'unavailable');
	assert.equal(elements.get('#retryLogin').hidden, false);
	const { context: q, scripts } = client({ hash: '#tgWebAppVersion=8.0' });
	const first = q.startTelegramAuth();
	scripts[0].onerror();
	await first;
	assert.equal(q.playerAccount.reason, 'sdk_unavailable');
	assert.equal(scripts[0].removed, true);
	const retry = q.startTelegramAuth();
	assert.equal(scripts.length, 2);
	q.window.Telegram = { WebApp: sdk() };
	scripts[1].onload();
	await retry;
	assert.equal(q.playerAccount.state, 'connected');
});