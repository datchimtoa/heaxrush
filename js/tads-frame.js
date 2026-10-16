// A disposable browsing context stops provider timers/scripts when removed.
// This same-origin iframe is lifecycle containment, NOT a security boundary.
(function() {
	'use strict';
	if (window.parent === window) return;
	var initialized = false, nonce, controller;
	function send(type, extra) { window.parent.postMessage(Object.assign({ provider: 'hexa-tads', type: type, nonce: nonce }, extra || {}), window.location.origin); }
	function failed() { send('unavailable'); }
	function loadSdk() {
		if (window.tads && typeof window.tads.init === 'function') return Promise.resolve();
		return new Promise(function(resolve, reject) {
			var script = document.createElement('script');
			script.src = 'https://w.tads.me/widget.js'; script.async = true;
			var timer = setTimeout(function() { script.remove(); reject(Error('SDK timeout')); }, 8000);
			script.onload = function() { clearTimeout(timer); window.tads && typeof window.tads.init === 'function' ? resolve() : reject(Error('SDK unavailable')); };
			script.onerror = function() { clearTimeout(timer); script.remove(); reject(Error('SDK unavailable')); };
			document.head.appendChild(script);
		});
	}
	window.addEventListener('message', async function(event) {
		if (initialized || event.source !== window.parent || event.origin !== window.location.origin) return;
		var data = event.data;
		if (!data || data.provider !== 'hexa-tads' || data.type !== 'init' || typeof data.nonce !== 'string' || !/^[a-f\d]{32}$/.test(data.nonce) ||
			typeof data.widgetId !== 'string' || !/^[1-9]\d{0,15}$/.test(data.widgetId) || !Number.isSafeInteger(Number(data.widgetId)) ||
			typeof data.debug !== 'boolean' || typeof data.initData !== 'string' || !data.initData || data.initData.length > 16384 ||
			!data.user || !Number.isSafeInteger(data.user.id) || data.user.id <= 0) return;
		initialized = true; nonce = data.nonce;
		// The SDK expects Telegram's profile shape. This copy came from our confirmed
		// account API; provider SDK signals never authorize identity, scores or Coins.
		window.Telegram = { WebApp: { initData: data.initData, initDataUnsafe: { user: data.user }, platform: data.platform || 'unknown' } };
		window.TelegramWebviewProxy = { postEvent: function(type, value) {
			if (type !== 'web_app_open_link') return;
			try { send('link', { url: JSON.parse(value).url }); } catch (error) { /* Ignore unsupported native events. */ }
		} };
		var content = document.getElementById('sponsorContent'), slot = document.createElement('div');
		slot.id = 'tads-container-' + data.widgetId; content.appendChild(slot);
		var reported = false;
		function measure() {
			if (!slot.querySelector('button')) return;
			var height = Math.ceil(document.body.scrollHeight);
			if (height > 0) { reported = true; send('rendered', { height: height }); }
		}
		var observer = new MutationObserver(measure); observer.observe(slot, { childList: true, subtree: true });
		var resize = new ResizeObserver(function() { if (reported) measure(); }); resize.observe(content);
		window.addEventListener('pagehide', function() {
			observer.disconnect(); resize.disconnect();
			try { if (controller && typeof controller.destroyAd === 'function') controller.destroyAd(); } catch (error) { /* Context is closing. */ }
		}, { once: true });
		try {
			await loadSdk();
			controller = window.tads.init({ widgetId: Number(data.widgetId), type: 'static', debug: data.debug, onAdsNotFound: failed });
			await controller.loadAd(); await controller.showAd(); measure();
		} catch (error) { failed(); }
	});
	document.addEventListener('keydown', function(event) { if (event.key === 'Escape') { event.preventDefault(); send('close'); } });
	window.parent.postMessage({ provider: 'hexa-tads', type: 'ready' }, window.location.origin);
})();