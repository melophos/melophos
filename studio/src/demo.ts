// plays a song as a person might: close to the beat but never exactly on it, with one slip that is
// then corrected. It drives the same note handler a MIDI keyboard does, so the demo shows the real
// scoring rather than a recording.
import type { Song } from "./songs";

export interface DemoHandle {
  stop(): void;
}

function seeded(seed: number): () => number {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

export function playDemo(song: Song, onNote: (note: number, on: boolean) => void, onDone: () => void): DemoHandle {
  const random = seeded(7);
  const beatMs = 60_000 / song.tempo;
  const timers: number[] = [];
  let t = 400;
  song.notes.forEach(({ note, beats }, i) => {
    // one wrong neighbouring note a third of the way in, quickly corrected
    // placed just before the note, inside the gap, so the timing of the rest of the song is untouched
    if (i === Math.floor(song.notes.length / 3)) {
      const slip = note + 1;
      timers.push(window.setTimeout(() => onNote(slip, true), t - 260));
      timers.push(window.setTimeout(() => onNote(slip, false), t - 120));
    }
    const jitter = (random() - 0.5) * 120;
    const at = t + jitter;
    timers.push(window.setTimeout(() => onNote(note, true), at));
    timers.push(window.setTimeout(() => onNote(note, false), at + beats * beatMs * 0.7));
    t += beats * beatMs;
  });
  // after the last key is released
  timers.push(window.setTimeout(onDone, t + 200));
  return { stop: () => timers.forEach((id) => window.clearTimeout(id)) };
}
