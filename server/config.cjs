const { readFileSync } = require('node:fs');
const { readAdsgramConfig } = require('./adsgram.cjs');
const { readTadsConfig } = require('./tads.cjs');

function readConfig(env = process.env) {
	const production = env.NODE_ENV === 'production';
	const origin = new URL(env.APP_ORIGIN || env.RENDER_EXTERNAL_URL || 'http://localhost:8001');
	if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || !['http:', 'https:'].includes(origin.protocol)) throw new Error('APP_ORIGIN must be an HTTP(S) origin without a path');
	if (production && (origin.protocol !== 'https:' || !env.DATABASE_URL || !env.TELEGRAM_BOT_TOKEN)) throw new Error('Production requires HTTPS APP_ORIGIN, DATABASE_URL, and TELEGRAM_BOT_TOKEN');
	const port = Number(env.PORT || 8001);
	if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535');
	const botUsername = (env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, '');
	if (botUsername && !/^[a-z][a-z0-9_]{1,28}bot$/i.test(botUsername)) throw new Error('Invalid TELEGRAM_BOT_USERNAME');
	return {
		production, port, origin: origin.origin, botToken: env.TELEGRAM_BOT_TOKEN || '', botUsername,
		adsgram: readAdsgramConfig(env),
		tads: readTadsConfig(env),
		databaseUrl: env.DATABASE_URL || '',
		ssl: env.DATABASE_SSL_CA_FILE ? { ca: readFileSync(env.DATABASE_SSL_CA_FILE, 'utf8'), rejectUnauthorized: true } : undefined,
		cookieName: production ? '__Host-hexaRushSession' : 'hexaRushSession',
		sessionLifetimeMs: 24 * 60 * 60 * 1000
	};
}

module.exports = { readConfig };