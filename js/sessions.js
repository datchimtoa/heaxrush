// Official results only come from authenticated replay APIs, never local storage.
var officialRun = null;
var runStarting = false;
var runGeneration = 0;
var gameTicks = 0;
var gameAccumulator = 0;

async function gameRequest(route, body) {
	var response = await fetch('/api/game/' + route, {
		method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body), signal: AbortSignal.timeout(10000)
	});
	if (!response.ok) throw new Error('Official request rejected (' + response.status + ')');
	return response.json();
}

function abandonOfficialRun() {
	var previous = officialRun;
	officialRun = null;
	if (!previous || previous.verified) return Promise.resolve();
	// Send after any in-flight batch; requests for the same run never race.
	return Promise.resolve(previous.sending).catch(function() {}).then(function() {
		return gameRequest(previous.id + '/abandon', {});
	}).catch(function() {});
}

async function startPlayerRun() {
	if (runStarting) return;
	unlockGameAudio();
	if (playerAccount.state === 'connecting' || playerAccount.state === 'error') {
		$('#runNotice').prop('hidden', false).text(playerAccount.state === 'connecting' ? 'Connecting… Try Play in a moment, or play a practice game.' : 'Could not connect. Retry in Profile → Connection, or play a practice game.');
		$('#practiceBtn').prop('hidden', false);
		return;
	}
	if (playerAccount.state !== 'connected') { startPracticeRun(); return; }
	runStarting = true;
	var generation = ++runGeneration;
	$('#startBtn, #restart, #restartBtn, #activityPlay').prop('disabled', true);
	$('#runNotice').prop('hidden', false).text('Loading…');
	$('#practiceBtn').prop('hidden', true);
	try {
		await abandonOfficialRun();
		var requestId = crypto.randomUUID();
		var descriptor;
		// Same request ID makes a lost start response safe to retry.
		try { descriptor = await gameRequest('start', { requestId: requestId }); }
		catch (error) { descriptor = await gameRequest('start', { requestId: requestId }); }
		if (generation !== runGeneration) { gameRequest(descriptor.id + '/abandon', {}).catch(function() {}); return; }
		if (descriptor.rulesVersion !== HexaSessionRules.version || descriptor.tick !== 0) throw new Error('Game version mismatch');
		init(descriptor.seed);
		officialRun = { id: descriptor.id, ackTick: 0, events: [], pending: null, sending: null, ending: false, verified: false };
		$('#gameMode').text('Chase your next best!');
		$('#currentHighScore').text(playerAccount.user.officialBest || 0);
		startFirstRunTutorial();
		gameFeedback('start');
	} catch (error) {
		if (generation === runGeneration) {
			// The old official session was abandoned before requesting a new one.
			// Never let a failed restart resume that board as local practice.
			if (gameState === -1) setStartScreen();
			$('#runNotice').prop('hidden', false).text('Could not start your game. Try Play again, or choose practice.');
			$('#practiceBtn').prop('hidden', false);
			if (gameState === 2) $('#resultSaveNote').text('New run unavailable · Retry Play again, or return to the title for practice.');
		}
	} finally {
		runStarting = false;
		$('#startBtn, #restart, #restartBtn, #activityPlay').prop('disabled', false);
	}
}

function rotatePlayer(steps) {
	if (gameState !== 1 || !MainHex.rotate(steps)) return;
	if (officialRun) officialRun.events.push({ tick: gameTicks, type: 'rotate', value: steps });
}

function setPlayerRush(enabled) {
	if ((rush === 4) === enabled) return;
	if (officialRun && gameState === 1) officialRun.events.push({ tick: gameTicks, type: 'rush', value: enabled });
	rush = enabled ? 4 : 1;
	settings.speedUpKeyHeld = enabled;
}

function syncOfficialRun(ending) {
	var run = officialRun;
	if (!run || run.verified) return Promise.resolve();
	if (ending) run.ending = true;
	if (run.sending) return run.sending;
	run.sending = (async function() {
		try {
			while (run.ackTick < gameTicks) {
				if (officialRun !== run) return;
				if (!run.pending) {
					var toTick = Math.min(gameTicks, run.ackTick + HexaSessionRules.batchTicks);
					run.pending = { fromTick: run.ackTick, toTick: toTick, events: run.events.filter(function(event) { return event.tick >= run.ackTick && event.tick < toTick; }) };
				}
				var response = await gameRequest(run.id + '/events', run.pending);
				if (response.tick < run.pending.toTick) throw new Error('Input not acknowledged');
				run.ackTick = run.pending.toTick;
				run.pending = null;
				run.events = run.events.filter(function(event) { return event.tick >= run.ackTick; });
				if (!run.ending) break;
			}
			if (run.ending && officialRun === run) {
				var result = await gameRequest(run.id + '/finish', {});
				if (officialRun !== run) return;
				run.verified = true;
				$('#cScore').text(result.score);
				$('#liveScore').text(result.score);
				$('#gameMode').text('NICE RUN');
				$('#bestCombo').text('x' + result.maxCombo);
				$('#resultCleared').text(result.blocksCleared);
				$('#resultDuration').text(formatRunTime(Math.floor(result.durationMs / 1000)));
				playerAccount.user.officialBest = result.bestScore;
				$('#bestScore, #currentHighScore').text(playerAccount.user.officialBest);
				$('#resultSaveNote').text('Score saved to your account');
				$('#resultInsight').text('Nice run. Ready to beat your best?');
				if (typeof showResultCoins === 'function') showResultCoins(result.coins);
				$('#resultEyebrow').text('NICE RUN');
				$('#retryResult').prop('hidden', true);
				if (typeof loadResultAd === 'function') loadResultAd();
			} else if (officialRun === run) {
				if (gameTicks < HexaSessionRules.maxTicks) $('#gameMode').text('Chase your next best!');
				$('#runNotice').prop('hidden', true);
			}
		} catch (error) {
			if (officialRun !== run) return;
			if (run.ending) {
				$('#resultEyebrow').text('SCORE NOT SAVED');
				$('#resultSaveNote').text('Could not save your score. Tap Retry saving to try again.');
				$('#retryResult').prop('hidden', false);
			} else {
				if (gameState === 1) pause();
				$('#gameMode').text('Connection lost. Reconnect to keep playing.');
			}
		} finally { run.sending = null; }
	})();
	return run.sending;
}