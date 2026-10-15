// Original procedural instrument loops, generated locally with Web Audio.
// No recorded songs, streaming, autoplay, gameplay RNG, or simulation timers.
var musicTimer = null;
var musicBus = null;
var musicVoices = new Set();
var musicStep = 0;
var musicNextTime = 0;
var musicStyle = null;

function stopGameMusic() {
	if (musicTimer !== null) clearInterval(musicTimer);
	musicTimer = null;
	musicVoices.forEach(function(voice) { try { voice.stop(); } catch (error) {} });
	musicVoices.clear();
	if (musicBus) musicBus.disconnect();
	musicBus = null;
	musicStyle = null;
}

function musicTone(note, time, duration, type, volume, slide) {
	var oscillator = gameAudio.createOscillator();
	var gain = gameAudio.createGain();
	oscillator.type = type;
	var frequency = 440 * Math.pow(2, (note - 69) / 12);
	oscillator.frequency.setValueAtTime(frequency, time);
	if (slide) oscillator.frequency.exponentialRampToValueAtTime(frequency * slide, time + duration);
	gain.gain.setValueAtTime(0.0001, time);
	gain.gain.exponentialRampToValueAtTime(volume, time + Math.min(0.025, duration / 4));
	gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
	oscillator.connect(gain); gain.connect(musicBus);
	musicVoices.add(oscillator);
	oscillator.onended = function() { musicVoices.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
	oscillator.start(time); oscillator.stop(time + duration + 0.02);
}

function scheduleMusicBeat() {
	var rock = musicStyle === 'rock';
	var step = musicStep % 64;
	var beat = 60 / (rock ? 112 : 82) / 2;
	var root = (rock ? [40, 36, 43, 38] : [48, 45, 53, 43])[Math.floor(step / 16)];
	var time = musicNextTime;
	if (rock) {
		// Muted power-chord pulse, bass, kick and a short synthetic snare/hat.
		if (step % 2 === 0 || step % 8 === 7) {
			musicTone(root + 12, time, beat * 0.7, 'sawtooth', 0.035);
			musicTone(root + 19, time, beat * 0.65, 'triangle', 0.045);
			musicTone(root, time, beat * 0.85, 'triangle', 0.11);
		}
		if (step % 8 === 0 || step % 8 === 4) musicTone(36, time, 0.13, 'sine', 0.2, 0.28);
		if (step % 8 === 2 || step % 8 === 6) { musicTone(62, time, 0.08, 'triangle', 0.055, 0.4); musicTone(91, time, 0.045, 'sawtooth', 0.014); }
		musicTone(103, time, 0.028, 'square', 0.008);
	} else {
		// Slow major-seventh arpeggios over a soft bass and mellow pad.
		if (step % 16 === 0) [0, 4, 7, 11].forEach(function(interval) { musicTone(root + interval, time, beat * 13, 'sine', 0.035); });
		if (step % 4 === 0) musicTone(root - 12, time, beat * 3, 'sine', 0.11);
		musicTone(root + [12, 19, 16, 23, 19, 16, 24, 19][step % 8], time, beat * 1.6, 'sine', step % 2 ? 0.035 : 0.055);
		if (step % 4 === 0) musicTone(33, time, 0.12, 'sine', 0.07, 0.4);
	}
	musicStep++;
	musicNextTime += beat;
}

function syncGameMusic() {
	var style = playerPreferences.music;
	if (!style || style === 'off' || typeof gameState === 'undefined' || gameState !== 1 || document.hidden || !gameAudio || gameAudio.state !== 'running' || playerPreferences.musicVolume === 0) { stopGameMusic(); return; }
	if (musicTimer !== null && musicStyle === style) {
		musicBus.gain.setTargetAtTime(playerPreferences.musicVolume * 0.45, gameAudio.currentTime, 0.08);
		return;
	}
	stopGameMusic();
	try {
		musicStyle = style;
		musicBus = gameAudio.createGain();
		musicBus.gain.setValueAtTime(playerPreferences.musicVolume * 0.45, gameAudio.currentTime);
		musicBus.connect(gameAudio.destination);
		musicStep = 0;
		musicNextTime = gameAudio.currentTime + 0.04;
		var schedule = function() {
			if (document.hidden || gameState !== 1 || gameAudio.state !== 'running') { stopGameMusic(); return; }
			try {
				// Do not catch up a throttled tab with a burst of old notes.
				if (musicNextTime < gameAudio.currentTime) musicNextTime = gameAudio.currentTime + 0.04;
				while (musicNextTime < gameAudio.currentTime + 0.15) scheduleMusicBeat();
			} catch (error) { stopGameMusic(); }
		};
		musicTimer = setInterval(schedule, 80);
		schedule();
	} catch (error) { stopGameMusic(); }
}