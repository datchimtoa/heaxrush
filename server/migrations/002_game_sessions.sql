ALTER TABLE users ADD COLUMN best_score NUMERIC(16,1) NOT NULL DEFAULT 0 CHECK (best_score >= 0);
ALTER TABLE users ADD COLUMN total_score NUMERIC(20,1) NOT NULL DEFAULT 0 CHECK (total_score >= 0);
ALTER TABLE users ADD COLUMN games_played INTEGER NOT NULL DEFAULT 0 CHECK (games_played >= 0);

CREATE TABLE game_sessions (
	id UUID PRIMARY KEY,
	user_id UUID NOT NULL REFERENCES users(id),
	request_id UUID NOT NULL,
	rules_version TEXT NOT NULL,
	seed BIGINT NOT NULL CHECK (seed BETWEEN 0 AND 4294967295),
	status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'finished', 'abandoned', 'expired')),
	started_at TIMESTAMPTZ NOT NULL,
	expires_at TIMESTAMPTZ NOT NULL,
	ended_at TIMESTAMPTZ,
	last_tick INTEGER NOT NULL DEFAULT 0 CHECK (last_tick BETWEEN 0 AND 108000),
	events JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(events) = 'array'),
	engine_state JSONB,
	server_score NUMERIC(16,1),
	max_combo INTEGER,
	blocks_cleared INTEGER,
	duration_ms INTEGER,
	UNIQUE (user_id, request_id)
);
CREATE UNIQUE INDEX game_sessions_one_active_idx ON game_sessions(user_id) WHERE status = 'active';
CREATE INDEX game_sessions_user_results_idx ON game_sessions(user_id, ended_at DESC) WHERE status = 'finished';

CREATE TABLE game_event_batches (
	session_id UUID NOT NULL REFERENCES game_sessions(id),
	from_tick INTEGER NOT NULL,
	to_tick INTEGER NOT NULL,
	payload_hash CHAR(64) NOT NULL,
	PRIMARY KEY (session_id, from_tick)
);