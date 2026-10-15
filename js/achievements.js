// Account-only display progress. Reached milestones never authorize Coin rewards.
var achievementGeneration = 0;

function resetAchievementDisplay() {
	achievementGeneration++;
	$('#achievementEntries').empty();
	$('#achievementRefresh').prop('hidden', playerAccount.state !== 'connected').prop('disabled', false);
	$('#achievementStatus').prop('hidden', false).text(playerAccount.state === 'connected' ? 'Ready to load your progress.' :
		playerAccount.state === 'connecting' ? 'Connecting to Telegram…' : playerAccount.state === 'error' ? 'Connection unavailable. Retry in Profile.' : 'Open Hexa Rush from the bot in Telegram to chase your milestones.');
}

function achievementRow(milestone) {
	var row = document.createElement('li'); row.className = 'achievement-row' + (milestone.reached ? ' achievement-reached' : '');
	var heading = document.createElement('div'); heading.className = 'achievement-heading';
	var title = document.createElement('h3'); title.textContent = milestone.title;
	var status = document.createElement('span'); status.className = 'achievement-badge'; status.textContent = milestone.reached ? '✓ Reached' : 'In progress';
	heading.appendChild(title); heading.appendChild(status);
	var description = document.createElement('p'); description.textContent = milestone.description;
	var progress = document.createElement('progress'); progress.max = milestone.target; progress.value = milestone.progress;
	progress.setAttribute('aria-label', milestone.title + ' progress');
	var value = document.createElement('span'); value.className = 'achievement-value';
	value.textContent = milestone.progress.toLocaleString() + ' / ' + milestone.target.toLocaleString() + (milestone.metric === 'score' ? ' points' : milestone.metric === 'games' ? ' games' : ' chain levels');
	row.appendChild(heading); row.appendChild(description); row.appendChild(progress); row.appendChild(value);
	return row;
}

async function loadAchievements() {
	resetAchievementDisplay();
	if (playerAccount.state !== 'connected') return;
	var generation = achievementGeneration, userId = playerAccount.user.id;
	$('#achievementRefresh').prop('disabled', true);
	$('#achievementStatus').text('Loading your progress…');
	try {
		var response = await fetch('/api/achievements', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(8000) });
		if (!response.ok) throw new Error('Achievements unavailable');
		var data = await response.json();
		if (generation !== achievementGeneration || playerAccount.state !== 'connected' || playerAccount.user.id !== userId) return;
		var codes = ['score_500', 'score_1000', 'score_2000', 'combo_4'], targets = [500, 1000, 2000, 4];
		if (data.rulesVersion !== HexaSessionRules.version || data.rewardsEnabled !== false || !Array.isArray(data.milestones) || data.milestones.length !== 4 ||
			!data.milestones.every(function(milestone, index) {
				return milestone && milestone.code === codes[index] && milestone.target === targets[index] && milestone.metric === (index < 3 ? 'score' : 'chain') &&
					typeof milestone.title === 'string' && milestone.title.length > 0 && milestone.title.length <= 80 &&
					typeof milestone.description === 'string' && milestone.description.length <= 180 &&
					Number.isFinite(milestone.progress) && milestone.progress >= 0 && milestone.progress <= milestone.target &&
					(index < 3 || Number.isSafeInteger(milestone.progress)) && milestone.reached === (milestone.progress === milestone.target);
			})) throw new Error('Invalid achievements');
		data.milestones.forEach(function(milestone) { document.getElementById('achievementEntries').appendChild(achievementRow(milestone)); });
		$('#achievementStatus').prop('hidden', true).text('');
	} catch (error) {
		if (generation === achievementGeneration) $('#achievementStatus').text('Progress unavailable. Tap ↻ to retry.');
	} finally {
		if (generation === achievementGeneration) $('#achievementRefresh').prop('disabled', false);
	}
}

function initializeAchievements() {
	$('#achievementRefresh').on('click', loadAchievements);
	resetAchievementDisplay();
}