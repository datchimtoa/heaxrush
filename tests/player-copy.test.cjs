const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { createAchievementStore } = require('../server/achievements.cjs');
const { createDailyStore } = require('../server/daily.cjs');

test('player menus use gameplay copy, keep rewards honest and preserve accessible credits', () => {
	const html = readFileSync(path.join(__dirname, '../index.html'), 'utf8');
	assert.doesNotMatch(html, /verified|verification|unflagged|entitlement|backfill|attribution|server-owned|trusted review|aggregate counts|official scores/i);
	assert.match(html, /FRIENDS JOINED/); assert.match(html, /PLAYED 3 GAMES/);
	assert.match(html, /Referral rewards are not active/);
	assert.match(html, /Quest and streak rewards are not active/);
	assert.match(html, /Coin rewards are not active/);
	assert.match(html, /Retry saving/);
	assert.match(html, /credits\.html.*Credits &amp; license · GPLv3/);
	assert.doesNotMatch(html, /counts? (?:only )?once|one referrer/i);
	for (const file of ['player', 'sessions', 'view', 'referrals', 'daily', 'achievements', 'coins']) {
		const source = readFileSync(path.join(__dirname, '../js', file + '.js'), 'utf8');
		// Inspect displayed text, not backend flags, variable names or code comments.
		const textCalls = source.match(/\.text\([^;]*;/g) || [];
		assert.doesNotMatch(textCalls.join('\n'), /verified|verification|unflagged|entitlement|APP_ORIGIN|PostgreSQL|initData|trusted review|need approval/i, file);
	}
});

test('API-provided quest and milestone descriptions use gameplay language without changing thresholds', async () => {
	const pool = { async query() { return { rows: [{ best_score: 1000, best_combo: 4, completed_games: 3, last_launch_day: null }] }; } };
	const achievements = await createAchievementStore(pool).progress('owner');
	const daily = await createDailyStore(pool, () => Date.parse('2026-10-14T12:00:00Z')).progress('owner');
	assert.deepEqual(achievements.milestones.map(row => row.target), [500, 1000, 2000, 4]);
	assert.deepEqual(daily.quests.map(row => row.target), [3, 800, 3]);
	assert.equal(achievements.rewardsEnabled, false); assert.equal(daily.rewardsEnabled, false);
	assert.doesNotMatch(JSON.stringify([...achievements.milestones, ...daily.quests]), /verified|verification|entitlement/i);
	assert.match(achievements.milestones[3].description, /2\.5× points/);
	assert.match(daily.quests[2].description, /2× points/);
});