// short public-domain melodies for practice and the demo, as MIDI notes with lengths in beats
export interface Song {
  id: string;
  title: string;
  composer: string;
  tempo: number;
  notes: { note: number; beats: number }[];
}

const seq = (pairs: [number, number][]) => pairs.map(([note, beats]) => ({ note, beats }));

export const SONGS: Song[] = [
  {
    id: "ode-to-joy",
    title: "Ode to Joy",
    composer: "Ludwig van Beethoven",
    tempo: 100,
    notes: seq([
      [64, 1], [64, 1], [65, 1], [67, 1], [67, 1], [65, 1], [64, 1], [62, 1],
      [60, 1], [60, 1], [62, 1], [64, 1], [64, 1.5], [62, 0.5], [62, 2],
      [64, 1], [64, 1], [65, 1], [67, 1], [67, 1], [65, 1], [64, 1], [62, 1],
      [60, 1], [60, 1], [62, 1], [64, 1], [62, 1.5], [60, 0.5], [60, 2],
    ]),
  },
  {
    id: "twinkle",
    title: "Twinkle, Twinkle, Little Star",
    composer: "Traditional",
    tempo: 96,
    notes: seq([
      [60, 1], [60, 1], [67, 1], [67, 1], [69, 1], [69, 1], [67, 2],
      [65, 1], [65, 1], [64, 1], [64, 1], [62, 1], [62, 1], [60, 2],
    ]),
  },
  {
    id: "c-major-scale",
    title: "C major scale",
    composer: "Exercise",
    tempo: 110,
    notes: seq([[60, 1], [62, 1], [64, 1], [65, 1], [67, 1], [69, 1], [71, 1], [72, 2], [71, 1], [69, 1], [67, 1], [65, 1], [64, 1], [62, 1], [60, 2]]),
  },
];
