-- Existing sessions remain ineligible: no historical reward backfill.
ALTER TABLE game_sessions ADD COLUMN reward_eligible BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE game_sessions ADD COLUMN flagged_at TIMESTAMPTZ;
ALTER TABLE game_sessions ADD COLUMN flag_reason TEXT CHECK (length(flag_reason) BETWEEN 1 AND 220);
ALTER TABLE game_sessions ADD COLUMN coins_reversed BIGINT NOT NULL DEFAULT 0 CHECK (coins_reversed >= 0 AND coins_reversed <= coins_awarded);
ALTER TABLE game_sessions ADD CONSTRAINT game_sessions_flag_details CHECK ((flagged_at IS NULL) = (flag_reason IS NULL));

ALTER TABLE coin_ledger ADD COLUMN session_id UUID REFERENCES game_sessions(id);
CREATE INDEX coin_ledger_session_idx ON coin_ledger(session_id) WHERE session_id IS NOT NULL;

-- Entitlements are not balances. No payout/forfeiture/carry-forward policy is implied.
CREATE TABLE user_achievements (
	user_id UUID NOT NULL REFERENCES users(id),
	code TEXT NOT NULL CHECK (code IN ('score_500', 'score_1000', 'score_2000', 'combo_4')),
	session_id UUID NOT NULL REFERENCES game_sessions(id),
	bonus_amount INTEGER NOT NULL,
	unlocked_at TIMESTAMPTZ NOT NULL,
	invalidated_at TIMESTAMPTZ,
	PRIMARY KEY (user_id, code),
	CHECK ((code = 'score_500' AND bonus_amount = 50) OR
		(code = 'score_1000' AND bonus_amount = 150) OR
		(code = 'score_2000' AND bonus_amount = 500) OR
		(code = 'combo_4' AND bonus_amount = 100))
);