-- The engine now reports notes matched outside the window (late) and which hand or hands a session played.
-- Sessions scored before this have these columns empty: see the README for re-scoring them.
ALTER TABLE practice_sessions ADD COLUMN late integer;
ALTER TABLE practice_sessions ADD COLUMN score_hands text
    CHECK (score_hands IN ('unknown', 'neither', 'left', 'right', 'both'));
ALTER TABLE practice_sessions ADD COLUMN played_expected integer;
ALTER TABLE practice_sessions ADD COLUMN played_accuracy real CHECK (played_accuracy BETWEEN 0 AND 1);

-- sessions scored by the earlier engine counted a late note as a wrong press too, so their accuracy means something
-- different. They go back in the queue and the worker scores them again with the current engine
UPDATE practice_sessions SET score_state = 'pending', score_after = now(), score_attempts = 0, score_error = NULL
    WHERE score_state = 'scored';
