// a small standard MIDI file writer for the tests, with a seeded generator so every file is repeatable
export type Ev = { delta: number; bytes: number[] };

const vlq = (n: number): number[] => {
  const out = [n & 0x7f];
  for (let v = n >> 7; v > 0; v >>= 7) out.unshift((v & 0x7f) | 0x80);
  return out;
};

export const noteOn = (delta: number, ch: number, note: number, vel = 90): Ev => ({ delta, bytes: [0x90 | ch, note, vel] });
export const noteOff = (delta: number, ch: number, note: number): Ev => ({ delta, bytes: [0x80 | ch, note, 0] });
export const tempo = (delta: number, us: number): Ev => ({ delta, bytes: [0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255] });
export const name = (text: string): Ev => ({ delta: 0, bytes: [0xff, 0x03, text.length, ...[...text].map((c) => c.charCodeAt(0))] });
export const meter = (n: number, dd: number): Ev => ({ delta: 0, bytes: [0xff, 0x58, 4, n, dd, 24, 8] });

export function track(events: Ev[], end = true): number[] {
  const body: number[] = [];
  for (const e of events) body.push(...vlq(e.delta), ...e.bytes);
  if (end) body.push(0, 0xff, 0x2f, 0);
  const len = body.length;
  return [0x4d, 0x54, 0x72, 0x6b, (len >> 24) & 255, (len >> 16) & 255, (len >> 8) & 255, len & 255, ...body];
}

export function smf(tracks: number[][], format = 1, division = 480): Uint8Array {
  const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, format, 0, tracks.length, (division >> 8) & 255, division & 255];
  return Uint8Array.from([...head, ...tracks.flat()]);
}

export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

// a plausible random song: one or two tracks, a few tempo changes, overlapping notes
export function randomSong(random: () => number): Uint8Array {
  const tracks: number[][] = [];
  const count = 1 + Math.floor(random() * 3);
  for (let t = 0; t < count; t++) {
    const evs: Ev[] = [];
    if (t === 0) {
      evs.push(meter(2 + Math.floor(random() * 4), 2));
      evs.push(tempo(0, 300_000 + Math.floor(random() * 500_000)));
    }
    evs.push(name(["Right hand", "Left hand", "Piano", ""][Math.floor(random() * 4)] ?? ""));
    const notes = 3 + Math.floor(random() * 40);
    for (let i = 0; i < notes; i++) {
      const ch = Math.floor(random() * 2);
      const n = 30 + Math.floor(random() * 70);
      evs.push(noteOn(Math.floor(random() * 240), ch, n, 1 + Math.floor(random() * 126)));
      evs.push(noteOff(Math.floor(random() * 480), ch, n));
      if (random() < 0.05) evs.push(tempo(Math.floor(random() * 100), 250_000 + Math.floor(random() * 600_000)));
    }
    tracks.push(track(evs));
  }
  return smf(tracks, count === 1 ? 0 : 1, 96 + Math.floor(random() * 900));
}
