// Non-paying static results banner only. No reward callback or ledger operations.
function readTadsConfig(env) {
	const widgetId = (env.TADS_RESULT_WIDGET_ID || '').trim();
	if (widgetId && (!/^[1-9]\d{0,15}$/.test(widgetId) || !Number.isSafeInteger(Number(widgetId)))) throw Error('TADS_RESULT_WIDGET_ID must be a positive numeric widget ID');
	for (const key of ['TADS_RESULT_BANNER_ENABLED', 'TADS_DEBUG']) {
		if (env[key] && !['true', 'false'].includes(env[key])) throw Error(key + ' must be true or false');
	}
	const enabled = env.TADS_RESULT_BANNER_ENABLED === 'true', debug = env.TADS_DEBUG === 'true';
	if (debug && env.NODE_ENV === 'production') throw Error('TADS debug mode is not permitted in production');
	if (enabled && !widgetId) throw Error('TADS results banner requires a separate non-rewarded static widget ID');
	return { widgetId, enabled, debug };
}

function tadsView(config) {
	const tads = config.tads || {};
	const enabled = tads.enabled === true && !(config.production && tads.debug) && typeof tads.widgetId === 'string' && /^[1-9]\d{0,15}$/.test(tads.widgetId) && Number.isSafeInteger(Number(tads.widgetId));
	return { provider: 'tads', mode: enabled ? (tads.debug ? 'debug' : 'live') : 'disabled', widgetId: enabled ? tads.widgetId : null, type: 'static', rewardsEnabled: false };
}

function tadsFramePolicy(config) {
	const enabled = tadsView(config).mode !== 'disabled';
	return "default-src 'none'; script-src 'self'" + (enabled ? ' https://w.tads.me/widget.js https://w.tads.me/static.js' : '') +
		"; style-src 'self' 'unsafe-inline'; img-src " + (enabled ? 'https: data:' : "'self' data:") +
		"; connect-src " + (enabled ? 'https://backend.tads.me https://api.tads.me' : "'none'") +
		"; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; frame-ancestors 'self' https://web.telegram.org https://*.telegram.org";
}

module.exports = { readTadsConfig, tadsView, tadsFramePolicy };