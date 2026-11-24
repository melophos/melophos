-- Issue 23: hub traffic arrives over MQTT.

-- a hub names its session so notes batches and the final session message land in one row
ALTER TABLE practice_sessions ADD COLUMN session_ref text;
CREATE UNIQUE INDEX practice_sessions_ref ON practice_sessions (device_id, session_ref) WHERE session_ref IS NOT NULL;

-- the latest status report from the hub
ALTER TABLE devices ADD COLUMN profile_id text;
ALTER TABLE devices ADD COLUMN active_inputs text[];
ALTER TABLE devices ADD COLUMN dropped_events bigint NOT NULL DEFAULT 0;
ALTER TABLE devices ADD COLUMN status_at timestamptz;

-- the newest (boot, seq) accepted per device and kind. A message that is not newer is a replay or a duplicate
CREATE TABLE ingest_state (
    device_id  text NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
    kind       text NOT NULL CHECK (kind IN ('notes', 'session', 'status')),
    boot       bigint NOT NULL,
    seq        bigint NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (device_id, kind)
);
