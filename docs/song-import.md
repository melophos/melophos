# Song import

A song in MELOPHOS is a list of timed notes, optionally split by hand. Songs come from three kinds of source.

| Source | How it is read | Quality |
| --- | --- | --- |
| MIDI file | Parsed directly | Exact |
| Audio (WAV, MP3, FLAC) | Polyphonic transcription with a machine-learning model such as Basic Pitch or Transkun, optionally after separating the instruments | Good for piano and clean recordings, rougher for dense mixes |
| Tutorial video with falling notes | Computer vision reads which keys light up in each frame | Very good when the video shows a clean keyboard |

Imports run in the worker, away from the request path. The Studio shows their progress.

> [!WARNING]
> Only import material you have the right to use. MELOPHOS does not download from streaming or video sites and never shares imported songs publicly unless the owner marks them public. Transcriptions of copyrighted music are for personal practice only.

## Splitting hands

MIDI files from notation software often carry each hand on its own track or channel, which maps straight to left and right. Transcribed audio and video have no hands, so the importer splits by pitch around a moving boundary and the Studio lets the player correct it.

## Public domain library

A small starter library of public domain pieces (Bach, Satie, Chopin, Joplin) ships with the server so a new install has something to practise on day one.
