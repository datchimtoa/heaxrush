ALTER TABLE users ADD COLUMN coin_balance BIGINT NOT NULL DEFAULT 0 CHECK (coin_balance BETWEEN 0 AND 9007199254740991);
ALTER TABLE users ADD COLUMN coins_held BIGINT NOT NULL DEFAULT 0 CHECK (coins_held BETWEEN 0 AND 9007199254740991);
ALTER TABLE game_sessions ADD COLUMN coins_awarded BIGINT NOT NULL DEFAULT 0 CHECK (coins_awarded BETWEEN 0 AND 9007199254740991);

CREATE TABLE coin_ledger (
	id UUID PRIMARY KEY,
	user_id UUID NOT NULL REFERENCES users(id),
	change_type TEXT NOT NULL CHECK (change_type IN ('earn', 'spend', 'hold', 'release', 'reverse')),
	amount BIGINT NOT NULL CHECK (amount BETWEEN 1 AND 9007199254740991),
	balance_before BIGINT NOT NULL CHECK (balance_before BETWEEN 0 AND 9007199254740991),
	balance_after BIGINT NOT NULL CHECK (balance_after BETWEEN 0 AND 9007199254740991),
	held_before BIGINT NOT NULL CHECK (held_before BETWEEN 0 AND 9007199254740991),
	held_after BIGINT NOT NULL CHECK (held_after BETWEEN 0 AND 9007199254740991),
	source TEXT NOT NULL CHECK (length(source) BETWEEN 1 AND 64),
	reference_id TEXT NOT NULL CHECK (length(reference_id) BETWEEN 1 AND 128),
	reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 256),
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	UNIQUE (user_id, source, reference_id, change_type),
	CHECK (
		(change_type = 'earn' AND balance_after = balance_before + amount AND held_after = held_before) OR
		(change_type IN ('spend', 'reverse') AND balance_after = balance_before - amount AND held_after = held_before) OR
		(change_type = 'hold' AND balance_after = balance_before - amount AND held_after = held_before + amount) OR
		(change_type = 'release' AND balance_after = balance_before + amount AND held_after = held_before - amount)
	)
);
CREATE INDEX coin_ledger_history_idx ON coin_ledger(user_id, created_at DESC, id DESC);

-- Corrections are new entries; history must never be edited or erased.
CREATE FUNCTION reject_coin_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'Coin ledger is append-only';
END;
$$;
CREATE TRIGGER coin_ledger_append_only BEFORE UPDATE OR DELETE ON coin_ledger
	FOR EACH ROW EXECUTE FUNCTION reject_coin_ledger_mutation();
CREATE TRIGGER coin_ledger_no_truncate BEFORE TRUNCATE ON coin_ledger
	FOR EACH STATEMENT EXECUTE FUNCTION reject_coin_ledger_mutation();
