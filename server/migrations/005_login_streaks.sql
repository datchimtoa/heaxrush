-- Start empty at release: never reconstruct visits from old auth sessions.
-- Display-only retention state, not a reward entitlement or Coin balance.
CREATE TABLE login_streaks (
	user_id UUID PRIMARY KEY REFERENCES users(id),
	last_launch_day DATE NOT NULL,
	days INTEGER NOT NULL CHECK (days > 0)
);