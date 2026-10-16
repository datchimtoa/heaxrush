// Optional, non-paying static sponsor placement, only after a saved account run.
var resultBannerConfig = null;
var resultBannerGeneration = 0;
var resultBannerFrame = null;
var resultBannerTimer = null;
var resultBannerNonce = null;
var resultBannerInitialized = false;

function resultBannerContext() {
	var app = window.Telegram && window.Telegram.WebApp;
	return gameState === 2 && !document.hidden && officialRun && officialRun.verified && playerAccount.state === 'connected' &&
		playerAccount.user && typeof playerAccount.user.id === 'string' && app && typeof app.initData === 'string' && !!app.initData.trim();
}

function closeResultBanner() {
	clearTimeout(resultBannerTimer); resultBannerTimer = null;
	var frame = resultBannerFrame; resultBannerFrame = null; resultBannerNonce = null; resultBannerInitialized = false;
	if (frame) frame.remove();
	$('#resultSponsorFrame, #resultSponsorClose').prop('hidden', true);
	$('#resultSponsorOpen').prop('disabled', false);
}

function resetResultBanner() {
	resultBannerGeneration++; resultBannerConfig = null; closeResultBanner();
	$('#resultSponsor, #resultSponsorOpen').prop('hidden', true);
	$('#resultSponsorStatus').text('');
}

async function loadResultBanner() {
	resetResultBanner();
	if (!resultBannerContext()) return;
	var generation = resultBannerGeneration, run = officialRun, owner = playerAccount.user.id;
	try {
		var response = await fetch('/api/tads', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(8000) });
		if (!response.ok) return;
		var data = await response.json();
		if (generation !== resultBannerGeneration || !resultBannerContext() || officialRun !== run || playerAccount.user.id !== owner) return;
		if (!data || data.provider !== 'tads' || !['debug', 'live'].includes(data.mode) || data.type !== 'static' || data.rewardsEnabled !== false ||
			typeof data.widgetId !== 'string' || !/^[1-9]\d{0,15}$/.test(data.widgetId) || !Number.isSafeInteger(Number(data.widgetId))) return;
		resultBannerConfig = data;
		$('#resultSponsor, #resultSponsorOpen').prop('hidden', false);
		$('#resultSponsorOpen').text(data.mode === 'debug' ? 'Test sponsor banner · Development only' : 'Show sponsor banner');
		$('#resultSponsorStatus').text('Optional ad · TADS receives Telegram launch/profile data. No game reward.');
	} catch (error) { /* Optional advertising never blocks saving or another game. */ }
}

function showResultBanner() {
	if (!resultBannerContext() || !resultBannerConfig || resultBannerFrame) return;
	var user = playerAccount.user, id = Number(user.telegramId);
	if (!Number.isSafeInteger(id) || id <= 0) return;
	resultBannerNonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), function(n) { return n.toString(16).padStart(2, '0'); }).join('');
	var frame = document.createElement('iframe');
	frame.title = 'Sponsored advertisement by TADS';
	// Same-origin is necessary for provider origin checks/native link relay. This
	// sandbox limits navigation, but is not isolation from a malicious provider SDK.
	frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
	frame.src = '/tads-frame.html'; frame.referrerPolicy = 'no-referrer';
	resultBannerFrame = frame;
	$('#resultSponsorOpen').prop('disabled', true);
	$('#resultSponsorClose, #resultSponsorFrame').prop('hidden', false);
	$('#resultSponsorStatus').text('Loading sponsor… Play again is always available.');
	resultBannerTimer = setTimeout(function() {
		if (resultBannerFrame !== frame) return;
		closeResultBanner(); $('#resultSponsorStatus').text('No sponsor available right now. You can play again.');
	}, 15000);
	document.getElementById('resultSponsorFrame').appendChild(frame);
}

function receiveResultBanner(event) {
	var frame = resultBannerFrame, data = event.data;
	if (!frame || event.source !== frame.contentWindow || event.origin !== window.location.origin || !resultBannerContext() || !data || data.provider !== 'hexa-tads') return;
	if (data.type === 'ready' && !resultBannerInitialized) {
		resultBannerInitialized = true;
		var user = playerAccount.user, app = window.Telegram.WebApp;
		frame.contentWindow.postMessage({ provider: 'hexa-tads', type: 'init', nonce: resultBannerNonce, widgetId: resultBannerConfig.widgetId,
			debug: resultBannerConfig.mode === 'debug', initData: app.initData, platform: app.platform,
			user: { id: Number(user.telegramId), first_name: user.firstName || '', last_name: user.lastName || '', username: user.username || '', language_code: user.languageCode || 'en' }
		}, window.location.origin);
		return;
	}
	if (!resultBannerInitialized || data.nonce !== resultBannerNonce) return;
	if (data.type === 'rendered' && Number.isFinite(data.height) && data.height > 0 && data.height <= 10000) {
		clearTimeout(resultBannerTimer); resultBannerTimer = null;
		frame.style.height = Math.min(320, Math.max(96, Math.ceil(data.height))) + 'px';
		$('#resultSponsorStatus').text(resultBannerConfig.mode === 'debug' ? 'Test advertisement · No impressions counted. No game reward.' : 'Advertisement · No game reward.');
	} else if (data.type === 'unavailable' || data.type === 'close') {
		closeResultBanner();
		$('#resultSponsorStatus').text(data.type === 'close' ? 'Sponsor closed.' : 'No sponsor available right now. You can play again.');
		document.getElementById('resultSponsorOpen').focus({ preventScroll: true });
	} else if (data.type === 'link' && typeof data.url === 'string' && data.url.length <= 8192) {
		try {
			var url = new URL(data.url);
			if (url.protocol === 'https:' && url.hostname === 'backend.tads.me' && !url.port && !url.username && !url.password && typeof window.Telegram.WebApp.openLink === 'function') window.Telegram.WebApp.openLink(url.href);
		} catch (error) { /* No arbitrary navigation or reward messages. */ }
	}
}

window.addEventListener('message', receiveResultBanner);
document.addEventListener('visibilitychange', function() { if (document.hidden) resetResultBanner(); });