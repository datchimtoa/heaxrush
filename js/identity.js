// Display names only. Callers supply profiles from the authenticated server API.
function telegramUsername(user) {
	var username = user && typeof user.username === 'string' ? user.username.trim().replace(/^@/, '') : '';
	return /^[a-zA-Z0-9_]{1,32}$/.test(username) ? '@' + username : '';
}

function telegramDisplayName(user) {
	return telegramUsername(user) || [user && user.firstName, user && user.lastName].filter(function(part) {
		return typeof part === 'string' && part.trim();
	}).map(function(part) { return part.trim(); }).join(' ') || 'Telegram player';
}

if (typeof module !== 'undefined' && module.exports) {
	module.exports = { telegramUsername: telegramUsername, telegramDisplayName: telegramDisplayName };
}