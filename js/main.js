var renderFrameStep = 1;

function scaleCanvas() {
	// CSS owns the stable Telegram viewport and safe-area bounds. Only drawing
	// scale changes here; physics and replay stay in logical coordinates.
	var bounds = canvas.getBoundingClientRect();
	var width = bounds.width;
	var height = bounds.height;
	var oldScale = settings.scale;
	settings.scale = Math.min(width / 600, height / 1000);
	if (width > height) settings.scale = Math.min(width / 1100, height / 680);
	settings.prevScale = oldScale;
	settings.hexWidth = settings.baseHexWidth * settings.scale;
	settings.blockHeight = settings.baseBlockHeight * settings.scale;
	trueCanvas = { width: width, height: height };
	// Limit fill-rate on high-density mobile WebViews; logical gameplay is unchanged.
	var ratio = Math.min(window.devicePixelRatio || 1, 2);
	canvas.width = Math.round(width * ratio);
	canvas.height = Math.round(height * ratio);
	ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function init(seed) {
	runGeneration++;
	abandonOfficialRun();
	gameRandom = seededGameRandom(seed === undefined ? crypto.getRandomValues(new Uint32Array(1))[0] : seed);
	gameTicks = 0;
	gameAccumulator = 0;
	blocks = [];
	score = 0;
	rush = 1;
	settings.speedUpKeyHeld = false;
	gdx = 0;
	gdy = 0;
	op = 1;
	document.body.dataset.screen = 'game';
	scaleCanvas();
	MainHex = new Hex(settings.hexWidth);
	waveone = new waveGen(MainHex);
	lastTime = performance.now();
	gameState = 1;
	resetGameEffects();
	tutorialActive = false;
	$('#tutorialTip').prop('hidden', true);
	syncGameMusic();
	$('#startScreen, #gameoverscreen, #pauseScreen, #helpScreen').prop('hidden', true);
	$('#pauseBtn, #playControls').prop('hidden', false);
	$('#pauseBtn').attr('aria-label', 'Pause game').text('Ⅱ');
	$('#pauseTitle').text('PAUSED');
	$('#resumeBtn').prop('hidden', false);
	$('#liveScore').text('0');
	$('#gameMode').text('Saved on this device');
	$('#currentHighScore').text(highscores[0] || 0);
	$('#runNotice, #practiceBtn, #retryResult').prop('hidden', true);
	updateComboDisplay();
	canvas.focus();
}

function setStartScreen() {
	init();
	gameState = 0;
	stopGameMusic();
	document.body.dataset.screen = 'home';
	scaleCanvas();
	$('#startScreen').prop('hidden', false);
	$('#pauseBtn, #playControls').prop('hidden', true);
	showHomeTab('home', false);
	renderTitleBoard(performance.now());
	document.getElementById('startBtn').focus({ preventScroll: true });
}

function addNewBlock(blocklane, color, iter, distFromHex, settled) {
	blocks.push(new Block(blocklane, color, iter * settings.speedModifier, distFromHex, settled));
}

function animLoop(now) {
	var elapsed = Math.min(Math.max(now - lastTime, 0), 100);
	lastTime = now;
	renderFrameStep = elapsed / (1000 / 60);
	if (typeof updateFirstRunTutorial === 'function') updateFirstRunTutorial();
	if (gameState === 1) {
		gameAccumulator += elapsed;
		while (gameAccumulator >= 1000 / 60 && gameState === 1) {
			update(rush);
			gameTicks++;
			gameAccumulator -= 1000 / 60;
			if (isInfringing(MainHex)) {
				gameState = 2;
				gameOverDisplay();
			} else if (gameTicks >= HexaSessionRules.maxTicks) {
				pause();
				$('#gameMode').text('RUN TIME LIMIT · RETURN TO TITLE');
			}
		}
		if (officialRun && !officialRun.ending && gameTicks - officialRun.ackTick >= 300) syncOfficialRun(false);
	}
	if (gameState === 1) {
		render();
		updateComboDisplay();
	} else if (gameState === 0 && activeHomeTab === 'home' && !document.hidden) {
		renderTitleBoard(now);
	}
	requestAnimationFrame(animLoop);
}

function isInfringing(hex) {
	return hex.blocks.some(function(side) {
		return side.filter(function(block) { return !block.deleted; }).length > settings.rows;
	});
}