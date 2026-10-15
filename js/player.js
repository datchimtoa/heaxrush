// Device-local practice data only. None of these records authorize rewards.
var playerStorageKey = 'hexaRush.practice.player.v1';
var preferencesStorageKey = 'hexaRush.preferences.v1';
var storageUnavailable = false;
var playerPreferences = { sound: false, haptics: false, music: 'off', musicVolume: 0.35, tutorialSeen: false };
var tutorialActive = false;
var tutorialStep = 0;
var tutorialUntilTick = 0;
var playerRecords = emptyPlayerRecords();
var activeHomeTab = 'home';
var coinReturnTab = 'profile';
var playerAccount = { state: 'guest', user: null };

function emptyPlayerRecords() {
	return { runs: 0, cleared: 0, bestCombo: 0, longestSeconds: 0, history: [] };
}

function readLocalData(key) {
	try { return JSON.parse(localStorage.getItem(key) || 'null'); }
	catch (error) { return null; }
}

function writeLocalData(key, data) {
	try { localStorage.setItem(key, JSON.stringify(data)); return true; }
	catch (error) { storageUnavailable = true; return false; }
}

function readPlayerRecords() {
	var data = readLocalData(playerStorageKey);
	if (!data || !Array.isArray(data.history) || data.history.length > 20) return emptyPlayerRecords();
	if (!['runs', 'cleared', 'bestCombo', 'longestSeconds'].every(function(key) {
		return Number.isSafeInteger(data[key]) && data[key] >= 0;
	})) return emptyPlayerRecords();
	if (!data.history.every(function(run) {
		return run && typeof run.score === 'number' && Number.isFinite(run.score) && run.score >= 0 &&
			['cleared', 'combo', 'seconds', 'endedAt'].every(function(key) { return Number.isSafeInteger(run[key]) && run[key] >= 0; }) &&
			run.combo >= 1 && run.endedAt <= 8640000000000000;
	})) return emptyPlayerRecords();
	return {
		runs: data.runs, cleared: data.cleared, bestCombo: data.bestCombo, longestSeconds: data.longestSeconds,
		history: data.history.map(function(run) { return { score: run.score, cleared: run.cleared, combo: run.combo, seconds: run.seconds, endedAt: run.endedAt }; })
	};
}

function readPlayerPreferences() {
	var data = readLocalData(preferencesStorageKey) || {};
	return {
		sound: data.sound === true, haptics: data.haptics === true,
		music: ['off', 'chill', 'rock'].indexOf(data.music) !== -1 ? data.music : 'off',
		musicVolume: typeof data.musicVolume === 'number' && Number.isFinite(data.musicVolume) && data.musicVolume >= 0 && data.musicVolume <= 1 ? data.musicVolume : 0.35,
		tutorialSeen: data.tutorialSeen === true
	};
}

function startFirstRunTutorial() {
	if (playerPreferences.tutorialSeen) return;
	playerPreferences.tutorialSeen = true;
	writeLocalData(preferencesStorageKey, playerPreferences);
	tutorialActive = true;
	tutorialStep = 0;
	tutorialUntilTick = gameTicks + 18 * 60;
	updateFirstRunTutorial();
}

function updateFirstRunTutorial() {
	var tip = document.getElementById('tutorialTip');
	if (tutorialActive && gameTicks >= tutorialUntilTick) tutorialActive = false;
	var hidden = !tutorialActive || gameState !== 1;
	if (tip.hidden !== hidden) tip.hidden = hidden;
	if (hidden) return;
	if (tutorialStep === 0 && MainHex.lastRotate >= 0) tutorialStep = 1;
	if (tutorialStep < 2 && MainHex.clearedBlocks > 0) {
		tutorialStep = 2;
		tutorialUntilTick = Math.min(tutorialUntilTick, gameTicks + 3 * 60);
	}
	var touch = settings.platform === 'mobile' || trueCanvas.width <= 600;
	var message = [touch ? 'Tap left or right to rotate' : 'Use ← / → to rotate', 'Match 3 of the same color', 'Nice! Keep blocks inside the outline'][tutorialStep];
	var label = document.getElementById('tutorialMessage');
	if (label.textContent !== message) label.textContent = message;
}

function renderPlayerPreferences() {
	document.querySelectorAll('[data-preference]').forEach(function(button) {
		var key = button.dataset.preference;
		button.setAttribute('aria-checked', String(key === 'music' ? playerPreferences.music !== 'off' : playerPreferences[key]));
	});
	$('#musicStyle').val(playerPreferences.music);
	$('#musicVolume').val(Math.round(playerPreferences.musicVolume * 100));
	$('#musicVolumeLabel').text(Math.round(playerPreferences.musicVolume * 100) + '%');
}

function completePracticeRun(hex, points) {
	if (hex.runRecorded) return null;
	hex.runRecorded = true;
	var run = {
		score: points, cleared: hex.clearedBlocks, combo: hex.bestCombo,
		seconds: Math.floor(hex.comboClock / 60), endedAt: Date.now()
	};
	playerRecords.runs++;
	playerRecords.cleared += run.cleared;
	playerRecords.bestCombo = Math.max(playerRecords.bestCombo, run.combo);
	playerRecords.longestSeconds = Math.max(playerRecords.longestSeconds, run.seconds);
	playerRecords.history.unshift(run);
	playerRecords.history = playerRecords.history.slice(0, 20);
	writeLocalData(playerStorageKey, playerRecords);
	return run;
}

function formatRunTime(seconds) {
	return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
}

function runDateLabel(timestamp) {
	return new Date(timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function renderPlayerHub() {
	$('#homeBest').text(playerAccount.state === 'connected' ? playerAccount.user.officialBest || 0 : highscores[0] || 0);
	$('#homeRuns').text(playerRecords.runs);
	$('#homeCombo').text(playerRecords.bestCombo ? 'x' + playerRecords.bestCombo : '—');
	$('#totalCleared').text(playerRecords.cleared);
	$('#longestRun').text(formatRunTime(playerRecords.longestSeconds));
	renderPlayerPreferences();
	$('#storageNotice').prop('hidden', !storageUnavailable);
	$('#activityEmpty').prop('hidden', playerRecords.history.length > 0);
	var historyList = document.getElementById('runHistory');
	historyList.replaceChildren();
	playerRecords.history.forEach(function(run) {
		var row = document.createElement('li');
		var icon = document.createElement('span');
		icon.className = 'run-icon';
		icon.textContent = '↗';
		icon.setAttribute('aria-hidden', 'true');
		var details = document.createElement('div');
		var title = document.createElement('strong');
		title.textContent = runDateLabel(run.endedAt);
		var description = document.createElement('p');
		description.textContent = run.cleared + ' blocks · ' + formatRunTime(run.seconds) + ' · Combo x' + run.combo;
		details.append(title, description);
		var points = document.createElement('strong');
		points.className = 'run-points';
		points.textContent = run.score;
		var label = document.createElement('small');
		label.textContent = 'local points';
		points.append(label);
		row.append(icon, details, points);
		historyList.append(row);
	});
	renderAccountStatus();
}

function showHomeTab(tab, focusHeading) {
	if (gameState !== 0 || ['home', 'leaderboards', 'profile', 'tasks', 'referrals', 'wallet', 'activity', 'settings', 'coins'].indexOf(tab) === -1) return;
	var changed = activeHomeTab !== tab;
	if (tab === 'coins' && ['profile', 'settings', 'wallet'].indexOf(activeHomeTab) !== -1) coinReturnTab = activeHomeTab;
	activeHomeTab = tab;
	document.querySelectorAll('[data-home-panel]').forEach(function(panel) {
		panel.hidden = panel.dataset.homePanel !== tab;
		if (changed) animateHomePanel(panel);
	});
	var navigationTab = tab === 'leaderboards' ? 'home' : ['settings', 'activity'].indexOf(tab) !== -1 ? 'profile' : tab === 'coins' ? (coinReturnTab === 'wallet' ? 'wallet' : 'profile') : tab;
	document.querySelectorAll('#appNavigation [data-home-tab]').forEach(function(button) {
		if (button.dataset.homeTab === navigationTab) button.setAttribute('aria-current', 'page');
		else button.removeAttribute('aria-current');
	});
	var coinBack = document.getElementById('coinBack');
	coinBack.dataset.homeTab = coinReturnTab;
	coinBack.textContent = '← ' + (coinReturnTab === 'settings' ? 'Options' : coinReturnTab === 'wallet' ? 'Wallet' : 'Profile');
	document.querySelectorAll('.game-menu-screen').forEach(function(menu) { menu.scrollTop = 0; });
	document.getElementById('aboutGame').open = false;
	renderPlayerHub();
	if (tab !== 'tasks' && typeof resetDailyDisplay === 'function') resetDailyDisplay();
	if (tab !== 'referrals' && typeof resetReferralDisplay === 'function') resetReferralDisplay();
	if (tab === 'referrals' && typeof loadReferrals === 'function') loadReferrals(false);
	if (tab === 'coins') loadCoinHistory(false);
	if (tab === 'leaderboards' && typeof loadLeaderboard === 'function') loadLeaderboard();
	if (tab === 'tasks') {
		if (typeof loadTasksProgress === 'function') loadTasksProgress();
		else if (typeof loadAchievements === 'function') loadAchievements();
	}
	if (focusHeading) {
		var heading = document.querySelector('[data-home-panel="' + tab + '"] h1');
		heading.tabIndex = -1;
		heading.focus({ preventScroll: true });
	}
}

function animateHomePanel(panel) {
	// One visible panel immediately: no delayed navigation, timers or game ticks.
	var surface = panel.querySelector('.menu-sheet') || panel;
	if (typeof surface.animate !== 'function') return;
	surface.getAnimations().forEach(function(animation) { animation.cancel(); });
	if (panel.hidden || document.hidden || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
	var frames = panel.dataset.homePanel === 'home' ? [{ opacity: 0.4 }, { opacity: 1 }] :
		[{ opacity: 0.4, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }];
	surface.animate(frames, { duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' });
}

function goBackHomeTab() {
	var parent = activeHomeTab === 'coins' ? coinReturnTab : ['settings', 'activity'].indexOf(activeHomeTab) !== -1 ? 'profile' : 'home';
	showHomeTab(parent, parent !== 'home');
	if (parent === 'home') document.getElementById('startBtn').focus({ preventScroll: true });
}

function setPlayerAccount(state, user, reason) {
	playerAccount = { state: state, user: state === 'connected' ? user : null, reason: reason || null };
	if (typeof resetCoinDisplay === 'function') resetCoinDisplay();
	if (typeof resetLeaderboardDisplay === 'function') resetLeaderboardDisplay();
	if (typeof resetAchievementDisplay === 'function') resetAchievementDisplay();
	if (typeof resetDailyDisplay === 'function') resetDailyDisplay();
	if (typeof resetReferralDisplay === 'function') resetReferralDisplay();
	$('#homeBest').text(state === 'connected' ? user.officialBest || 0 : highscores[0] || 0);
	if (state === 'connected') $('#runNotice, #practiceBtn').prop('hidden', true);
	renderAccountStatus();
	if (typeof loadReferrals === 'function' && gameState === 0 && activeHomeTab === 'referrals') loadReferrals(false);
	if ((typeof loadTasksProgress === 'function' || typeof loadAchievements === 'function') && gameState === 0 && activeHomeTab === 'tasks') {
		if (typeof loadTasksProgress === 'function') loadTasksProgress();
		else if (typeof loadAchievements === 'function') loadAchievements();
	}
}

function renderAccountStatus() {
	var state = playerAccount.state;
	var connected = state === 'connected';
	var name = connected ? telegramDisplayName(playerAccount.user) : 'Guest player';
	var errors = {
		missing_init_data: ['Open from the Telegram bot', 'Tap Play in the bot to connect your account. You can also enjoy practice on this device.'],
		not_configured: ['Account play unavailable', 'Account play is unavailable right now. Practice is still ready to play.'],
		origin_mismatch: ['This game link needs a refresh', 'Close this page and open Hexa Rush from the bot. If it still won’t connect, contact the game owner.'],
		invalid_init_data: ['Time to reopen Hexa Rush', 'Close the game and tap Play in the Telegram bot to reconnect.'],
		rate_limited: ['Too many login attempts', 'Wait a minute, then retry Telegram login.'],
		access_denied: ['Telegram login rejected', 'This account or launch is unavailable. Reopen from the correct bot, or contact the owner.'],
		session_unavailable: ['Could not stay connected', 'Allow cookies, then close the game and reopen it from the bot.'],
		sdk_unavailable: ['Telegram connection unavailable', 'Check your connection and try again.'],
		unavailable: ['Connection unavailable', 'Could not reach Hexa Rush. Check your connection and try again.']
	};
	var failure = errors[playerAccount.reason] || errors.unavailable;
	$('#playerName').text(name);
	$('#profileName').text(name);
	$('#profileAvatar').text(connected ? Array.from(name.replace(/^@/, ''))[0].toUpperCase() : 'H');
	$('#profileAccount').text(connected ? 'Telegram account' : state === 'connecting' ? 'Connecting to Telegram…' : state === 'error' ? failure[0] : 'Device-only practice');
	$('#profileBest').text(connected ? playerAccount.user.officialBest || 0 : highscores[0] || 0);
	$('#profileGames').text(playerRecords.runs);
	$('#profileBestLabel').text(connected ? 'PERSONAL BEST' : 'PRACTICE BEST');
	$('#profileGamesLabel').text('DEVICE PRACTICE RUNS');
	$('#connectionTitle').text(connected ? 'Connected as ' + name : state === 'connecting' ? 'Connecting to Telegram…' : state === 'error' ? failure[0] : 'Playing on this device');
	$('#connectionDetail').text(connected ? 'You’re connected! Finish a game to chase your best and climb the rankings.' : state === 'connecting' ? 'Connecting your account…' : state === 'error' ? failure[1] : 'Tap Play in the Telegram bot to save scores to your account. For now, enjoy practice on this device.');
	$('#retryLogin').prop('hidden', state !== 'error');
}

function initializePlayerHub() {
	playerRecords = readPlayerRecords();
	playerPreferences = readPlayerPreferences();
	if (typeof initializeLeaderboards === 'function') initializeLeaderboards();
	if (typeof initializeAchievements === 'function') initializeAchievements();
	if (typeof initializeDaily === 'function') initializeDaily();
	if (typeof initializeReferrals === 'function') initializeReferrals();
	// Detect blocked/full storage even before the first completed run.
	writeLocalData(preferencesStorageKey, playerPreferences);
	document.querySelectorAll('[data-home-tab]').forEach(function(button) {
		button.addEventListener('click', function() {
			showHomeTab(button.dataset.homeTab, button.dataset.homeTab !== 'home');
			if (button.dataset.homeTab === 'home') document.getElementById('startBtn').focus({ preventScroll: true });
		});
	});
	$('#activityPlay').on('click', startPlayerRun);
	$('#settingsHelp').on('click', showHelp);
	$('#skipTutorial').on('click', function() { tutorialActive = false; updateFirstRunTutorial(); canvas.focus(); });
	$('#retryLogin').on('click', startTelegramAuth);
	$('#coinRefresh').on('click', function() { loadCoinHistory(false); });
	$('#coinMore').on('click', function() { loadCoinHistory(true); });
	$('#musicStyle').on('change', function() {
		playerPreferences.music = this.value;
		writeLocalData(preferencesStorageKey, playerPreferences);
		unlockGameAudio();
		syncGameMusic();
		renderPlayerPreferences();
	});
	$('#musicVolume').on('input', function() {
		playerPreferences.musicVolume = Number(this.value) / 100;
		writeLocalData(preferencesStorageKey, playerPreferences);
		$('#musicVolumeLabel').text(this.value + '%');
		syncGameMusic();
	});
	document.querySelectorAll('[data-preference]').forEach(function(button) {
		button.addEventListener('click', function() {
			var key = button.dataset.preference;
			if (key === 'music') playerPreferences.music = playerPreferences.music === 'off' ? 'chill' : 'off';
			else playerPreferences[key] = !playerPreferences[key];
			writeLocalData(preferencesStorageKey, playerPreferences);
			renderPlayerPreferences();
			if (key === 'music') { unlockGameAudio(); syncGameMusic(); }
			if (key === 'sound' && playerPreferences.sound) { unlockGameAudio(); gameFeedback('clear', 1); }
			if (key === 'haptics' && playerPreferences.haptics) gameFeedback('rotate');
		});
	});
	renderPlayerHub();
}
