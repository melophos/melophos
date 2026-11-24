# Overview

## What MELOPHOS is

MELOPHOS is an open platform for learning and practising an instrument with lights. It has three parts. Each is meant to work with the others or on its own:

1. **The hub**, a small board that sits behind the instrument. It is designed to receive notes from the instrument or from a song and to light the matching keys or frets on LED bars above the keys. The firmware is written and tested on a computer. The board is in design and no board has been made.
2. **The server**, self-hosted with Docker. It stores every practice session note by note and turns that into progress the player can review.
3. **The Studio**, a browser app for practising with guidance and reviewing progress. It works with no hub and no server. It imports a MIDI file, has a rhythm game with personal bests, works offline and can link to a server you run. The screens for setting up a hub are not built yet.

Nothing here has run on real hardware.

## What it does

Each row says how far it has got, in the words of the [roadmap](roadmap.md). **Built** means the code exists and its tests pass on a computer. **Host-tested, awaits a board** means the same for the hub firmware, which has never run on a board. **Partly built**, **In progress**, **In design**, **Planned** and **Not yet checked** are described on the roadmap.

| Area | Capability | Status |
| --- | --- | --- |
| Guidance | Lights the next notes to play. Melody mode waits for the right note, Rhythm mode holds a tempo and Listen mode plays the piece through | Studio: built, with a light strip on screen. Hub: host-tested, awaits a board |
| Feedback | A wrong key turns rose-magenta with a cross and the words "wrong note" in the Studio and rose-magenta in the hub firmware. The notes after the next glow dimly. The hub's lights have never been seen on a real bar | Studio: built. Hub: host-tested, awaits a board |
| Instruments | Keyboards of 61, 76 and 88 keys and a six-string guitar are described by profiles and each profile is checked against a schema. The format is designed so that a new instrument is a new file | Profiles: built. A real instrument: not yet checked |
| Inputs | The 3.5 mm MIDI jack, USB-MIDI and Bluetooth MIDI on the hub. A Web MIDI keyboard in the Studio. An audio input for instruments with no MIDI | Hub inputs: host-tested, awaits a board. Studio: built. Audio input: planned |
| Practice data | The server stores sessions and every note and gives each session a summary. The Studio shows days practised and charts for each piece, kept in the browser | Server and Studio: built |
| Scoring | One engine in Rust, shared by the browser and the server, follows each hand as its own line with one shared tempo and judges timing against the player's own tempo. A press it cannot place with confidence is not judged and counts neither for nor against the player. Every figure comes from synthetic performances and nobody has played into it | In progress. Real players: not yet checked |
| Songs | The server reads MIDI files into a library. The Studio imports a MIDI file in the browser and has built-in public-domain pieces | Server and Studio: built. Audio and video import: planned |
| Integrations | Signed webhooks for finished sessions | Built. Spotify, WLED and Home Assistant: planned |

## Why it exists

A player who cannot judge depth or scan a wide keyboard is helped by a light on the key itself. MELOPHOS separates the pieces so that the lights, the instrument and the practice record can each be replaced alone:

- **The lights belong to the player and not to the instrument.** The same hub is meant to move from a first keyboard to a better piano to a guitar.
- **The data belongs to the player.** Practice history lives in the browser or on a self-hosted server with an open API, not in someone else's cloud.
- **The design is open.** Hardware under CERN-OHL-S and software under AGPL means anyone can build, improve and share it. Improvements stay open too.
- **Accessibility is a design goal.** Guidance sits on a single flat line above the keys and every state is meant to carry a second cue besides colour. [accessibility.md](accessibility.md) lists what is built and what is planned.

## Who it is for

- Beginners who want to learn songs by following lights
- Returning players who want a note-by-note record of their practice
- Teachers who want to guide a student's hands remotely (planned for v2)
- Makers who want an open hardware project to build and extend
