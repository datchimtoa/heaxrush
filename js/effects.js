// Presentation only: never use the seeded game RNG or change simulation state.
var clearParticles = [];
var effectSerial = 0;
var rotationGlowUntil = 0;
var gameMotionQuery = null;

function reducedGameMotion() {
	if (!gameMotionQuery && window.matchMedia) gameMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
	return !!(gameMotionQuery && gameMotionQuery.matches);
}

function tilePath(points, inset) {
	var center = points.reduce(function(sum, point) { return { x: sum.x + point.x / points.length, y: sum.y + point.y / points.length }; }, { x: 0, y: 0 });
	var vertices = points.map(function(point) { return { x: point.x + (center.x - point.x) * inset, y: point.y + (center.y - point.y) * inset }; });
	ctx.beginPath();
	vertices.forEach(function(point, index) {
		var next = vertices[(index + 1) % vertices.length];
		var previous = vertices[(index + vertices.length - 1) % vertices.length];
		var radius = 0.07;
		var x = point.x + (previous.x - point.x) * radius;
		var y = point.y + (previous.y - point.y) * radius;
		if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
		ctx.quadraticCurveTo(point.x, point.y, point.x + (next.x - point.x) * radius, point.y + (next.y - point.y) * radius);
	});
	ctx.closePath();
}

function drawJewelTile(points, color, alpha) {
	ctx.save();
	ctx.globalAlpha = alpha;
	tilePath(points, 0.025);
	ctx.fillStyle = color;
	ctx.fill();
	// Two inexpensive bevel strokes instead of per-tile blur, clip and gradient.
	ctx.strokeStyle = '#190c2888';
	ctx.lineWidth = Math.max(0.6, 1.5 * settings.scale);
	ctx.stroke();
	ctx.strokeStyle = '#ffffff44';
	tilePath(points, 0.13);
	ctx.stroke();
	ctx.restore();
}

function drawJewelCore(x, y, radius, angle) {
	var points = [];
	for (var i = 0; i < 6; i++) {
		var point = rotatePoint(0, radius, angle + i * 60);
		points.push({ x: x + point.x, y: y + point.y });
	}
	drawJewelTile(points, '#5c2c5e', 1);
}

function drawBoardGuides() {
	ctx.save();
	ctx.setLineDash([2 * settings.scale, 7 * settings.scale]);
	for (var row = 2; row <= 6; row += 2) {
		drawPolygon(trueCanvas.width / 2, trueCanvas.height / 2, 6, (settings.baseHexWidth + row * settings.baseBlockHeight * 2 / Math.sqrt(3)) * settings.scale, 30, 'transparent', settings.scale, '#dd9dcf35');
	}
	ctx.restore();
}

function resetGameEffects() {
	clearParticles = [];
	rotationGlowUntil = 0;
	var callout = document.getElementById('clearCallout');
	if (callout) { callout.hidden = true; callout.getAnimations().forEach(function(animation) { animation.cancel(); }); }
	var scoreLabel = document.getElementById('liveScore');
	if (scoreLabel) scoreLabel.getAnimations().forEach(function(animation) { animation.cancel(); });
}

function celebrateClear(level) {
	if (typeof MainHex === 'undefined' || typeof document === 'undefined' || document.hidden || gameState !== 1) return;
	var callout = document.getElementById('clearCallout');
	if (callout) {
		callout.hidden = false;
		callout.textContent = level >= 5 ? 'Unstoppable!' : level >= 3 ? 'On fire!' : level === 2 ? 'Sweet combo!' : 'Nice match!';
		callout.getAnimations().forEach(function(animation) { animation.cancel(); });
		callout.animate(reducedGameMotion() ? [{ opacity: 1, offset: 0.7 }, { opacity: 0 }] : [
			{ opacity: 0, transform: 'translate(-50%, 12px) scale(.75)' },
			{ opacity: 1, transform: 'translate(-50%, 0) scale(1.08)', offset: 0.18 },
			{ opacity: 1, transform: 'translate(-50%, 0) scale(1)', offset: 0.65 },
			{ opacity: 0, transform: 'translate(-50%, -12px) scale(1)' }
		], { duration: 1100, fill: 'forwards' });
	}
	var scoreLabel = document.getElementById('liveScore');
	if (scoreLabel && !reducedGameMotion()) {
		scoreLabel.getAnimations().forEach(function(animation) { animation.cancel(); });
		scoreLabel.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.22)', color: '#ffe49b', offset: 0.4 }, { transform: 'scale(1)' }], { duration: 350 });
	}
	if (reducedGameMotion()) { clearParticles = []; return; }
	var now = performance.now();
	effectSerial++;
	MainHex.blocks.forEach(function(side) {
		side.forEach(function(block) {
			if (block.deleted !== 1 || block.opacity < 1) return;
			var angle = block.targetAngle * Math.PI / 180;
			var distance = block.distFromHex + block.height / 2;
			for (var i = 0; i < 6; i++) {
				var direction = (i / 6 * Math.PI * 2) + effectSerial * 0.7;
				clearParticles.push({ x: Math.sin(angle) * distance, y: -Math.cos(angle) * distance, vx: Math.cos(direction) * (45 + i * 8), vy: Math.sin(direction) * (45 + i * 8), color: block.color, born: now, size: i % 2 ? 3 : 5 });
			}
		});
	});
	clearParticles = clearParticles.slice(-120);
}

function drawClearEffects() {
	if (reducedGameMotion()) { clearParticles = []; return; }
	var now = performance.now();
	clearParticles = clearParticles.filter(function(particle) { return now - particle.born < 850; });
	ctx.save();
	if (now < rotationGlowUntil) {
		ctx.globalAlpha = (rotationGlowUntil - now) / 220 * 0.45;
		drawPolygon(trueCanvas.width / 2, trueCanvas.height / 2, 6, settings.hexWidth + 7 * settings.scale, MainHex.angle, 'transparent', 4 * settings.scale, '#d7dfff');
	}
	clearParticles.forEach(function(particle) {
		var age = (now - particle.born) / 1000;
		var x = trueCanvas.width / 2 + (particle.x + particle.vx * age) * settings.scale;
		var y = trueCanvas.height / 2 + (particle.y + particle.vy * age + age * age * 60) * settings.scale;
		var size = particle.size * settings.scale * (1 - age / 0.85);
		ctx.globalAlpha = 1 - age / 0.85;
		ctx.fillStyle = particle.color;
		ctx.beginPath();
		ctx.moveTo(x, y - size * 1.6); ctx.lineTo(x + size, y); ctx.lineTo(x, y + size * 1.6); ctx.lineTo(x - size, y);
		ctx.closePath(); ctx.fill();
	});
	ctx.restore();
}