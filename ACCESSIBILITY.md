# Accessibility

MELOPHOS started from a practical problem: with monocular vision, depth cues are weak and a full 88-key keyboard is wide to scan. The same choices that solve that help many other players, so accessibility shapes the hardware, the firmware and the Studio from the first revision. The full statement, covering vision, hearing, motor and cognitive needs and the Studio, is [docs/accessibility.md](docs/accessibility.md).

## In short

- Guidance lights sit on one flat line just behind the keys, so finding a note never depends on judging depth.
- Colour is never the only signal: every state also differs in brightness, timing or position, with alternative palettes for colour blindness and a low-brightness mode for light sensitivity.
- A visual metronome and on-screen timing feedback mean nothing depends on hearing the instrument.
- Melody mode waits indefinitely and playback slows down without changing pitch, so there is no time pressure while learning.
- Every Studio control is reachable by keyboard and labelled for screen readers, live regions announce the connection and the last note and motion respects `prefers-reduced-motion`.

## Documentation

Documentation in this repository and the published component repositories aims to:

- Use a real heading outline, so screen readers and the page outline can jump between sections.
- Use link text that says where the link goes, never "click here".
- Give images, diagrams and badges alt text. Write diagrams as Mermaid where possible, so their content is text.
- Show code, commands and output as text, never as screenshots.
- Never rely on colour alone: callouts carry a label such as Note, Tip or Warning.
- Use plain language, explaining a term where it first appears.

## Reporting a barrier

Accessibility is only as good as the people it is tested with. If a design choice does not work for you, open a [discussion](https://github.com/melophos/melophos/discussions) describing what did not work and what would. Accessibility problems are treated as bugs.
