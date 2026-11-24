// short public-domain melodies for practice and the demo, as MIDI notes with lengths in beats
export type Hand = "right" | "left";

export interface SongNote {
  note: number;
  beats: number;
  // right by default, because a single line of melody is nearly always the right hand
  hand?: Hand;
  // where the note starts, in beats from the start of the piece. left out, a note follows the one before it
  at?: number;
  // finger number from 1 (thumb) to 5 when the piece says it
  finger?: number;
}

export interface Song {
  id: string;
  title: string;
  composer: string;
  // beats a minute at the written speed
  tempo: number;
  notes: SongNote[];
  // beats in a bar, 4 when left out
  beatsPerBar?: number;
  // the tonic of the piece's major key as a pitch class, which decides how its black keys are spelled
  key?: number;
  // set on a piece the player imported. its hands are a guess that the player can correct
  imported?: ImportedInfo;
}

export interface ImportedInfo {
  fileName: string;
  method: "track_name" | "track_pitch" | "channel_pitch" | "pitch";
  // how many notes the player has moved to the other hand
  corrected: number;
  serverId: string | null;
}

const seq = (pairs: [number, number][]) => pairs.map(([note, beats]) => ({ note, beats }));
// the same with a finger number for each note
const fingered = (triples: [number, number, number][]) => triples.map(([note, beats, finger]) => ({ note, beats, finger }));
// a part for one hand, laid out from a start beat
function part(hand: Hand, start: number, pairs: [number, number][]): SongNote[] {
  let at = start;
  return pairs.map(([note, beats]) => {
    const placed = { note, beats, hand, at };
    at += beats;
    return placed;
  });
}

export const SONGS: Song[] = [
  {
    id: "ode-to-joy",
    title: "Ode to Joy",
    composer: "Ludwig van Beethoven",
    tempo: 100,
    key: 0,
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
    key: 0,
    notes: fingered([[60, 1, 1], [62, 1, 2], [64, 1, 3], [65, 1, 1], [67, 1, 2], [69, 1, 3], [71, 1, 4], [72, 2, 5], [71, 1, 4], [69, 1, 3], [67, 1, 2], [65, 1, 1], [64, 1, 3], [62, 1, 2], [60, 2, 1]]),
  },
  {
    id: "brother-john",
    title: "Brother John, hands together",
    composer: "Traditional",
    tempo: 84,
    key: 0,
    notes: [
      ...part("right", 0, [
        [60, 1], [62, 1], [64, 1], [60, 1], [60, 1], [62, 1], [64, 1], [60, 1],
        [64, 1], [65, 1], [67, 2], [64, 1], [65, 1], [67, 2],
        [67, 0.5], [69, 0.5], [67, 0.5], [65, 0.5], [64, 1], [60, 1], [67, 0.5], [69, 0.5], [67, 0.5], [65, 0.5], [64, 1], [60, 1],
        [60, 1], [55, 1], [60, 2], [60, 1], [55, 1], [60, 2],
      ]),
      ...part("left", 0, [[48, 4], [48, 4], [48, 4], [48, 4], [43, 4], [43, 4], [48, 4], [48, 4]]),
    ],
  },
];
