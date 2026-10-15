// Practice records are separate from upstream Hextris scores, not official scores.
var highScoreStorageKey = 'hexaRush.practice.highscores.v1';

function readHighScores() {
	try {
		var saved = JSON.parse(localStorage.getItem(highScoreStorageKey) || '[]');
		if (!Array.isArray(saved)) return [];
		return saved.filter(function(value) {
			return typeof value === 'number' && Number.isFinite(value) && value >= 0;
		}).sort(function(a, b) { return b - a; }).slice(0, 3);
	} catch (error) {
		return [];
	}
}

function writeHighScores() {
	highscores.sort(function(a, b) { return b - a; });
	highscores = highscores.slice(0, 3);
	try {
		localStorage.setItem(highScoreStorageKey, JSON.stringify(highscores));
		return true;
	} catch (error) {
		// Private browsing/storage restrictions must not prevent playing a round.
		return false;
	}
}