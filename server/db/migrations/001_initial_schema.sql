-- MELOPHOS initial schema.
-- note_events is a TimescaleDB hypertable because it grows by thousands of rows
-- per practice session; everything else is ordinary Postgres.

CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email         text NOT NULL UNIQUE,
    display_name  text NOT NULL,
    password_hash text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- a hub or a simulator standing in for one
CREATE TABLE devices (
    id           text PRIMARY KEY,
    owner_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name         text NOT NULL,
    hardware_rev text,
    firmware     text,
    last_seen_at timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now()
);

-- an instrument a user plays, bound to a profile from profiles/
CREATE TABLE instruments (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name       text NOT NULL,
    profile_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE songs (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    title        text NOT NULL,
    artist       text,
    source_kind  text NOT NULL CHECK (source_kind IN ('midi', 'audio', 'video', 'recording')),
    object_key   text,
    import_state text NOT NULL DEFAULT 'queued' CHECK (import_state IN ('queued', 'running', 'ready', 'failed')),
    public       boolean NOT NULL DEFAULT false,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE practice_sessions (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id     text NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
    instrument_id uuid REFERENCES instruments (id) ON DELETE SET NULL,
    song_id       uuid REFERENCES songs (id) ON DELETE SET NULL,
    mode          text CHECK (mode IN ('melody', 'rhythm', 'listen', 'free')),
    started_at    timestamptz NOT NULL,
    ended_at      timestamptz,
    notes_played  integer NOT NULL DEFAULT 0,
    accuracy      real CHECK (accuracy BETWEEN 0 AND 1),
    tempo_bpm     real
);
CREATE INDEX practice_sessions_device_started ON practice_sessions (device_id, started_at DESC);

CREATE TABLE note_events (
    session_id uuid NOT NULL REFERENCES practice_sessions (id) ON DELETE CASCADE,
    at         timestamptz NOT NULL,
    note       smallint NOT NULL CHECK (note BETWEEN 0 AND 127),
    velocity   smallint NOT NULL CHECK (velocity BETWEEN 0 AND 127),
    channel    smallint NOT NULL DEFAULT 0 CHECK (channel BETWEEN 0 AND 15),
    source     text NOT NULL
);
SELECT create_hypertable('note_events', 'at');
CREATE INDEX note_events_session ON note_events (session_id, at);

-- a recorded performance kept as a MIDI file in object storage
CREATE TABLE recordings (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL REFERENCES practice_sessions (id) ON DELETE CASCADE,
    object_key text NOT NULL,
    public     boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- tokens for optional integrations such as Spotify, one row per user and provider
CREATE TABLE integration_accounts (
    user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    provider      text NOT NULL,
    access_token  text NOT NULL,
    refresh_token text,
    expires_at    timestamptz,
    PRIMARY KEY (user_id, provider)
);
