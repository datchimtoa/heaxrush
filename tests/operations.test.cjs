const test = require('node:test');
const assert = require('node:assert/strict');
const { parseOrigin, checkPublicEndpoints } = require('../scripts/release-check.cjs');
const { nextMidnight, renewalDue, replaceOrigin, identity, sameProcess, managed } = require('../scripts/preview-tunnel.cjs');

test('release checks accept only exact HTTPS/loopback origins without credentials or paths', () => {
	assert.equal(parseOrigin('https://game.example/'), 'https://game.example');
	assert.equal(parseOrigin('http://127.0.0.1:8001'), 'http://127.0.0.1:8001');
	for (const value of ['http://game.example', 'https://user:password@game.example', 'https://game.example/path', 'https://game.example/?x=1', 'https://game.example/#x', 'file:///tmp']) assert.throws(() => parseOrigin(value));
});

function transport({ exposed = false, cached = false, acceptedLaunch = false } = {}) {
	const calls = [];
	return { calls, async fetch(url, options) {
		calls.push({ url, options });
		const route = new URL(url).pathname;
		let status = ['/api/health', '/', '/js/referrals.js', '/style/home.css'].includes(route) ? 200 :
			['/api/auth/me', '/api/coins', '/api/daily', '/api/achievements', '/api/leaderboards', '/api/referrals'].includes(route) ? 401 : 404;
		if (exposed && route === '/.env') status = 200;
		if (options.method === 'POST') status = options.headers.Origin === 'https://game.example' ? (acceptedLaunch ? 200 : 401) : 403;
		return new Response(route === '/api/health' ? '{"status":"ok"}' : '', { status,
			headers: route.startsWith('/api/') && !cached ? { 'Cache-Control': 'no-store' } : {} });
	} };
}

test('release checker only reads public boundaries and sends empty invalid launches, never authentic player data', async () => {
	const fixture = transport();
	const results = await checkPublicEndpoints('https://game.example', { fetchImpl: fixture.fetch });
	assert.equal(results.length, 22);
	assert.equal(fixture.calls.filter(call => call.options.method === 'POST').length, 2);
	for (const call of fixture.calls) {
		assert.equal(call.options.redirect, 'error');
		assert.equal(call.options.headers?.Cookie, undefined);
		if (call.options.method === 'POST') assert.equal(call.options.body, '{"initData":""}');
	}
});

test('release checker fails on private-file exposure, cached account data or accepted empty launches', async () => {
	for (const options of [{ exposed: true }, { cached: true }, { acceptedLaunch: true }]) {
		await assert.rejects(checkPublicEndpoints('https://game.example', { fetchImpl: transport(options).fetch }));
	}
});

test('preview schedule uses UTC midnight across month/year/leap boundaries, not local device time', () => {
	for (const [input, expected] of [
		['2026-10-15T23:59:59.999Z', '2026-10-16T00:00:00.000Z'],
		['2026-10-16T00:00:00.000Z', '2026-10-17T00:00:00.000Z'],
		['2026-12-31T20:00:00.000Z', '2027-01-01T00:00:00.000Z'],
		['2028-02-28T20:00:00.000Z', '2028-02-29T00:00:00.000Z']]) {
		assert.equal(new Date(nextMidnight(Date.parse(input))).toISOString(), expected);
	}
	const state = { renewedAt: '2026-10-15T05:00:00.000Z' };
	assert.equal(renewalDue(state, Date.parse('2026-10-15T23:59:59.999Z')), false);
	assert.equal(renewalDue(state, Date.parse('2026-10-16T00:00:00.000Z')), true);
	assert.equal(renewalDue(state, Date.parse('2026-10-17T10:00:00.000Z')), true, 'one catch-up after host sleep');
	assert.equal(renewalDue(null, Date.parse('2026-10-15T05:00:00.000Z')), true);
});

test('preview-origin replacement preserves all other bytes and line endings, rejecting ambiguous files', () => {
	for (const newline of ['\n', '\r\n']) {
		const input = Buffer.from(['# private configuration', 'TOKEN=fixture-only', 'APP_ORIGIN=https://old.trycloudflare.com', 'OTHER=value # unchanged', ''].join(newline));
		const result = replaceOrigin(input, 'https://new.trycloudflare.com');
		assert.equal(result.toString(), input.toString().replace('https://old.trycloudflare.com', 'https://new.trycloudflare.com'));
	}
	for (const body of ['TOKEN=x\n', 'APP_ORIGIN=https://old.trycloudflare.com\nAPP_ORIGIN=https://other.trycloudflare.com']) assert.throws(() => replaceOrigin(Buffer.from(body), 'https://new.trycloudflare.com'));
	for (const origin of ['http://new.trycloudflare.com', 'https://foreign.example', 'https://new.trycloudflare.com/path', 'https://new.trycloudflare.com@evil.example']) assert.throws(() => replaceOrigin(Buffer.from('APP_ORIGIN=x'), origin));
});

test('process ownership binds PID to command, working directory and start time before any shutdown', () => {
	const current = identity(process.pid);
	assert.equal(sameProcess(current), true);
	assert.equal(sameProcess({ ...current, started: 'different' }), false);
	assert.equal(sameProcess({ ...current, args: ['unrelated'] }), false);
	assert.equal(sameProcess(null), false);
	assert.equal(managed(current, 'server'), false, 'test runner cannot be mistaken for the preview');
	assert.equal(managed(current, 'tunnel'), false);
});