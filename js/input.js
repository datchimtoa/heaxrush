function addKeyListeners() {
	$('#startBtn, #restart, #restartBtn').on('click', startPlayerRun);
	$('#homeBtn, #pauseHomeBtn').on('click', setStartScreen);
	$('#pauseBtn, #resumeBtn').on('click', pause);
	$('#pauseHelp, #closeHelp').on('click', showHelp);
	$('#rotateLeft').on('pointerdown', function(e) { e.preventDefault(); rotatePlayer(1); });
	$('#rotateRight').on('pointerdown', function(e) { e.preventDefault(); rotatePlayer(-1); });
	$('#practiceBtn').on('click', startPracticeRun);
	$('#retryResult').on('click', function() { syncOfficialRun(true); });
	canvas.addEventListener('pointerdown', function(e) {
		if (gameState !== 1) return;
		e.preventDefault();
		var bounds = canvas.getBoundingClientRect();
		rotatePlayer(e.clientX < bounds.left + bounds.width / 2 ? 1 : -1);
	});
	document.addEventListener('keydown', function(e) {
		var key = e.key.toLowerCase();
		var dialog = document.querySelector('.modal-backdrop:not([hidden])');
		if (key === 'tab' && dialog) {
			var focusable = Array.from(dialog.querySelectorAll('button, a[href]')).filter(function(element) { return !element.hidden && !element.disabled; });
			var first = focusable[0];
			var last = focusable[focusable.length - 1];
			if (e.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
				e.preventDefault(); last.focus();
			} else if (!e.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
				e.preventDefault(); first.focus();
			}
			return;
		}
		if (!$('#helpScreen').prop('hidden')) {
			if (key === 'escape') { e.preventDefault(); showHelp(); }
			return;
		}
		if ((key === 'p' || key === 'escape') && !e.repeat) {
			e.preventDefault();
			if (key === 'escape' && gameState === 0 && activeHomeTab !== 'home') {
				goBackHomeTab();
			} else pause();
			return;
		}
		if (e.target.closest('button, a, select, input')) return;
		if (['arrowleft', 'arrowright', 'arrowdown', ' ', 'enter'].indexOf(key) !== -1) e.preventDefault();
		if (key === 'enter' && !e.repeat && ((gameState === 0 && activeHomeTab === 'home') || gameState === 2)) startPlayerRun();
		if (key === ' ' && !e.repeat) pause();
		if (gameState !== 1) return;
		if (key === 'arrowleft' || key === 'a') rotatePlayer(1);
		if (key === 'arrowright' || key === 'd') rotatePlayer(-1);
		if (key === 'arrowdown' || key === 's') {
			setPlayerRush(true);
		}
	});
	document.addEventListener('keyup', function(e) {
		if (['arrowdown', 's'].indexOf(e.key.toLowerCase()) !== -1) {
			setPlayerRush(false);
		}
	});
}