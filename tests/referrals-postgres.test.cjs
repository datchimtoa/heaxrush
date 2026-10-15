// TEST_DATABASE_URL must identify a disposable database, never active player data.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const { Pool } = require('pg');
const { migrate } = require('../server/migrate.cjs');
const { createStore } = require('../server/store.cjs');
const { createReferralStore } = require('../server/referrals.cjs');
const { rules } = require('../server/replay.cjs');

test('disposable PostgreSQL referral migration, competing first logins, code retries, rollback and flagged progress', { skip: !process.env.TEST_DATABASE_URL }, async () => {
	const schema = 'referral_test_' + randomUUID().replaceAll('-', '');
	const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
	await admin.query(`CREATE SCHEMA ${schema}`);
	const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}`, max: 10 });
	try {
		await migrate(pool); await migrate(pool);
		for (const table of ['referral_codes', 'referrals']) assert.equal((await pool.query(`SELECT COUNT(*) AS count FROM ${table}`)).rows[0].count, '0');
		const store = createStore(pool, Date.now, { referralsEnabled: true }), referrals = createReferralStore(pool, 'alodvipbot');
		const input = (id, startParam) => ({ user: { telegramId: String(id), firstName: 'Fixture', lastName: '', username: null },
			tokenHash: randomBytes(32).toString('hex'), launchHash: randomBytes(32).toString('hex'), expiresAt: new Date(Date.now() + 60000), startParam });
		const first = await store.login(input(10001)), second = await store.login(input(10002));
		assert.equal((await referrals.summary(first.id)).inviteLink, null, 'GET does not generate a code');
		const links = await Promise.all(Array.from({ length: 6 }, () => referrals.createCode(first.id)));
		assert.ok(links.every(link => link.inviteLink === links[0].inviteLink));
		const codeA = new URL(links[0].inviteLink).searchParams.get('startapp');
		assert.equal(codeA, 'ref_' + first.telegramId);
		const codeB = new URL((await referrals.createCode(second.id)).inviteLink).searchParams.get('startapp');
		assert.equal(codeB, 'ref_' + second.telegramId);
		const legacyCode = 'ref_' + randomBytes(16).toString('hex');
		await pool.query('UPDATE referral_codes SET code = $1 WHERE user_id = $2', [legacyCode, first.id]);
		assert.equal((await referrals.createCode(first.id)).inviteLink, links[0].inviteLink);
		assert.equal((await pool.query('SELECT code FROM referral_codes WHERE user_id = $1', [first.id])).rows[0].code, legacyCode);
		const legacyInvitee = await store.login(input(10011, legacyCode));
		assert.equal((await pool.query('SELECT referrer_id FROM referrals WHERE invitee_id = $1', [legacyInvitee.id])).rows[0].referrer_id, first.id);
		const uuidInvitee = await store.login(input(10012, 'ref_' + first.id));
		assert.equal((await pool.query('SELECT referrer_id FROM referrals WHERE invitee_id = $1', [uuidInvitee.id])).rows[0].referrer_id, first.id);
		const concurrent = await Promise.all([store.login(input(10003, codeA)), store.login(input(10003, codeB))]);
		assert.equal(concurrent[0].id, concurrent[1].id);
		const relation = (await pool.query('SELECT * FROM referrals WHERE invitee_id = $1', [concurrent[0].id])).rows[0];
		assert.ok([first.id, second.id].includes(relation.referrer_id));
		await store.login(input(10003, relation.referrer_id === first.id ? codeB : codeA));
		await store.recordLaunch(concurrent[0].id);
		assert.deepEqual((await pool.query('SELECT * FROM referrals WHERE invitee_id = $1', [concurrent[0].id])).rows[0], relation);
		assert.equal((await pool.query('SELECT days FROM login_streaks WHERE user_id = $1', [concurrent[0].id])).rows[0].days, 1);
		const replay = input(10004, codeA); await store.login(replay);
		await assert.rejects(store.login({ ...replay, user: { ...replay.user, telegramId: '10005' }, tokenHash: randomBytes(32).toString('hex') }), /already used/);
		assert.equal((await pool.query('SELECT id FROM users WHERE telegram_id = 10005')).rowCount, 0, 'failed login rolls new account and relationship back');
		await pool.query(`CREATE FUNCTION reject_referral_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture referral failure'; END $$`);
		await pool.query('CREATE TRIGGER reject_referral_fixture BEFORE INSERT ON referrals FOR EACH ROW EXECUTE FUNCTION reject_referral_fixture()');
		await assert.rejects(store.login(input(10010, codeA)), /fixture referral failure/);
		assert.equal((await pool.query('SELECT id FROM users WHERE telegram_id = 10010')).rowCount, 0, 'attribution failure rolls account/auth/streak back');
		await pool.query('DROP TRIGGER reject_referral_fixture ON referrals');
		for (const [id, param] of [[10006, undefined], [10007, 'invalid'], [10008, 'ref_' + '0'.repeat(32)]]) {
			const account = await store.login(input(id, param)); await store.login(input(id, codeA));
			assert.equal((await pool.query('SELECT * FROM referrals WHERE invitee_id = $1', [account.id])).rowCount, 0);
		}
		await store.login(input(10001, codeA));
		assert.equal((await pool.query('SELECT * FROM referrals WHERE invitee_id = $1', [first.id])).rowCount, 0, 'self and existing accounts never attach');
		await pool.query("UPDATE users SET status = 'blocked' WHERE id = $1", [second.id]);
		const blockedInvite = await store.login(input(10009, codeB));
		assert.equal((await pool.query('SELECT * FROM referrals WHERE invitee_id = $1', [blockedInvite.id])).rowCount, 0);
		await assert.rejects(referrals.createCode(second.id), /Account unavailable/);
		await assert.rejects(referrals.summary(second.id), /Account unavailable/);
		await pool.query("UPDATE users SET status = 'active' WHERE id = $1", [second.id]);
		const ended = relation.attributed_at;
		const game = async (offset = 0, status = 'finished', version = rules.version, flagged = false) => {
			const id = randomUUID();
			await pool.query(`INSERT INTO game_sessions (id, user_id, request_id, rules_version, seed, status, started_at, expires_at, ended_at, server_score, flagged_at)
				VALUES ($1, $2, $3, $4, 1, $5, $7, $7,
					(SELECT attributed_at FROM referrals WHERE invitee_id = $2) + $6 * INTERVAL '1 millisecond', 10, $8)`,
				[id, concurrent[0].id, randomUUID(), version, status, offset, new Date(ended.getTime() + 60000), flagged ? ended : null]);
			return id;
		};
		await game(-1); await game(0, 'abandoned'); await game(0, 'expired'); await game(0, 'finished', 'old-rules'); await game(0, 'finished', rules.version, true);
		const baseline = await referrals.summary(relation.referrer_id); assert.equal(baseline.reachedAccounts, 0);
		await game(); await game(); assert.equal((await referrals.summary(relation.referrer_id)).reachedAccounts, 0);
		const third = await game(); assert.equal((await referrals.summary(relation.referrer_id)).reachedAccounts, 1);
		await pool.query('UPDATE game_sessions SET flagged_at = NOW() WHERE id = $1', [third]);
		assert.equal((await referrals.summary(relation.referrer_id)).reachedAccounts, 0);
		await pool.query("UPDATE users SET status = 'blocked' WHERE id = $1", [concurrent[0].id]);
		assert.equal((await referrals.summary(relation.referrer_id)).invitedAccounts, baseline.invitedAccounts - 1);
		for (const table of ['coin_ledger', 'user_achievements']) assert.equal((await pool.query(`SELECT COUNT(*) AS count FROM ${table}`)).rows[0].count, '0');
	} finally {
		await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
	}
});