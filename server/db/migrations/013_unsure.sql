-- The engine has a third verdict, unsure: a press it cannot place with confidence. It counts neither for nor against
-- the player. Sessions scored before this have the column empty and the earlier engine also called some of these
-- presses wrong, so every session that was scored goes back in the queue and the worker scores it again with the
-- current engine
ALTER TABLE practice_sessions ADD COLUMN unsure integer CHECK (unsure >= 0);

UPDATE practice_sessions SET score_state = 'pending', score_after = now(), score_attempts = 0, score_error = NULL
    WHERE score_state = 'scored';
