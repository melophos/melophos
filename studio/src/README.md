# Studio source

| Path | Purpose |
| --- | --- |
| `app/` | The React interface: `App.tsx`, the hash router, settings, the session store, the charts and one file per view in `views/` |
| `instrument/` | Outside React: the SVG keyboard and rail, the canvas lane and `session.ts`, which owns one run |
| `clock.ts` | The master clock: position as a pure function of time, speed, loop and what is due to sound |
| `scoring.ts` | Loads the WebAssembly scoring engine and wraps it for live use |
| `piece.ts` | A song laid out in time with hands, chords, bars and excerpts |
| `practice.ts` | Which note is next, for one or two hands and chords |
| `geometry.ts` | Key positions, shared by the keyboard, the lane and the firmware parity test |
| `midi.ts`, `midi-connection.ts` | Message parsing, then the connection as a state machine with every state and its words |
| `input.ts` | The computer keyboard as a piano |
| `audio.ts` | Synthesised tones and the metronome on the Web Audio clock |
| `demo.ts` | A simulated player as a script polled from the frame loop |
| `calibration.ts`, `latency.ts` | Input calibration and the press to frame probe |
| `midi-file.ts`, `hands.ts`, `imports.ts` | Reading a MIDI file with the server's limits, the first guess at the hands with corrections and undo and the stored piece |
| `game.ts`, `engine.ts` | The rhythm game's result from the engine's figures, personal bests per song and setting and the engine build they were set with |
| `hub.ts` | What a hub can report, as words, for when one does |
| `app/server.ts`, `app/serverLink.ts`, `app/update.ts` | The optional own-server calls, the link and token and the service worker registration with the update offer |
| `notes.ts`, `songs.ts`, `pieces.ts`, `profile.ts` | Note names in three namings, the built-in pieces and the default profile |
| `styles/`, `icons/`, `specimen/` | The design foundations from stage 1 |
