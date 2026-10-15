function Block(fallingLane, color, iter, distFromHex, settled) {
	// whether or not a block is rested on the center hex or another block
	this.settled = (settled === undefined) ? 0 : 1;
	this.height = settings.baseBlockHeight;
	//the lane which the block was shot from
	this.fallingLane = fallingLane;

		this.checked=0;
	//the angle at which the block falls
	this.angle = 90 - (30 + 60 * fallingLane);
	//for calculating the rotation of blocks attached to the center hex
	this.angularVelocity = 0;
	this.targetAngle = this.angle;
	this.color = color;
	//blocks that are slated to be deleted after a valid score has happened
	this.deleted = 0;
	//blocks slated to be removed from falling and added to the hex
	this.removed = 0;
	//value for the opacity of the white blcok drawn over falling block to give it the glow as it attaches to the hex
	this.tint = 0;
	//value used for deletion animation
	this.opacity = 1;
	//boolean for when the block is expanding
	this.initializing = 1;
	this.ict = MainHex.ct;
	//speed of block
	this.iter = iter;
	//number of iterations before starting to drop
	this.initLen = settings.creationDt;
	//side which block is attached too
	this.attachedLane = 0;
	//distance from center hex
	this.distFromHex = distFromHex || settings.startDist;

	this.incrementOpacity = function() {
		if (this.deleted) {
			//add shakes
			if (this.opacity >= 0.925) {
				var tLane = this.attachedLane - MainHex.position;
				tLane = MainHex.sides - tLane;
				while (tLane < 0) {
					tLane += MainHex.sides;
				}

				tLane %= MainHex.sides;
				MainHex.shakes.push({lane:tLane, magnitude:3 * (window.devicePixelRatio ? window.devicePixelRatio : 1) * (settings.scale)});
			}
			//fade out the opacity
			this.opacity = this.opacity - 0.075 * MainHex.dt;
			if (this.opacity <= 0) {
				//slate for final deletion
				this.opacity = 0;
				this.deleted = 2;
			}
		}
	};

	this.getIndex = function (){
		//get the index of the block in its stack
		var parentArr = MainHex.blocks[this.attachedLane];
		for (var i = 0; i < parentArr.length; i++) {
			if (parentArr[i] == this) {
				return i;
			}
		}
	};

	this.draw = function(attached, index) {
		var distance = this.distFromHex * settings.scale;
		var height = this.height * settings.scale;
		if(attached === undefined)
			attached = false;

		this.angle = easeRotationAngle(this.angle, this.targetAngle);
		
		this.width = 2 * distance / Math.sqrt(3);
		this.widthWide = 2 * (distance + height) / Math.sqrt(3);
		//this.widthWide = this.width + this.height + 3;
		var p1;
		var p2;
		var p3;
		var p4;
		if (this.initializing) {
			var rat = ((MainHex.ct - this.ict)/this.initLen);
			if (rat > 1) {
				rat = 1;
			}
			p1 = rotatePoint((-this.width / 2) * rat, height / 2, this.angle);
			p2 = rotatePoint((this.width / 2) * rat, height / 2, this.angle);
			p3 = rotatePoint((this.widthWide / 2) * rat, -height / 2, this.angle);
			p4 = rotatePoint((-this.widthWide / 2) * rat, -height / 2, this.angle);
		} else {
			p1 = rotatePoint(-this.width / 2, height / 2, this.angle);
			p2 = rotatePoint(this.width / 2, height / 2, this.angle);
			p3 = rotatePoint(this.widthWide / 2, -height / 2, this.angle);
			p4 = rotatePoint(-this.widthWide / 2, -height / 2, this.angle);
		}

		if (this.deleted) {
			ctx.fillStyle = "#FFF";
		} else if (gameState === 0) {
			if (this.color.charAt(0) == 'r') {
				ctx.fillStyle = rgbColorsToTintedColors[this.color];
			}
			else {
				ctx.fillStyle = hexColorsToTintedColors[this.color];
			}
		}
		else {
			ctx.fillStyle = this.color;
		}

		ctx.globalAlpha = this.opacity;
		var baseX = trueCanvas.width / 2 + Math.sin((this.angle) * (Math.PI / 180)) * (distance + height / 2) + gdx;
		var baseY = trueCanvas.height / 2 - Math.cos((this.angle) * (Math.PI / 180)) * (distance + height / 2) + gdy;
		ctx.beginPath();
		ctx.moveTo(baseX + p1.x, baseY + p1.y);
		ctx.lineTo(baseX + p2.x, baseY + p2.y);
		ctx.lineTo(baseX + p3.x, baseY + p3.y);
		ctx.lineTo(baseX + p4.x, baseY + p4.y);
		//ctx.lineTo(baseX + p1.x, baseY + p1.y);
		ctx.closePath();
		if (typeof drawJewelTile === 'function') {
			drawJewelTile([p1, p2, p3, p4].map(function(point) { return { x: baseX + point.x, y: baseY + point.y }; }), this.deleted ? '#fff4d6' : this.color, this.opacity);
		} else ctx.fill();

		if (this.tint) {
			ctx.fillStyle = "#FFF";
			ctx.globalAlpha = this.tint;
			ctx.beginPath();
			ctx.moveTo(baseX + p1.x, baseY + p1.y);
			ctx.lineTo(baseX + p2.x, baseY + p2.y);
			ctx.lineTo(baseX + p3.x, baseY + p3.y);
			ctx.lineTo(baseX + p4.x, baseY + p4.y);
			ctx.lineTo(baseX + p1.x, baseY + p1.y);
			ctx.closePath();
			ctx.fill();
		}

		ctx.globalAlpha = 1;
	};
}

function findCenterOfBlocks(arr) {
	var avgDFH = 0;
	var avgAngle = 0;
	for (var i = 0; i < arr.length; i++) {
		avgDFH += arr[i].distFromHex * settings.scale;
		var ang = arr[i].angle;
		while (ang < 0) {
			ang += 360;
		}
		
		avgAngle += ang % 360;
	}

	avgDFH /= arr.length;
	avgAngle /= arr.length;

	return {
		x:trueCanvas.width/2 + Math.cos(avgAngle * (Math.PI / 180)) * avgDFH,
		y:trueCanvas.height/2 + Math.sin(avgAngle * (Math.PI / 180)) * avgDFH
	};
}
