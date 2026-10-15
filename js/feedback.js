// Short synthesized cues; optional soundtrack lives separately in music.js.
var gameAudio = null;
var audioUnavailable = false;

function unlockGameAudio() {
	if ((!playerPreferences.sound && (!playerPreferences.music || playerPreferences.music === 'off')) || audioUnavailable) return;
	try {
		var Audio = window.AudioContext || window.webkitAudioContext;
		if (!Audio) return;
		if (!gameAudio) gameAudio = new Audio();
		if (gameAudio.state === 'suspended') gameAudio.resume().then(function() { if (typeof syncGameMusic === 'function') syncGameMusic(); }).catch(function() {});
	} catch (error) { audioUnavailable = true; }
}

function gameFeedback(event, level) {
	if (event === 'clear' && typeof celebrateClear === 'function') celebrateClear(level || 1);
	if (event === 'rotate' && typeof rotationGlowUntil !== 'undefined') rotationGlowUntil = performance.now() + 220;
	if (event === 'end' && typeof stopGameMusic === 'function') { stopGameMusic(); resetGameEffects(); }
	if (playerPreferences.haptics) {
		try {
			var telegram = window.Telegram && window.Telegram.WebApp;
			if (telegram && telegram.HapticFeedback && telegram.isVersionAtLeast && telegram.isVersionAtLeast('6.1')) {
				if (event === 'end') telegram.HapticFeedback.notificationOccurred('warning');
				else telegram.HapticFeedback.impactOccurred(event === 'rotate' ? 'light' : 'medium');
			} else if (navigator.vibrate && event !== 'start') navigator.vibrate(event === 'rotate' ? 8 : event === 'end' ? [20, 40, 20] : 18);
		} catch (error) { /* Haptics are optional on unsupported WebViews. */ }
	}
	if (!playerPreferences.sound || !gameAudio || gameAudio.state !== 'running') return;
	try {
		var time = gameAudio.currentTime;
		var notes = event === 'rotate' ? [240] : event === 'end' ? [330, 220] : event === 'start' ? [330, 440, 660] : [440 + Math.min(level || 1, 5) * 55, 660 + Math.min(level || 1, 5) * 55];
		notes.forEach(function(frequency, index) {
			var oscillator = gameAudio.createOscillator();
			var gain = gameAudio.createGain();
			var start = time + index * 0.07;
			oscillator.type = 'sine';
			oscillator.frequency.setValueAtTime(frequency, start);
			gain.gain.setValueAtTime(0.0001, start);
			gain.gain.exponentialRampToValueAtTime(0.06, start + 0.01);
			gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.13);
			oscillator.connect(gain);
			gain.connect(gameAudio.destination);
			oscillator.start(start);
			oscillator.stop(start + 0.14);
			oscillator.onended = function() { oscillator.disconnect(); gain.disconnect(); };
		});
	} catch (error) { /* Audio failure must never interrupt a run. */ }
}

function startPracticeRun() {
	unlockGameAudio();
	init();
	startFirstRunTutorial();
	gameFeedback('start');
}
