# Song import

A song in MELOPHOS is a list of timed notes, optionally split by hand. Songs come from three kinds of source.

| Source | How it is read | Status |
| --- | --- | --- |
| MIDI file | Parsed by the server, which keeps the notes in its song library | Built on the server. The Studio cannot import a file yet |
| Audio (WAV, MP3, FLAC) | Polyphonic transcription with a machine-learning model, optionally after separating the instruments | Planned. Not built. Accuracy will be measured on a test set and published with the importer |
| Tutorial video with falling notes | Computer vision reads which keys light up in each frame | Planned. Not built. Accuracy will be measured on a test set and published with the importer |

The server reads a MIDI file within limits on its size and its number of notes and rejects a malformed file with a reason.

> [!WARNING]
> Only import material you have the right to use. MELOPHOS does not download from streaming or video sites. Transcriptions of copyrighted music are for personal practice only.

## Splitting hands

MIDI files from notation software often carry each hand on its own track or channel, which maps straight to left and right. The server's reader looks for track names that say which hand a track is. It falls back to the pitch of each track or channel and then to a moving boundary in pitch. Hands that overlap are the weak case and the Studio has no way yet to correct a split.

## Built-in pieces

The Studio carries a few public-domain melodies so that a new install has something to practise on. A starter library on the server is planned.
