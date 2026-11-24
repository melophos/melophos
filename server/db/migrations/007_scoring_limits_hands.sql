-- Scoring off the request path, sliding-window rate limits and correctable hand splits.

-- the engine's result and where the scoring job stands. Nothing is ever filled in by guesswork:
-- a session that could not be scored keeps empty figures and says why
ALTER TABLE practice_sessions ADD COLUMN score_state text NOT NULL DEFAULT 'none'
    CHECK (score_state IN ('none', 'pending', 'scored', 'failed'));
ALTER TABLE practice_sessions ADD COLUMN score_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE practice_sessions ADD COLUMN score_after timestamptz;
ALTER TABLE practice_sessions ADD COLUMN score_error text;
ALTER TABLE practice_sessions ADD COLUMN mean_timing_error_ms real;
ALTER TABLE practice_sessions ADD COLUMN final_speed_ppm integer;
CREATE INDEX practice_sessions_score_queue ON practice_sessions (score_after) WHERE score_state = 'pending';

-- one row per event that counts against a limit, so a window can be measured exactly at any moment
DROP TABLE rate_limits;
CREATE TABLE rate_events (
    bucket text NOT NULL,
    at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rate_events_bucket ON rate_events (bucket, at DESC);
CREATE INDEX rate_events_at ON rate_events (at);

-- the importer's own answer is kept so a corrected split can be undone
ALTER TABLE song_notes ADD COLUMN auto_hand text;
UPDATE song_notes SET auto_hand = hand;
ALTER TABLE song_notes ALTER COLUMN auto_hand SET NOT NULL;
ALTER TABLE song_notes ADD CONSTRAINT song_notes_auto_hand CHECK (auto_hand IN ('left', 'right'));
ALTER TABLE songs ADD COLUMN hands_edited boolean NOT NULL DEFAULT false;
