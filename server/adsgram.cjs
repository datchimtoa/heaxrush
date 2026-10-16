// SDK preparation only. No provider callback or client event can authorize rewards.
function readAdsgramConfig(env) {
	const blockId = (env.ADSGRAM_REWARDED_BLOCK_ID || '').trim();
	if (blockId && !/^[1-9]\d{0,15}$/.test(blockId)) throw Error('ADSGRAM_REWARDED_BLOCK_ID must be a numeric Reward block, not an Interstitial or Task block');
	const debug = env.ADSGRAM_DEBUG || 'false';
	if (!['true', 'false'].includes(debug)) throw Error('ADSGRAM_DEBUG must be true or false');
	if (debug === 'true' && env.NODE_ENV === 'production') throw Error('AdsGram debug mode is not permitted in production');
	if (debug === 'true' && !blockId) throw Error('AdsGram debug mode requires a rewarded block ID');
	return { blockId, debug: debug === 'true' };
}

function adsgramView(config) {
	const debug = !config.production && config.adsgram && config.adsgram.debug === true && typeof config.adsgram.blockId === 'string' && /^[1-9]\d{0,15}$/.test(config.adsgram.blockId);
	return { provider: 'adsgram', mode: debug ? 'debug' : 'disabled', blockId: debug ? config.adsgram.blockId : null, rewardsEnabled: false };
}

module.exports = { readAdsgramConfig, adsgramView };