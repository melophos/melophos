-- Issue 25: the song library. A MIDI file is stored once, parsed by the worker and kept as rows of notes.

ALTER TABLE songs ADD COLUMN length_ms integer;
ALTER TABLE songs ADD COLUMN note_count integer;
ALTER TABLE songs ADD COLUMN difficulty real CHECK (difficulty BETWEEN 1 AND 10);
ALTER TABLE songs ADD COLUMN hands_method text;
ALTER TABLE songs ADD COLUMN import_error text;
ALTER TABLE songs ADD COLUMN import_started_at timestamptz;
CREATE INDEX songs_owner_created ON songs (owner_id, created_at DESC, id DESC);
CREATE INDEX songs_queue ON songs (created_at) WHERE import_state IN ('queued', 'running');

-- the upload itself, capped at 1 MiB by the API. It lives in the database so a worker on another machine can read
-- it without a shared disk and it is only ever read back by its owner
CREATE TABLE song_files (
    song_id uuid PRIMARY KEY REFERENCES songs (id) ON DELETE CASCADE,
    data    bytea NOT NULL CHECK (octet_length(data) <= 1048576)
);

CREATE TABLE song_notes (
    song_id  uuid NOT NULL REFERENCES songs (id) ON DELETE CASCADE,
    idx      integer NOT NULL,
    t_ms     integer NOT NULL,
    dur_ms   integer NOT NULL,
    note     smallint NOT NULL CHECK (note BETWEEN 0 AND 127),
    velocity smallint NOT NULL CHECK (velocity BETWEEN 1 AND 127),
    hand     text NOT NULL CHECK (hand IN ('left', 'right')),
    track    smallint NOT NULL,
    channel  smallint NOT NULL,
    PRIMARY KEY (song_id, idx)
);
