# Accessibility

MELOPHOS started from a practical problem: with monocular vision, depth cues are weak and a full 88-key keyboard is wide to scan. The same design choices that solve that help many other players, so accessibility shapes the hardware, the firmware and the Studio from the first revision.

## Vision

| Need | Design choice |
| --- | --- |
| Monocular vision or weak depth perception | Guidance lights sit on one flat line just behind the keys, so finding a note never depends on judging depth. The light is on the key itself, not on a screen the eyes have to move between |
| Narrow field of view | Upcoming notes glow dimly before they are due, so the next position is visible before the hand moves. A range marker can outline the part of the keyboard a passage uses |
| Low vision | Brightness is adjustable per role (guide, played, upcoming, wrong). The Studio keyboard zooms and follows the current passage |
| Colour blindness | The default palette separates roles by brightness and blinking, not by hue alone. Alternative palettes are chosen for protanopia, deuteranopia and tritanopia |
| Light sensitivity | A low-brightness mode caps every LED. Blinking can be replaced with steady light |

> [!IMPORTANT]
> Colour is never the only signal. Every state that uses colour also differs in brightness, timing or position, so the guidance still works for players who cannot tell the colours apart.

## Hearing

| Need | Design choice |
| --- | --- |
| Deaf or hard of hearing | A visual metronome pulses on the LED bars and in the Studio. Timing feedback is shown, never only played as a sound |
| Noisy rooms | The audio input is optional; MIDI inputs do not depend on hearing the instrument |

## Motor and cognitive

- Melody mode waits indefinitely, so there is no time pressure while learning.
- Tempo can be slowed down to any speed without changing pitch in the Studio's playback.
- Passages can be looped and practised one hand at a time.

## Studio

- Every control is reachable by keyboard and labelled for screen readers.
- Live regions announce the connection status and the last note played.
- Motion respects the `prefers-reduced-motion` setting.

## Feedback wanted

Accessibility is only as good as the people it is tested with. If a design choice here does not work for you, open a discussion on [melophos/melophos](https://github.com/melophos/melophos/discussions) and describe what would.
