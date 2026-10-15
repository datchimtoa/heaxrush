// Read-only official standings. Device practice and Coins never enter this view.
var leaderboardPeriod = 'daily';
var leaderboardGeneration = 0;

function resetLeaderboardDisplay() {
	leaderboardGeneration++;
	$('#leaderboardEntries').empty();
	$('#leaderboardOwn').empty().prop('hidden', true);
	$('#leaderboardColumns').prop('hidden', true);
	$('#leaderboardMetric').text(leaderboardPeriod === 'daily' ? 'Best run · Top 50' : 'Total points · Top 100');
	$('#leaderboardRefresh').prop('hidden', playerAccount.state !== 'connected').prop('disabled', false);
	$('#leaderboardStatus').prop('hidden', false).text(playerAccount.state === 'connected' ? 'Ready to load rankings.' : 'Open in Telegram to join the rankings.');
}

function leaderboardRow(entry, own) {
	var row = document.createElement(own ? 'div' : 'li');
	row.className = 'leaderboard-row' + (entry.isYou ? ' leaderboard-you' : '');
	row.dataset.rank = entry.rank;
	var rank = document.createElement('span'); rank.className = 'leaderboard-rank'; rank.textContent = '#' + entry.rank;
	var identity = document.createElement('div'); identity.className = 'leaderboard-player';
	var name = document.createElement('strong'); name.className = 'leaderboard-name';
	name.textContent = entry.isYou ? telegramDisplayName(playerAccount.user) : entry.label;
	identity.appendChild(name);
	if (entry.isYou) {
		var badge = document.createElement('span'); badge.className = 'leaderboard-you-badge'; badge.textContent = 'YOU';
		identity.appendChild(badge);
	}
	var points = document.createElement('strong'); points.className = 'leaderboard-points'; points.textContent = entry.score.toLocaleString();
	row.appendChild(rank); row.appendChild(identity); row.appendChild(points);
	return row;
}

function selectLeaderboardPeriod(period) {
	if (['daily', 'weekly'].indexOf(period) === -1) return;
	leaderboardPeriod = period;
	document.querySelectorAll('[data-leaderboard-period]').forEach(function(button) {
		button.setAttribute('aria-pressed', String(button.dataset.leaderboardPeriod === period));
	});
	loadLeaderboard();
}

async function loadLeaderboard() {
	resetLeaderboardDisplay();
	if (playerAccount.state !== 'connected') return;
	var generation = leaderboardGeneration, userId = playerAccount.user.id, period = leaderboardPeriod;
	$('#leaderboardRefresh').prop('disabled', true);
	$('#leaderboardStatus').text('Loading rankings…');
	try {
		var response = await fetch('/api/leaderboards?period=' + period, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(8000) });
		if (!response.ok) throw new Error('Standings unavailable');
		var data = await response.json();
		if (generation !== leaderboardGeneration || playerAccount.state !== 'connected' || playerAccount.user.id !== userId) return;
		var validScore = function(row) { return row && Number.isSafeInteger(row.rank) && row.rank > 0 && Number.isFinite(row.score) && row.score >= 0; };
		if (data.period !== period || data.timezone !== 'UTC' || data.rewardsEnabled !== false || data.limit !== (period === 'daily' ? 50 : 100) ||
			!Number.isFinite(Date.parse(data.startsAt)) || !Number.isFinite(Date.parse(data.endsAt)) ||
			!Array.isArray(data.entries) || data.entries.length > data.limit ||
			!data.entries.every(function(row) { return validScore(row) && typeof row.label === 'string' && row.label.length <= 80 && typeof row.isYou === 'boolean'; }) ||
			(data.own !== null && !validScore(data.own))) throw new Error('Invalid standings');
		$('#leaderboardOwn').prop('hidden', false);
		if (data.own) document.getElementById('leaderboardOwn').appendChild(leaderboardRow({ rank: data.own.rank, score: data.own.score, isYou: true }, true));
		else $('#leaderboardOwn').text('Not ranked yet — finish a run to join!');
		data.entries.forEach(function(entry) {
			document.getElementById('leaderboardEntries').appendChild(leaderboardRow(entry, false));
		});
		$('#leaderboardColumns').prop('hidden', !data.entries.length);
		$('#leaderboardStatus').prop('hidden', !!data.entries.length).text(data.entries.length ? '' : 'No scores yet. Be the first!');
	} catch (error) {
		if (generation === leaderboardGeneration) $('#leaderboardStatus').text('Rankings unavailable. Tap ↻ to retry.');
	} finally {
		if (generation === leaderboardGeneration) $('#leaderboardRefresh').prop('disabled', false);
	}
}

function initializeLeaderboards() {
	document.querySelectorAll('[data-leaderboard-period]').forEach(function(button) {
		button.addEventListener('click', function() { selectLeaderboardPeriod(button.dataset.leaderboardPeriod); });
	});
	$('#leaderboardRefresh').on('click', loadLeaderboard);
	resetLeaderboardDisplay();
}
