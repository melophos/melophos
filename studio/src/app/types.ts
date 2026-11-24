export type Mode = "melody" | "rhythm" | "listen";

export const MODES: { value: Mode; label: string; summary: string }[] = [
  { value: "melody", label: "Melody", summary: "Waits for you. Nothing moves until you play the right note." },
  { value: "rhythm", label: "Rhythm", summary: "Holds the tempo and scores your timing." },
  { value: "listen", label: "Listen", summary: "Plays the piece with the lights so you can follow along." },
];
