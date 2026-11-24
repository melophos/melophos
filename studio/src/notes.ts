const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
const BLACK = new Set([1, 3, 6, 8, 10]);

export function isBlackKey(note: number): boolean {
  return BLACK.has(note % 12);
}

// scientific pitch notation, where MIDI 60 is C4.
export function noteName(note: number): string {
  return `${NAMES[note % 12]}${Math.floor(note / 12) - 1}`;
}

export function keyRange(lowest: number, highest: number): number[] {
  return Array.from({ length: highest - lowest + 1 }, (_, i) => lowest + i);
}

// naming, for display and for speech. the pure functions above stay as they were: the new ones take the player's settings.

export type Naming = "english" | "german" | "solfege";
// where middle C sits: most programs call it C4 (scientific) and many keyboards call it C3
export type OctaveConvention = "c4" | "c3";
export type Accidental = "sharp" | "flat";

export interface NameOptions {
  naming: Naming;
  octave: OctaveConvention;
  // how a black key is spelled when the piece does not say
  accidental: Accidental;
  // the tonic of the piece's major key as a pitch class (0 is C), which decides the spelling of its black keys
  key?: number | undefined;
}

export const DEFAULT_NAME_OPTIONS: NameOptions = { naming: "english", octave: "c4", accidental: "sharp" };

const SHARP_LETTERS: Record<Naming, readonly string[]> = {
  english: ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"],
  german: ["C", "Cis", "D", "Dis", "E", "F", "Fis", "G", "Gis", "A", "Ais", "H"],
  solfege: ["Do", "Do♯", "Re", "Re♯", "Mi", "Fa", "Fa♯", "Sol", "Sol♯", "La", "La♯", "Si"],
};
const FLAT_LETTERS: Record<Naming, readonly string[]> = {
  english: ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"],
  german: ["C", "Des", "D", "Es", "E", "F", "Ges", "G", "As", "A", "B", "H"],
  solfege: ["Do", "Re♭", "Re", "Mi♭", "Mi", "Fa", "Sol♭", "Sol", "La♭", "La", "Si♭", "Si"],
};
// the spoken forms say the word, never the symbol, because speech engines read ♯ and # differently
const SPOKEN_SHARP: Record<Naming, readonly string[]> = {
  english: ["C", "C sharp", "D", "D sharp", "E", "F", "F sharp", "G", "G sharp", "A", "A sharp", "B"],
  german: SHARP_LETTERS.german,
  solfege: ["Do", "Do sharp", "Re", "Re sharp", "Mi", "Fa", "Fa sharp", "Sol", "Sol sharp", "La", "La sharp", "Si"],
};
const SPOKEN_FLAT: Record<Naming, readonly string[]> = {
  english: ["C", "D flat", "D", "E flat", "E", "F", "G flat", "G", "A flat", "A", "B flat", "B"],
  german: FLAT_LETTERS.german,
  solfege: ["Do", "Re flat", "Re", "Mi flat", "Mi", "Fa", "Sol flat", "Sol", "La flat", "La", "Si flat", "Si"],
};

// the major keys whose signature has flats: F, B flat, E flat, A flat and D flat
const FLAT_KEYS = new Set([5, 10, 3, 8, 1]);
// the major keys whose signature has sharps: G, D, A, E, B and F sharp
const SHARP_KEYS = new Set([7, 2, 9, 4, 11, 6]);

export function accidentalFor(options: NameOptions): Accidental {
  if (options.key !== undefined) {
    const tonic = ((options.key % 12) + 12) % 12;
    if (FLAT_KEYS.has(tonic)) return "flat";
    if (SHARP_KEYS.has(tonic)) return "sharp";
  }
  return options.accidental;
}

export function octaveNumber(note: number, convention: OctaveConvention): number {
  return Math.floor(note / 12) - (convention === "c4" ? 1 : 2);
}

// the letter or syllable with its sign, without the octave: "C♯", "Fis", "Re♭"
export function pitchClassLabel(note: number, options: NameOptions): string {
  const table = accidentalFor(options) === "sharp" ? SHARP_LETTERS : FLAT_LETTERS;
  return table[options.naming][note % 12] ?? "";
}

// what is printed on a key or a card: "C♯4"
export function noteLabel(note: number, options: NameOptions = DEFAULT_NAME_OPTIONS): string {
  return `${pitchClassLabel(note, options)}${octaveNumber(note, options.octave)}`;
}

// what a screen reader or the speech voice says: "C sharp 4"
export function spokenName(note: number, options: NameOptions = DEFAULT_NAME_OPTIONS): string {
  const table = accidentalFor(options) === "sharp" ? SPOKEN_SHARP : SPOKEN_FLAT;
  return `${table[options.naming][note % 12] ?? ""} ${octaveNumber(note, options.octave)}`;
}

export const isMiddleC = (note: number): boolean => note === 60;
