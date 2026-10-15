-- Empty, prospective relationships only. Never infer referrals from old accounts.
CREATE TABLE referral_codes (
	user_id UUID PRIMARY KEY REFERENCES users(id),
	code TEXT NOT NULL UNIQUE CHECK (code ~ '^ref_[a-f0-9]{32}$'),
	created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE referrals (
	invitee_id UUID PRIMARY KEY REFERENCES users(id),
	referrer_id UUID NOT NULL REFERENCES users(id),
	attributed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
	CHECK (invitee_id <> referrer_id)
);

CREATE INDEX referrals_owner_idx ON referrals(referrer_id, invitee_id);