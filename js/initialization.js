$(document).ready(function() {
	window.colors = ['#e74c3c', '#f1c40f', '#3498db', '#2ecc71', '#9b59b6'];
	window.hexColorsToTintedColors = {
		'#e74c3c': 'rgb(241,163,155)', '#f1c40f': 'rgb(246,223,133)',
		'#3498db': 'rgb(151,201,235)', '#2ecc71': 'rgb(150,227,183)',
		'#9b59b6': 'rgb(205,172,219)'
	};
	window.rgbToHex = {
		'rgb(231,76,60)': '#e74c3c', 'rgb(241,196,15)': '#f1c40f',
		'rgb(52,152,219)': '#3498db', 'rgb(46,204,113)': '#2ecc71',
		'rgb(155,89,182)': '#9b59b6'
	};
	window.rgbColorsToTintedColors = {};
	Object.keys(rgbToHex).forEach(function(color) {
		rgbColorsToTintedColors[color] = hexColorsToTintedColors[rgbToHex[color]];
	});
	window.hexagonBackgroundColor = '#101525';
	window.centerBlue = '#232e48';
	window.angularVelocityConst = 4;
	window.settings = {
		platform: /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ? 'mobile' : 'nonmobile',
		baseHexWidth: 87, baseBlockHeight: 20, hexWidth: 87, blockHeight: 20,
		scale: 1, prevScale: 1, rows: 7, startDist: 350, creationDt: 18,
		speedModifier: 0.65, creationSpeedModifier: 0.65, comboTime: 300,
		speedUpKeyHeld: false
	};
	window.canvas = document.getElementById('canvas');
	canvas.tabIndex = -1;
	window.ctx = canvas.getContext('2d');
	window.trueCanvas = { width: window.innerWidth, height: window.innerHeight };
	window.highscores = readHighScores();
	window.blocks = [];
	window.gameState = 0;
	window.gdx = 0;
	window.gdy = 0;
	window.op = 1;
	window.score = 0;
	window.rush = 1;
	window.lastTime = performance.now();
	scaleCanvas();
	$('#currentHighScore').text(highscores[0] || 0);
	initializePlayerHub();
	setStartScreen();
	addKeyListeners();
	startTelegramAuth();
	window.addEventListener('resize', scaleCanvas);
	window.addEventListener('blur', function() { if (gameState === 1) pause(); });
	document.addEventListener('visibilitychange', function() {
		if (document.hidden && gameState === 1) pause();
		syncGameMusic();
	});
	requestAnimationFrame(animLoop);
});