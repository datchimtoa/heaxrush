// Telegram identity only. This does not turn local gameplay into official scoring.
var telegramPresentationApp = null;
var telegramLoginPromise = null;

function configureTelegramPresentation(webApp) {
	if (telegramPresentationApp === webApp) return;
	telegramPresentationApp = webApp;
	function supported(version, method) {
		return typeof webApp[method] === 'function' && typeof webApp.isVersionAtLeast === 'function' && webApp.isVersionAtLeast(version);
	}
	function syncChrome() {
		// Custom header colors require 6.9; older clients only accept theme keys.
		[['6.9', 'setHeaderColor'], ['6.1', 'setBackgroundColor'], ['7.10', 'setBottomBarColor']].forEach(function(entry) {
			if (supported(entry[0], entry[1])) {
				try { webApp[entry[1]]('#301441'); } catch (error) { /* Optional native chrome. */ }
			}
		});
	}
	function syncViewport(event) {
		// Do not move bottom controls on intermediate sheet-drag updates.
		if (event && event.isStateStable === false) return;
		var height = webApp.viewportStableHeight;
		if (Number.isFinite(height) && height > 0) document.documentElement.style.setProperty('--app-height', height + 'px');
		if (typeof scaleCanvas === 'function') scaleCanvas();
	}
	syncChrome();
	syncViewport();
	if (typeof webApp.onEvent === 'function') {
		webApp.onEvent('themeChanged', syncChrome);
		webApp.onEvent('viewportChanged', syncViewport);
		if (typeof webApp.isVersionAtLeast === 'function' && webApp.isVersionAtLeast('8.0')) {
			webApp.onEvent('safeAreaChanged', syncViewport);
			webApp.onEvent('contentSafeAreaChanged', syncViewport);
		}
	}
}

function hasTelegramLaunch() {
	if (window.Telegram && window.Telegram.WebApp) return true;
	var launch = new URLSearchParams(window.location.hash.slice(1));
	if (['tgWebAppData', 'tgWebAppVersion', 'tgWebAppPlatform'].some(function(key) { return launch.has(key); })) return true;
	// The official SDK restores these parameters on same-tab reloads. This is
	// only an SDK-loading hint, never proof of identity or a substitute for HMAC.
	try {
		var stored = JSON.parse(window.sessionStorage.getItem('__telegram__initParams') || 'null');
		return !!(stored && (stored.tgWebAppData || stored.tgWebAppVersion || stored.tgWebAppPlatform));
	} catch (error) { return false; }
}

function telegramLoginError(reason) {
	var error = new Error('Telegram connection failed');
	error.authReason = reason;
	return error;
}

function loadTelegramSdk() {
	return new Promise(function(resolve, reject) {
		var script = document.createElement('script');
		script.src = 'https://telegram.org/js/telegram-web-app.js';
		function failed() {
			clearTimeout(timeout);
			script.remove();
			reject(telegramLoginError('sdk_unavailable'));
		}
		var timeout = setTimeout(failed, 8000);
		script.onload = function() { clearTimeout(timeout); resolve(); };
		script.onerror = failed;
		document.head.appendChild(script);
	});
}

function startTelegramAuth() {
	if (telegramLoginPromise) return telegramLoginPromise;
	if (!hasTelegramLaunch()) return Promise.resolve();
	telegramLoginPromise = authenticateTelegram().finally(function() { telegramLoginPromise = null; });
	return telegramLoginPromise;
}

async function authenticateTelegram() {
	setPlayerAccount('connecting');
	try {
		if (!(window.Telegram && window.Telegram.WebApp)) await loadTelegramSdk();
		if (!(window.Telegram && window.Telegram.WebApp)) throw telegramLoginError('sdk_unavailable');
		var webApp = window.Telegram.WebApp;
		configureTelegramPresentation(webApp);
		webApp.ready();
		webApp.expand();
		if (typeof webApp.initData !== 'string' || !webApp.initData.trim()) throw telegramLoginError('missing_init_data');
		// Revalidate this launch even when a cookie exists: a shared browser may
		// contain another Telegram account's session. Same-launch retries are safe.
		var response = await fetch('/api/auth/telegram', {
			method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ initData: webApp.initData }), signal: AbortSignal.timeout(8000)
		});
		if (!response.ok) {
			var failure = await response.json().catch(function() { return {}; });
			var reason = failure.code === 'AUTH_NOT_CONFIGURED' ? 'not_configured' :
				failure.code === 'ORIGIN_NOT_ALLOWED' ? 'origin_mismatch' :
				response.status === 401 ? 'invalid_init_data' : response.status === 429 ? 'rate_limited' :
				response.status === 403 ? 'access_denied' : 'unavailable';
			throw telegramLoginError(reason);
		}
		var data = await response.json();
		// A successful POST alone does not prove the WebView accepted the cookie.
		var session = await fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(8000) });
		if (!session.ok) throw telegramLoginError('session_unavailable');
		var confirmed = await session.json();
		if (!data.user || !confirmed.user || !confirmed.user.id || !confirmed.user.telegramId ||
			confirmed.user.id !== data.user.id || confirmed.user.telegramId !== data.user.telegramId) throw telegramLoginError('session_unavailable');
		// Only a profile returned by the authenticated API is displayed; never initDataUnsafe.
		setPlayerAccount('connected', confirmed.user);
	} catch (error) {
		setPlayerAccount('error', null, error.authReason || 'unavailable');
	}
}