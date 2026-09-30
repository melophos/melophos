# Overview

## What MELOPHOS is

MELOPHOS is an open platform for learning and practising an instrument with lights. It has three parts that work together or on their own:

1. **The hub**, a small board that sits behind the instrument. It receives notes from the instrument or from a song and lights the matching keys or frets on snap-together LED bars.
2. **The server**, self-hosted with Docker. It stores every practice session note by note and turns that into progress anyone can see.
3. **The Studio**, a browser app for choosing songs, practising with guidance, setting up the hub and reviewing progress.

## What it does

| Area | Capability |
| --- | --- |
| Guidance | Lights the next notes to play. Melody mode waits for the right note, Rhythm mode holds a tempo, Listen mode plays the piece through |
| Feedback | Wrong notes flash red, upcoming notes glow dimly, a finished passage shows accuracy and timing |
| Instruments | Keyboards of any size, guitars in any tuning and any instrument that speaks MIDI, all described by profiles |
| Inputs | USB-MIDI, Bluetooth MIDI, 3.5 mm MIDI jacks and an audio input for instruments with no MIDI at all |
| Practice data | Sessions, streaks, per-key heatmaps, accuracy and tempo progress per piece, recordings as MIDI |
| Songs | MIDI files, audio transcribed by machine learning and falling-note tutorial videos read by computer vision |
| Integrations | Spotify learn lists, room lights through WLED and Home Assistant, webhooks for any dashboard |

## Why it exists

Light-guided learning works. Commercial light-up keyboards and LED fretboards prove it, but each one ties the player to a single instrument, a single app and usually a subscription. When the instrument is replaced, the lights go with it.

MELOPHOS separates the pieces instead:

- **The lights belong to the player, not the instrument.** The same hub moves from a first keyboard to a better piano to a guitar.
- **The data belongs to the player.** Practice history lives on a self-hosted server with an open API, not in someone else's cloud.
- **The design is open.** Hardware under CERN-OHL-S and software under AGPL means anyone can build, improve and share it. Improvements stay open too.
- **Accessibility comes first.** Guidance on a single flat plane, high-contrast colour choices and non-visual cues serve players with low vision, monocular vision, colour blindness or hearing loss. See [accessibility.md](accessibility.md).

## Who it is for

- Beginners who want to learn songs by following lights
- Returning players who want to track practice honestly
- Teachers who want to guide a student's hands remotely (planned for v2)
- Makers who want a well-documented open hardware project to build and extend
