// Display-only UTC progress. Neither local records nor completed quests earn Coins.
var tasksSection = 'daily';
var dailyGeneration = 0;
var dailyResetTimer = null;

function clearDailyTimer() {
	if (dailyResetTimer !== null) clearTimeout(dailyResetTimer);
	dailyResetTimer = null;
}

function resetDailyDisplay() {
	dailyGeneration++;
	clearDailyTimer();
	$('#dailyEntries').empty();
	$('#dailyStreak').prop('hidden', true);
	$('#dailyStreakCount, #dailyStreakDetail, #dailyDay').text('');
	$('#dailyRefresh').prop('hidden', playerAccount.state !== 'connected').prop('disabled', false);
	$('#dailyStatus').prop('hidden', false).text(playerAccount.state === 'connected' ? 'Ready to load today’s progress.' :
		playerAccount.state === 'connecting' ? 'Connecting to Telegram…' : playerAccount.state === 'error' ? 'Connection unavailable. Retry in Profile.' : 'Open Hexa Rush from the bot in Telegram to play today’s quests.');
}

function selectTasksSection(section) {
	if (gameState !== 0 || ['daily', 'achievements'].indexOf(section) === -1) return;
	tasksSection = section;
	resetDailyDisplay();
	resetAchievementDisplay();
	document.querySelectorAll('[data-tasks-section]').forEach(function(button) {
		button.setAttribute('aria-pressed', String(button.dataset.tasksSection === section));
	});
	$('#dailyPanel').prop('hidden', section !== 'daily');
	$('#achievementPanel').prop('hidden', section !== 'achievements');
	if (gameState === 0 && activeHomeTab === 'tasks') loadTasksProgress();
}

function loadTasksProgress() {
	if (tasksSection === 'daily') loadDailyProgress();
	else loadAchievements();
}

async function loadDailyProgress() {
	resetDailyDisplay();
	if (playerAccount.state !== 'connected') return;
	var generation = dailyGeneration, userId = playerAccount.user.id;
	var requestedAt = performance.now();
	$('#dailyRefresh').prop('disabled', true);
	$('#dailyStatus').text('Loading today’s progress…');
	try {
		var response = await fetch('/api/daily', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(8000) });
		if (!response.ok) throw new Error('Daily progress unavailable');
		var data = await response.json();
		if (generation !== dailyGeneration || playerAccount.state !== 'connected' || playerAccount.user.id !== userId) return;
		var start = Date.parse(data.startsAt), end = Date.parse(data.endsAt), serverTime = Date.parse(data.serverTime);
		var codes = ['play_3', 'score_800', 'combo_3'], targets = [3, 800, 3], metrics = ['games', 'score', 'chain'];
		var streak = data.streak;
		if (data.rulesVersion !== HexaSessionRules.version || data.rewardsEnabled !== false || data.timezone !== 'UTC' ||
			!/^\d{4}-\d{2}-\d{2}$/.test(data.day) || data.startsAt !== data.day + 'T00:00:00.000Z' ||
			!Number.isFinite(start) || !Number.isFinite(end) || end - start !== 86400000 || !Number.isFinite(serverTime) || serverTime < start || serverTime >= end ||
			!Array.isArray(data.quests) || data.quests.length !== 3 || !data.quests.every(function(quest, index) {
				return quest && quest.code === codes[index] && quest.target === targets[index] && quest.metric === metrics[index] &&
					typeof quest.title === 'string' && quest.title.length > 0 && quest.title.length <= 80 && typeof quest.description === 'string' && quest.description.length <= 180 &&
					Number.isFinite(quest.progress) && quest.progress >= 0 && quest.progress <= quest.target && (index === 1 || Number.isSafeInteger(quest.progress)) &&
					quest.reached === (quest.progress === quest.target);
			}) || !streak || !Number.isSafeInteger(streak.days) || streak.days < 0 || typeof streak.checkedInToday !== 'boolean' ||
			(streak.lastLaunchDay !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(streak.lastLaunchDay) || !Number.isFinite(Date.parse(streak.lastLaunchDay + 'T00:00:00Z')) || streak.lastLaunchDay > data.day)) ||
			streak.checkedInToday !== (streak.lastLaunchDay === data.day) ||
			((streak.lastLaunchDay === data.day || streak.lastLaunchDay === new Date(start - 86400000).toISOString().slice(0, 10)) ? streak.days < 1 : streak.days !== 0)) throw new Error('Invalid daily progress');
		var remaining = end - serverTime - (performance.now() - requestedAt);
		if (remaining <= 0) {
			$('#dailyStatus').text('A fresh set of quests is ready. Tap ↻ to load them.');
			return;
		}
		data.quests.forEach(function(quest) { document.getElementById('dailyEntries').appendChild(achievementRow(quest)); });
		$('#dailyDay').text(data.day + ' · Resets at 00:00 UTC');
		$('#dailyStreak').prop('hidden', false);
		$('#dailyStreakCount').text(streak.days + (streak.days === 1 ? ' day' : ' days'));
		$('#dailyStreakDetail').text(streak.checkedInToday ? 'You’re on a roll! Come back tomorrow to keep it going.' :
			streak.days > 0 ? 'Keep your streak alive! Open Hexa Rush from the bot today.' :
			'Open Hexa Rush from the bot to start a streak.');
		$('#dailyStatus').prop('hidden', true).text('');
		// Server-relative delay, never the device calendar. Clear stale progress at reset.
		if (gameState === 0 && activeHomeTab === 'tasks' && tasksSection === 'daily' && !document.hidden) {
			dailyResetTimer = setTimeout(function() {
				resetDailyDisplay();
				if (gameState === 0 && activeHomeTab === 'tasks' && tasksSection === 'daily' && !document.hidden) loadDailyProgress();
			}, remaining + 100);
		}
	} catch (error) {
		if (generation === dailyGeneration) $('#dailyStatus').text('Daily progress unavailable. Tap ↻ to retry.');
	} finally {
		if (generation === dailyGeneration) $('#dailyRefresh').prop('disabled', false);
	}
}

function initializeDaily() {
	document.querySelectorAll('[data-tasks-section]').forEach(function(button) {
		button.addEventListener('click', function() { selectTasksSection(button.dataset.tasksSection); });
	});
	$('#dailyRefresh').on('click', loadDailyProgress);
	resetDailyDisplay();
	document.addEventListener('visibilitychange', function() {
		if (document.hidden) resetDailyDisplay();
		else if (gameState === 0 && activeHomeTab === 'tasks' && tasksSection === 'daily') loadDailyProgress();
	});
}