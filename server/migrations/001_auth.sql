CREATE TABLE users (
	id UUID PRIMARY KEY,
	telegram_id BIGINT NOT NULL UNIQUE CHECK (telegram_id > 0),
	first_name TEXT NOT NULL,
	last_name TEXT NOT NULL DEFAULT '',
	username TEXT,
	language_code TEXT,
	status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE auth_sessions (
	token_hash CHAR(64) PRIMARY KEY,
	user_id UUID NOT NULL REFERENCES users(id),
	launch_hash CHAR(64) NOT NULL UNIQUE,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	expires_at TIMESTAMPTZ NOT NULL,
	revoked_at TIMESTAMPTZ
);

CREATE INDEX auth_sessions_user_id_idx ON auth_sessions(user_id);
CREATE INDEX auth_sessions_expiry_idx ON auth_sessions(expires_at);