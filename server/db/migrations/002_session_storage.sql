-- Issue 22: sessions and note events persist behind the session API.
-- Everything here is additive on top of 001 so a database that already ran 001 upgrades in place.

-- a device exists before an account owns it (pairing arrives in 003), so ownership becomes optional
ALTER TABLE devices ALTER COLUMN owner_id DROP NOT NULL;
CREATE INDEX devices_owner ON devices (owner_id);

-- the summary is stored with the session so list routes never read note_events
ALTER TABLE practice_sessions ADD COLUMN profile_id text NOT NULL DEFAULT 'unknown';
ALTER TABLE practice_sessions ALTER COLUMN profile_id DROP DEFAULT;
ALTER TABLE practice_sessions ADD COLUMN duration_ms integer NOT NULL DEFAULT 0;
ALTER TABLE practice_sessions ADD COLUMN unique_notes integer NOT NULL DEFAULT 0;
ALTER TABLE practice_sessions ADD COLUMN most_played_note smallint;
ALTER TABLE practice_sessions ADD COLUMN mean_velocity real;
ALTER TABLE practice_sessions ADD COLUMN notes_per_minute real NOT NULL DEFAULT 0;
ALTER TABLE practice_sessions ADD COLUMN event_count integer NOT NULL DEFAULT 0;

-- newest first with the id as the tie-break, which is the order every list route promises
DROP INDEX practice_sessions_device_started;
CREATE INDEX practice_sessions_device_started ON practice_sessions (device_id, started_at DESC, id DESC);

-- idx is the position of the event inside its session, so pages have a stable order even when two events
-- share a timestamp. (session_id, at, idx) serves both the time-bounded read and the keyset cursor
ALTER TABLE note_events ADD COLUMN idx integer NOT NULL DEFAULT 0;
DROP INDEX note_events_session;
CREATE INDEX note_events_session_at ON note_events (session_id, at, idx);
