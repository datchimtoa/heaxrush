// Presentation-only easing, measured in elapsed frames rather than refresh rate.
function easeRotationAngle(angle, target) {
	if (typeof reducedGameMotion === 'function' && reducedGameMotion()) return target;
	var frames = typeof renderFrameStep === 'number' ? renderFrameStep : 1;
	var next = target + (angle - target) * Math.pow(0.7, frames);
	return Math.abs(next - target) < 0.05 ? target : next;
}

function rotatePoint(x, y, theta) {
	var thetaRad = theta * (Math.PI / 180);
	var rotX = Math.cos(thetaRad) * x - Math.sin(thetaRad) * y;
	var rotY = Math.sin(thetaRad) * x + Math.cos(thetaRad) * y;

	return {
		x: rotX,
		y: rotY
	};
}

function randInt(min, max) {
	return Math.floor(((typeof gameRandom === 'function' ? gameRandom() : Math.random()) * max) + min);
}
