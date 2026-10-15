const { createHash, createHmac, timingSafeEqual } = require('node:crypto');

class AuthError extends Error {
	constructor(message = 'Invalid Telegram launch data', status = 401) {
		super(message);
		this.status = status;
	}
}

function validateTelegramData(initData, botToken, now = Date.now()) {
	if (typeof initData !== 'string' || !initData || initData.length > 16000 || /%(?![a-f\d]{2})/i.test(initData)) throw new AuthError();
	const fields = new URLSearchParams(initData);
	const keys = [...fields.keys()];
	if (new Set(keys).size !== keys.length) throw new AuthError();
	const receivedHash = fields.get('hash');
	if (!/^[a-f\d]{64}$/i.test(receivedHash || '')) throw new AuthError();
	fields.delete('hash');
	fields.sort();
	// Telegram's bot-token HMAC includes every field except hash, including signature.
	const checkString = [...fields].map(([key, value]) => `${key}=${value}`).join('\n');
	const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
	const expected = createHmac('sha256', secret).update(checkString).digest();
	if (!timingSafeEqual(expected, Buffer.from(receivedHash, 'hex'))) throw new AuthError();
	const authDate = fields.get('auth_date');
	const age = Math.floor(now / 1000) - Number(authDate);
	if (!/^\d{1,12}$/.test(authDate || '') || age < -30 || age > 300) throw new AuthError();
	let user;
	try { user = JSON.parse(fields.get('user')); } catch { throw new AuthError(); }
	if (!user || !Number.isSafeInteger(user.id) || user.id <= 0 || typeof user.first_name !== 'string' || !user.first_name || user.first_name.length > 256) throw new AuthError();
	for (const key of ['last_name', 'username', 'language_code']) {
		if (user[key] !== undefined && (typeof user[key] !== 'string' || user[key].length > 256)) throw new AuthError();
	}
	return {
		user: { telegramId: String(user.id), firstName: user.first_name, lastName: user.last_name || '', username: user.username || null, languageCode: user.language_code || null },
		launchHash: receivedHash.toLowerCase(),
		startParam: fields.get('start_param')
	};
}

function hashToken(token) {
	return createHash('sha256').update(token).digest('hex');
}

module.exports = { AuthError, validateTelegramData, hashToken };