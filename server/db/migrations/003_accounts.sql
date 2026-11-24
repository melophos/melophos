-- Issue 24: accounts, revocable sign-in sessions, device credentials and pairing codes.

-- addresses are stored lower case so the unique index really is unique per person
ALTER TABLE users ADD CONSTRAINT users_email_lower CHECK (email = lower(email));

-- a sign-in. Only the hash of the token is stored, so a database leak does not hand out working sessions
CREATE TABLE auth_sessions (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash   bytea NOT NULL UNIQUE,
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz,
    expires_at   timestamptz NOT NULL,
    revoked_at   timestamptz,
    user_agent   text
);
CREATE INDEX auth_sessions_user ON auth_sessions (user_id, created_at DESC);

-- the hub's credential, hashed. A device with no owner is waiting to be claimed with a pairing code
ALTER TABLE devices ADD COLUMN credential_hash bytea;
ALTER TABLE devices ADD COLUMN paired_at timestamptz;

CREATE TABLE pairing_codes (
    code_hash  bytea PRIMARY KEY,
    device_id  text NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    claimed_at timestamptz
);
CREATE INDEX pairing_codes_device ON pairing_codes (device_id);
CREATE INDEX pairing_codes_expiry ON pairing_codes (expires_at);

-- fixed-window counters shared by every server process
CREATE TABLE rate_limits (
    bucket       text NOT NULL,
    window_start timestamptz NOT NULL,
    hits         integer NOT NULL DEFAULT 0,
    PRIMARY KEY (bucket, window_start)
);
CREATE INDEX rate_limits_window ON rate_limits (window_start);
