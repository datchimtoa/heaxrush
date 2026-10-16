// Development-only SDK checks. Neither SDK events nor this display authorize rewards.
var resultAdConfig = null;
var resultAdGeneration = 0;
var resultAdBusy = false;
var resultAdController = null;
var resultAdCancel = null;
var adsgramSdkPromise = null;

function resetResultAd() {
	resultAdGeneration++;
	resultAdConfig = null;
	if (resultAdCancel) resultAdCancel();
	resultAdCancel = null;
	if (resultAdController) { try { resultAdController.destroy(); } catch (error) { /* Optional SDK cleanup. */ } }
	resultAdController = null;
	resultAdBusy = false;
	$('#resultAdCheck').prop('hidden', true);
	$('#resultAdButton').prop('hidden', true).prop('disabled', false);
	$('#resultAdStatus').text('');
}

function resultAdContext() {
	return gameState === 2 && !document.hidden && officialRun && officialRun.verified &&
		playerAccount.state === 'connected' && playerAccount.user && typeof playerAccount.user.id === 'string' &&
		window.Telegram && window.Telegram.WebApp;
}

async function loadResultAd() {
	resetResultAd();
	if (!resultAdContext()) return;
	var generation = resultAdGeneration, run = officialRun, owner = playerAccount.user.id;
	try {
		var response = await fetch('/api/adsgram', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(8000) });
		if (!response.ok) return;
		var data = await response.json();
		if (generation !== resultAdGeneration || !resultAdContext() || officialRun !== run || playerAccount.user.id !== owner) return;
		if (data.provider !== 'adsgram' || data.mode !== 'debug' || data.rewardsEnabled !== false || typeof data.blockId !== 'string' || !/^[1-9]\d{0,15}$/.test(data.blockId)) return;
		resultAdConfig = data;
		$('#resultAdCheck').prop('hidden', false);
		$('#resultAdButton').prop('hidden', false);
		$('#resultAdStatus').text('Development SDK check only. No reward is offered or issued.');
	} catch (error) { /* Optional configuration never blocks saved scores or another game. */ }
}

function loadAdsgramSdk() {
	if (window.Adsgram && typeof window.Adsgram.init === 'function') return Promise.resolve(window.Adsgram);
	if (adsgramSdkPromise) return adsgramSdkPromise;
	adsgramSdkPromise = new Promise(function(resolve, reject) {
		var script = document.createElement('script');
		script.src = 'https://sad.adsgram.ai/js/sad.min.js';
		script.async = true;
		var timeout = setTimeout(function() { finish(false); }, 8000);
		function finish(success) {
			clearTimeout(timeout);
			script.onload = script.onerror = null;
			if (success && window.Adsgram && typeof window.Adsgram.init === 'function') resolve(window.Adsgram);
			else { script.remove(); reject(Error('Ad SDK unavailable')); }
		}
		script.onload = function() { finish(true); };
		script.onerror = function() { finish(false); };
		document.head.appendChild(script);
	}).catch(function(error) { adsgramSdkPromise = null; throw error; });
	return adsgramSdkPromise;
}

async function showResultAdCheck() {
	if (!resultAdContext() || !resultAdConfig || resultAdBusy) return;
	var generation = resultAdGeneration, run = officialRun, owner = playerAccount.user.id, config = resultAdConfig, active = true;
	function current() { return active && generation === resultAdGeneration && resultAdContext() && officialRun === run && playerAccount.user.id === owner; }
	resultAdBusy = true;
	$('#resultAdButton').prop('disabled', true);
	$('#resultAdStatus').text('Loading test ad… You can still return to the title or play again.');
	var timeout;
	try {
		var cancelled = new Promise(function(resolve) { resultAdCancel = function() { resolve({ cancelled: true }); }; });
		var expired = new Promise(function(resolve, reject) { timeout = setTimeout(function() { reject(Error('Ad timed out')); }, 90000); });
		var shown = (async function() {
			var sdk = await loadAdsgramSdk();
			if (!current()) return { cancelled: true };
			resultAdController = sdk.init({ blockId: config.blockId, debug: true, debugConsole: false, debugBannerType: 'RewardedVideo' });
			return { result: await resultAdController.show() };
		})();
		var outcome = await Promise.race([shown, cancelled, expired]);
		if (current() && !outcome.cancelled) $('#resultAdStatus').text(outcome.result && outcome.result.done === true && outcome.result.error === false ?
			'Test ad completed. No reward was issued.' : 'Ad closed or unavailable. No reward was issued.');
	} catch (error) {
		if (current()) $('#resultAdStatus').text('Ad unavailable. Retry the check or play again. No reward was issued.');
	} finally {
		active = false;
		clearTimeout(timeout);
		if (generation === resultAdGeneration) {
			if (resultAdController) { try { resultAdController.destroy(); } catch (error) { /* SDK already closed. */ } }
			resultAdController = null; resultAdCancel = null; resultAdBusy = false;
			$('#resultAdButton').prop('disabled', false);
		}
	}
}