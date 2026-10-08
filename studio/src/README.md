# Studio source

| File | Purpose |
| --- | --- |
| `main.ts` | Entry point: builds the keyboard, runs practice and connects MIDI on request |
| `midi.ts` | WebMIDI access and note message parsing |
| `keyboard.ts` | On-screen keyboard with the guide-light strip above it, sized to fit any screen |
| `practice.ts` | One practice run: the next notes to light, right and wrong notes, timing and the summary |
| `songs.ts` | Built-in public-domain melodies |
| `demo.ts` | A simulated player that drives the same note handler as a MIDI keyboard |
| `notes.ts` | Note names, black-key detection and key ranges |
| `profile.ts` | The default instrument profile |
| `style.css` | Brand styles, with a high-contrast amber guide colour and reduced-motion support |
| `notes.test.ts` | Unit tests for note handling and MIDI parsing |
| `practice.test.ts` | Unit tests for practice scoring |
