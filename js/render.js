function render() {
	var grey = '#dd9dcf';
	if (gameState === 0) {
		grey = '#c47bad';
	}
	
	clearGameBoard();
	if (gameState === 1 || gameState === 2 || gameState === -1 || gameState === 0) {
		if (op < 1) {
			op += 0.01;
		}
		ctx.globalAlpha = op;
		drawPolygon(trueCanvas.width / 2 , trueCanvas.height / 2 , 6, (settings.rows * settings.blockHeight) * (2/Math.sqrt(3)) + settings.hexWidth, 30, '#281234', 3 * settings.scale, grey);
		if (typeof drawBoardGuides === 'function') drawBoardGuides();
		drawTimer();
		ctx.globalAlpha = 1;
	}

	var i;
	for (i = 0; i < MainHex.blocks.length; i++) {
		for (var j = 0; j < MainHex.blocks[i].length; j++) {
			var block = MainHex.blocks[i][j];
			block.draw(true, j);
		}
	}
	for (i = 0; i < blocks.length; i++) {
		blocks[i].draw();
	}

	MainHex.draw();
	if (typeof drawClearEffects === 'function') drawClearEffects();
	if (gameState ==1 || gameState ==-1 || gameState === 0) {
		drawScoreboard();
	}

	for (i = 0; i < MainHex.texts.length; i++) {
		var alive = MainHex.texts[i].draw();
		if(!alive){
			MainHex.texts.splice(i,1);
			i--;
		}
	}

	if (gameState == -1) {
		ctx.globalAlpha = 0.9;
		ctx.fillStyle = '#190c28';
		ctx.fillRect(0, 0, trueCanvas.width, trueCanvas.height);
		ctx.globalAlpha = 1;
	}

	settings.prevScale = settings.scale;
	settings.hexWidth = settings.baseHexWidth * settings.scale;
	settings.blockHeight = settings.baseBlockHeight * settings.scale;
}

// Attract screen only: no gameplay clock, spawning, clears, or saved results.
function renderTitleBoard(now) {
	clearGameBoard();
	var reducedMotion = typeof reducedGameMotion === 'function' ? reducedGameMotion() : window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	var angle = 30 + (reducedMotion ? 0 : Math.sin(now / 6000) * 12);
	var x = trueCanvas.width / 2;
	var y = trueCanvas.height / 2;
	var titleScale = settings.scale;
	if (trueCanvas.width < trueCanvas.height && trueCanvas.height < 600) {
		y = trueCanvas.height * 0.45;
		titleScale = Math.min(titleScale, trueCanvas.height / 1300);
	}
	var radius = 105 * titleScale;
	ctx.save();
	drawPolygon(x, y, 6, radius, angle, '#5c2c5e', 2, '#efaada');
	for (var layer = 0; layer < 2; layer++) {
		for (var side = 0; side < 6; side++) {
			var inner = radius + (10 + layer * 26) * titleScale;
			var outer = inner + 20 * titleScale;
			ctx.beginPath();
			[[inner, side], [inner, side + 1], [outer, side + 1], [outer, side]].forEach(function(vertex, index) {
				var point = rotatePoint(0, vertex[0], angle + vertex[1] * 60);
				if (index === 0) ctx.moveTo(x + point.x, y + point.y);
				else ctx.lineTo(x + point.x, y + point.y);
			});
			ctx.closePath();
			ctx.fillStyle = colors[(side + layer * 2) % colors.length];
			ctx.globalAlpha = 1;
			ctx.strokeStyle = hexagonBackgroundColor;
			ctx.lineWidth = 4 * settings.scale;
			if (typeof drawJewelTile === 'function') {
				var points = [[inner, side], [inner, side + 1], [outer, side + 1], [outer, side]].map(function(vertex) {
					var point = rotatePoint(0, vertex[0], angle + vertex[1] * 60);
					return { x: x + point.x, y: y + point.y };
				});
				drawJewelTile(points, colors[(side + layer * 2) % colors.length], 1);
			} else { ctx.fill(); ctx.stroke(); }
		}
	}
	ctx.globalAlpha = 1;
	renderText(x, y, 62, '#ffd322', '✦');
	ctx.restore();
}
