const express = require('express');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { AuthError, validateTelegramData, hashToken } = require('./telegram.cjs');
const { GameError } = require('./replay.cjs');

function readSessionToken(req, name) {
	const cookies = (req.headers.cookie || '').split(';').map(value => value.trim());
	const matches = cookies.filter(value => value.startsWith(name + '='));
	if (matches.length !== 1) return null;
	const token = matches[0].slice(name.length + 1);
	return /^[a-f\d]{64}$/.test(token) ? token : null;
}

function createApp({ config, store, games = null, coins = null, leaderboards = null, achievements = null, daily = null, referrals = null, now = Date.now, logger = console }) {
	const app = express();
	app.disable('x-powered-by');
	// Render is the only public-facing proxy in the selected production topology.
	if (config.production) app.set('trust proxy', 1);
	app.use((req, res, next) => {
		res.set({
			'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
			'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
			'Content-Security-Policy': "default-src 'self'; script-src 'self' https://telegram.org; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self' https://web.telegram.org https://*.telegram.org"
		});
		if (config.production) res.set('Strict-Transport-Security', 'max-age=31536000');
		next();
	});
	app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
	app.get('/api/health', async (req, res) => {
		if (!store || !config.botToken) return res.status(503).json({ status: 'unconfigured' });
		try { await store.health(); res.json({ status: 'ok' }); }
		catch { res.status(503).json({ status: 'unavailable' }); }
	});
	app.use('/api/auth', (req, res, next) => {
		if (!store || !config.botToken) return res.status(503).json({ error: 'Telegram authentication is not configured', code: 'AUTH_NOT_CONFIGURED' });
		if (req.method === 'POST' && req.get('Origin') !== config.origin) return res.status(403).json({ error: 'Origin not allowed', code: 'ORIGIN_NOT_ALLOWED' });
		next();
	});
	// One bounded limiter for login attempts, not game events. No timers keep tests alive.
	const attempts = new Map();
	app.post('/api/auth/telegram', (req, res, next) => {
		const time = now();
		for (const [key, bucket] of attempts) if (bucket.reset <= time) attempts.delete(key);
		const key = req.ip;
		const bucket = attempts.get(key) || { count: 0, reset: time + 60000 };
		if (bucket.count >= 20 || (!attempts.has(key) && attempts.size >= 10000)) {
			res.set('Retry-After', '60');
			return res.status(429).json({ error: 'Too many login attempts' });
		}
		bucket.count++;
		attempts.set(key, bucket);
		next();
	});
	app.use('/api', express.json({ limit: '20kb', strict: true }));
	// Telegram Web embeds Mini Apps cross-site. Partitioned secure cookies work
	// there as well as in native WebViews; strict Origin checks protect writes.
	const secureCookies = config.origin.startsWith('https://');
	const cookieOptions = { httpOnly: true, secure: secureCookies, sameSite: secureCookies ? 'none' : 'strict', partitioned: secureCookies, path: '/' };
	app.post('/api/auth/telegram', async (req, res, next) => {
		try {
			if (!req.body || Object.keys(req.body).length !== 1 || typeof req.body.initData !== 'string') throw new AuthError('Expected initData only', 400);
			const { user, launchHash, startParam } = validateTelegramData(req.body.initData, config.botToken, now());
			const currentToken = readSessionToken(req, config.cookieName);
			if (currentToken) {
				const current = await store.getSession(hashToken(currentToken));
				if (current && current.launchHash === launchHash && current.user.telegramId === user.telegramId) {
					await store.recordLaunch(current.user.id);
					return res.json({ user: current.user, gameplayMode: games ? 'verified' : 'practice' });
				}
			}
			const token = randomBytes(32).toString('hex');
			const account = await store.login({ user, launchHash, startParam, tokenHash: hashToken(token), expiresAt: new Date(now() + config.sessionLifetimeMs) });
			res.cookie(config.cookieName, token, { ...cookieOptions, maxAge: config.sessionLifetimeMs });
			res.json({ user: account, gameplayMode: games ? 'verified' : 'practice' });
		} catch (error) { next(error); }
	});
	app.get('/api/auth/me', async (req, res, next) => {
		try {
			const token = readSessionToken(req, config.cookieName);
			const session = token && await store.getSession(hashToken(token));
			if (!session) throw new AuthError('Not authenticated');
			res.json({ user: session.user, gameplayMode: games ? 'verified' : 'practice' });
		} catch (error) { next(error); }
	});
	app.post('/api/auth/logout', async (req, res, next) => {
		try {
			const token = readSessionToken(req, config.cookieName);
			if (token) await store.revoke(hashToken(token));
			res.clearCookie(config.cookieName, cookieOptions);
			res.status(204).end();
		} catch (error) { next(error); }
	});
	const gameAttempts = new Map();
	app.use('/api/game', async (req, res, next) => {
		try {
			if (!store || !games) throw new GameError('Official play is not configured', 503);
			if (req.method === 'POST' && req.get('Origin') !== config.origin) throw new GameError('Origin not allowed', 403);
			const token = readSessionToken(req, config.cookieName);
			const session = token && await store.getSession(hashToken(token));
			if (!session) throw new AuthError('Not authenticated');
			const time = now();
			for (const [key, bucket] of gameAttempts) if (bucket.reset <= time) gameAttempts.delete(key);
			const key = session.user.id;
			const bucket = gameAttempts.get(key) || { count: 0, reset: time + 60000 };
			if (bucket.count >= 60 || (!gameAttempts.has(key) && gameAttempts.size >= 10000)) {
				res.set('Retry-After', '60'); throw new GameError('Too many game requests', 429);
			}
			bucket.count++;
			gameAttempts.set(key, bucket);
			req.playerId = key;
			next();
		} catch (error) { next(error); }
	});
	const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
	app.post('/api/game/start', async (req, res, next) => {
		try {
			if (!req.body || Object.keys(req.body).join(',') !== 'requestId' || typeof req.body.requestId !== 'string' || !uuid.test(req.body.requestId)) throw new GameError('Expected a requestId UUID only');
			res.json(await games.start(req.playerId, req.body.requestId));
		} catch (error) { next(error); }
	});
	app.post('/api/game/:id/:action', async (req, res, next) => {
		try {
			const { id, action } = req.params;
			if (!uuid.test(id) || !['events', 'finish', 'abandon'].includes(action)) throw new GameError('Game route not found', 404);
			if (action !== 'events' && (!req.body || Array.isArray(req.body) || Object.keys(req.body).length)) throw new GameError('This operation accepts no score or other fields');
			res.json(await games[action](req.playerId, id, req.body));
		} catch (error) { next(error); }
	});
	app.get('/api/coins', async (req, res, next) => {
		try {
			if (!store || !config.botToken || !coins) throw new GameError('Coins ledger is not configured', 503);
			const token = readSessionToken(req, config.cookieName);
			const session = token && await store.getSession(hashToken(token));
			if (!session) throw new AuthError('Not authenticated');
			if (Object.keys(req.query).some(key => key !== 'before') ||
				(req.query.before !== undefined && (typeof req.query.before !== 'string' || !uuid.test(req.query.before)))) throw new GameError('Expected a ledger cursor only');
			res.json(await coins.summary(session.user.id, req.query.before || null));
		} catch (error) { next(error); }
	});
	const leaderboardAttempts = new Map();
	app.get('/api/leaderboards', async (req, res, next) => {
		try {
			if (!store || !config.botToken || !leaderboards) throw new GameError('Leaderboards are not configured', 503);
			const token = readSessionToken(req, config.cookieName);
			const session = token && await store.getSession(hashToken(token));
			if (!session) throw new AuthError('Not authenticated');
			if (Object.keys(req.query).some(key => key !== 'period') || !['daily', 'weekly'].includes(req.query.period)) throw new GameError('Expected a daily or weekly period only');
			const time = now(), key = session.user.id;
			for (const [id, bucket] of leaderboardAttempts) if (bucket.reset <= time) leaderboardAttempts.delete(id);
			const bucket = leaderboardAttempts.get(key) || { count: 0, reset: time + 60000 };
			if (bucket.count >= 20 || (!leaderboardAttempts.has(key) && leaderboardAttempts.size >= 10000)) {
				res.set('Retry-After', '60'); throw new GameError('Too many leaderboard requests', 429);
			}
			bucket.count++;
			leaderboardAttempts.set(key, bucket);
			res.json(await leaderboards.standings(key, req.query.period));
		} catch (error) { next(error); }
	});
	const achievementAttempts = new Map();
	app.get('/api/achievements', async (req, res, next) => {
		try {
			if (!store || !config.botToken || !achievements) throw new GameError('Achievements are not configured', 503);
			const token = readSessionToken(req, config.cookieName);
			const session = token && await store.getSession(hashToken(token));
			if (!session) throw new AuthError('Not authenticated');
			if (Object.keys(req.query).length) throw new GameError('This operation accepts no query fields');
			const time = now(), key = session.user.id;
			for (const [id, bucket] of achievementAttempts) if (bucket.reset <= time) achievementAttempts.delete(id);
			const bucket = achievementAttempts.get(key) || { count: 0, reset: time + 60000 };
			if (bucket.count >= 20 || (!achievementAttempts.has(key) && achievementAttempts.size >= 10000)) {
				res.set('Retry-After', '60'); throw new GameError('Too many achievement requests', 429);
			}
			bucket.count++;
			achievementAttempts.set(key, bucket);
			res.json(await achievements.progress(key));
		} catch (error) { next(error); }
	});
	const dailyAttempts = new Map();
	app.get('/api/daily', async (req, res, next) => {
		try {
			if (!store || !config.botToken || !daily) throw new GameError('Daily progress is not configured', 503);
			const token = readSessionToken(req, config.cookieName);
			const session = token && await store.getSession(hashToken(token));
			if (!session) throw new AuthError('Not authenticated');
			if (Object.keys(req.query).length) throw new GameError('This operation accepts no query fields');
			const time = now(), key = session.user.id;
			for (const [id, bucket] of dailyAttempts) if (bucket.reset <= time) dailyAttempts.delete(id);
			const bucket = dailyAttempts.get(key) || { count: 0, reset: time + 60000 };
			if (bucket.count >= 20 || (!dailyAttempts.has(key) && dailyAttempts.size >= 10000)) {
				res.set('Retry-After', '60'); throw new GameError('Too many daily progress requests', 429);
			}
			bucket.count++;
			dailyAttempts.set(key, bucket);
			res.json(await daily.progress(key));
		} catch (error) { next(error); }
	});
	const referralReads = new Map(), referralWrites = new Map();
	async function referralOwner(req, res, writes) {
		if (!store || !config.botToken || !referrals) throw new GameError('Referrals are not configured', 503);
		if (writes && req.get('Origin') !== config.origin) throw new GameError('Origin not allowed', 403);
		const token = readSessionToken(req, config.cookieName);
		const session = token && await store.getSession(hashToken(token));
		if (!session) throw new AuthError('Not authenticated');
		if (Object.keys(req.query).length || (writes && (!req.body || Array.isArray(req.body) || Object.keys(req.body).length))) throw new GameError('This operation accepts no fields');
		const time = now(), key = session.user.id, attempts = writes ? referralWrites : referralReads;
		for (const [id, bucket] of attempts) if (bucket.reset <= time) attempts.delete(id);
		const bucket = attempts.get(key) || { count: 0, reset: time + 60000 };
		if (bucket.count >= (writes ? 5 : 20) || (!attempts.has(key) && attempts.size >= 10000)) {
			res.set('Retry-After', '60'); throw new GameError('Too many referral requests', 429);
		}
		bucket.count++; attempts.set(key, bucket);
		return key;
	}
	app.get('/api/referrals', async (req, res, next) => {
		try { const owner = await referralOwner(req, res, false); res.json(await referrals.summary(owner)); }
		catch (error) { next(error); }
	});
	app.post('/api/referrals/code', async (req, res, next) => {
		try { const owner = await referralOwner(req, res, true); res.json(await referrals.createCode(owner)); }
		catch (error) { next(error); }
	});
	app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found' }));
	// Never serve the repository root: it contains backend code and environment files.
	const root = path.resolve(__dirname, '..');
	for (const directory of ['js', 'style', 'vendor', 'images']) {
		app.use('/' + directory, express.static(path.join(root, directory), { dotfiles: 'deny', index: false, redirect: false }));
	}
	for (const file of ['index.html', 'credits.html', 'LICENSE.md', 'README.md', 'CHANGELOG.md', 'favicon.ico']) {
		app.get('/' + file, (req, res) => { res.set('Cache-Control', 'no-cache'); res.sendFile(path.join(root, file)); });
	}
	app.get('/', (req, res) => { res.set('Cache-Control', 'no-cache'); res.sendFile(path.join(root, 'index.html')); });
	app.use((req, res) => res.status(404).type('text').send('Not found'));
	app.use((error, req, res, next) => {
		if (error instanceof AuthError || error instanceof GameError) return res.status(error.status).json({ error: error.message });
		if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large' });
		if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
		// No request bodies, launch data, tokens, or database connection details in logs.
		logger.error('Request failed', { code: error.code || 'internal_error' });
		res.status(503).json({ error: 'Service temporarily unavailable' });
	});
	return app;
}

module.exports = { createApp };