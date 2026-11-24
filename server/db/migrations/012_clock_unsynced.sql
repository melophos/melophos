-- a session received while the server's clock was not synchronised (a power cut on a machine with no clock battery) is
-- marked, so a date that may be wrong by the length of the cut can be found and corrected later
ALTER TABLE practice_sessions ADD COLUMN clock_unsynced boolean NOT NULL DEFAULT false;
