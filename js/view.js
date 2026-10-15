function renderText(x, y, fontSize, color, text) {
	ctx.save();
	fontSize *= settings.scale;
	ctx.font = fontSize + 'px Exo, sans-serif';
	ctx.textAlign = 'center';
	ctx.fillStyle = color;
	ctx.fillText(text, x, y + fontSize / 2 - 9 * settings.scale);
	ctx.restore();
}

function drawScoreboard() {
	renderText(trueCanvas.width / 2 + gdx, trueCanvas.height / 2 + gdy, gameState === 0 ? 46 : 40, '#edf2ff', gameState === 0 ? '⬡' : score);
}

function clearGameBoard() {
	// The static CSS backdrop is behind this transparent gameplay canvas.
	ctx.clearRect(0, 0, trueCanvas.width, trueCanvas.height);
}

function drawPolygon(x, y, sides, radius, theta, fillColor, lineWidth, lineColor) {
	ctx.fillStyle = fillColor;
	ctx.lineWidth = lineWidth || 1;
	ctx.strokeStyle = lineColor || 'transparent';
	ctx.beginPath();
	for (var i = 0; i < sides; i++) {
		var coords = rotatePoint(0, radius, theta + i * 360 / sides);
		if (i === 0) ctx.moveTo(coords.x + x, coords.y + y);
		else ctx.lineTo(coords.x + x, coords.y + y);
	}
	ctx.closePath();
	ctx.fill();
	if (lineWidth) ctx.stroke();
}

function updateComboDisplay() {
	function textIfChanged(id, value) {
		var element = document.getElementById(id);
		if (element.textContent !== String(value)) element.textContent = value;
	}
	textIfChanged('liveScore', score);
	var active = MainHex.clearChain && MainHex.comboClock - MainHex.lastCombo < settings.comboTime;
	var level = active ? MainHex.comboMultiplier : 1;
	textIfChanged('comboLabel', active ? 'COMBO x' + level : '');
	textIfChanged('comboDetail', active ? comboScoreMultiplier(level) + '×' : '');
}

function gameOverDisplay() {
	if (MainHex.runRecorded) return;
	$('#resultCoins').prop('hidden', true);
	if (officialRun) {
		MainHex.runRecorded = true;
		gameFeedback('end');
		$('#cScore').text(score);
		$('#bestScore').text(playerAccount.user.officialBest || 0);
		$('#bestCombo').text('x' + MainHex.bestCombo);
		$('#resultCleared').text(MainHex.clearedBlocks);
		$('#resultDuration').text(formatRunTime(Math.floor(gameTicks / 60)));
		$('#resultEyebrow').text('SAVING SCORE…');
		$('#resultSaveNote').text('Saving your score… Your final score will appear here.');
		$('#resultInsight').text('Nice run! Just a moment…');
		$('#gameMode').text('SAVING SCORE…');
		$('#newBest, #pauseBtn, #playControls').prop('hidden', true);
		$('#gameoverscreen').prop('hidden', false);
		$('#restart').trigger('focus');
		syncOfficialRun(true);
		return;
	}
	var previousBest = highscores[0] || 0;
	if (highscores.indexOf(score) === -1) highscores.push(score);
	if (!writeHighScores()) storageUnavailable = true;
	var run = completePracticeRun(MainHex, score);
	gameFeedback('end');
	$('#currentHighScore, #bestScore').text(highscores[0] || 0);
	$('#cScore').text(score);
	$('#bestCombo').text('x' + MainHex.bestCombo);
	$('#resultCleared').text(run.cleared);
	$('#resultDuration').text(formatRunTime(run.seconds));
	$('#resultInsight').text(score > previousBest ? 'A new personal best. That’s your next score to beat.' : score > 0 ? (previousBest - score) + ' points from your personal best. Find your next match.' : 'Start with three of one color. Every run is a fresh chance.');
	$('#resultSaveNote').text(storageUnavailable ? 'Storage unavailable · Kept for this visit only' : 'Saved on this device');
	$('#newBest').prop('hidden', score <= previousBest);
	$('#resultEyebrow').text(score > previousBest ? 'A NEW HIGH' : 'NICE RUN');
	$('#pauseBtn, #playControls').prop('hidden', true);
	$('#gameoverscreen').prop('hidden', false);
	$('#restart').trigger('focus');
}

function pause() {
	if (gameState !== 1 && gameState !== -1) return;
	if (gameState === -1 && gameTicks >= HexaSessionRules.maxTicks) return;
	setPlayerRush(false);
	gameState = gameState === 1 ? -1 : 1;
	resetGameEffects();
	if (gameState === 1) unlockGameAudio();
	syncGameMusic();
	var limited = gameTicks >= HexaSessionRules.maxTicks;
	$('#pauseTitle').text(limited ? 'RUN TIME LIMIT' : 'PAUSED');
	$('#resumeBtn').prop('hidden', limited);
	$('#pauseScreen').prop('hidden', gameState !== -1);
	$('#pauseBtn').attr('aria-label', gameState === -1 ? 'Resume game' : 'Pause game').text(gameState === -1 ? '▶' : 'Ⅱ');
	lastTime = performance.now();
	if (gameState === -1) $(limited ? '#pauseHomeBtn' : '#resumeBtn').trigger('focus');
	else canvas.focus();
}

var helpPreviousState = 0;
var helpReturnFocus = null;
function showHelp() {
	var opening = $('#helpScreen').prop('hidden');
	if (opening) {
		helpPreviousState = gameState;
		helpReturnFocus = document.activeElement;
		setPlayerRush(false);
		if (gameState === 1) gameState = -1;
		resetGameEffects();
		syncGameMusic();
		if (helpPreviousState === -1) $('#pauseScreen').prop('hidden', true);
	}
	$('#helpScreen').prop('hidden', !opening);
	if (opening) $('#closeHelp').trigger('focus');
	else {
		gameState = helpPreviousState;
		if (gameState === -1) $('#pauseScreen').prop('hidden', false);
		if (gameState === 1) unlockGameAudio();
		syncGameMusic();
		lastTime = performance.now();
		if (gameState === 1) canvas.focus();
		else if (helpReturnFocus && helpReturnFocus.isConnected) helpReturnFocus.focus();
		else canvas.focus();
	}
}