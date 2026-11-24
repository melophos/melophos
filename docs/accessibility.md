# Accessibility

MELOPHOS started from a practical problem: with monocular vision, depth cues are weak and a full 88-key keyboard is wide to scan. The same design choices that solve that help many other players, so accessibility shapes the hardware, the firmware and the Studio from the first revision.

Each row says what is built and what is planned. **Built** means the code exists and its tests pass. **Host-tested, awaits a board** means the same for the hub firmware, which has never run on a board. No board has been made, so no light has been seen on a real bar. Nobody who uses a screen reader has tested the Studio yet.

## Vision

| Need | Design choice | Status |
| --- | --- | --- |
| Monocular vision or weak depth perception | Guidance lights sit on one flat line just above the keys, so finding a note never depends on judging depth. The light is on the key itself, not on a screen the eyes have to move between. The Studio draws the same rail above its keyboard | Studio: built. Hub: in design, no board |
| Narrow field of view | Upcoming notes glow dimly before they are due, so the next position is visible before the hand moves | Studio: built. Hub: host-tested, awaits a board |
| Low vision | The Studio has a distance setting that makes type, lights and targets larger together for a tablet on a music stand or a screen across the room | Studio: built |
| Low vision, hub | Brightness set for each role (guide, played, upcoming, wrong). The firmware has one fixed brightness today | Planned |
| Colour blindness | Every light has a shape and a word as well as a colour in the Studio. The colours are tested under simulated protanopia, deuteranopia and tritanopia. The firmware gives every meaning a second signal in brightness or pattern and has a monochrome setting | Studio: built. Hub: host-tested, awaits a board |
| Colour blindness, palettes | Alternative palettes for protanopia, deuteranopia and tritanopia. The firmware has one fixed palette, the same table as the Studio's | Planned |
| Light sensitivity | A light sensitivity setting in the Studio keeps every light steady. The firmware has a calm setting with no blinking, pulsing or moving dot. Nothing flashes more than twice a second | Studio: built. Hub: host-tested, awaits a board |
| Light sensitivity, hub brightness | A low-brightness mode that caps every LED. The firmware caps the total current at 2700 mA as a safety limit, which is not a setting a player can choose | Planned |

> [!IMPORTANT]
> Colour is meant to be only one of the signals. Every state in the Studio has a shape or a word as well as a colour. The firmware's second signals are tested on a computer and have not been seen on real lights.

## Hearing

| Need | Design choice | Status |
| --- | --- | --- |
| Deaf or hard of hearing | The Studio shows timing feedback as text and has a beat indicator that can be switched off. The metronome click is a sound and the indicator is its visual twin | Studio: built |
| Deaf or hard of hearing, hub | A visual metronome on the LED bars, kept under three flashes a second | Planned |
| Noisy rooms | MIDI inputs do not depend on hearing the instrument. The audio input is optional | Audio input: planned |

## Motor and cognitive

| Need | Design choice | Status |
| --- | --- | --- |
| No time pressure | Melody mode waits for as long as the player needs, in the Studio and in the hub firmware | Studio: built. Hub: host-tested, awaits a board |
| Slower practice | The Studio plays a piece at 25 to 125 per cent of its written speed. Its sound is made by the app, so the pitch does not change | Built |
| Part by part | Passages can be looped and practised with one hand at a time in the Studio | Built |
| Hands busy | The Studio can be driven by Space, Page Up, Page Down, the arrow keys and the sustain pedal | Built |

## Studio

| Need | Design choice | Status |
| --- | --- | --- |
| Keyboard use | Every control works from the keyboard. Controls are native or from a tested accessible library | Built |
| Screen readers | One announcement at the start of each phrase, a "What is next" button and the result at the end. There is no live region for every note | Built. Not yet checked by a person who uses a screen reader |
| Spoken note names | The next note can be read aloud with its sharp or flat spoken in words | Built. Needs a check with a screen reader and a speech voice |
| Motion | Under the system reduced motion setting nothing animates and the falling notes become a still page for each phrase | Built |
| Contrast and size | Colours are measured and body text aims for 7 to 1. Text is 16 pixels or more and targets are 44 pixels or more, checked in a browser on every change | Built |

## Feedback wanted

Accessibility is only as good as the people it is tested with. If a design choice here does not work for you, open a discussion on [melophos/melophos](https://github.com/melophos/melophos/discussions) and describe what would.
