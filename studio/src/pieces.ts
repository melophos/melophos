// the pieces the Studio carries. built-in pieces are public domain melodies written for this project
import { useSyncExternalStore } from "react";
import { songFromStored } from "./imports";
import { barCount, layout, rangeOf } from "./piece";
import { SONGS, type Song } from "./songs";
import type { StoredPiece } from "./app/store";

// the library is the built-in pieces and the pieces the player imported. imported pieces load from the browser's own
// storage once at start, so a view asks for ready before it says a piece is missing
interface Library {
  songs: Song[];
  stored: Map<string, StoredPiece>;
  ready: boolean;
}

let library: Library = { songs: SONGS, stored: new Map(), ready: false };
const listeners = new Set<() => void>();

export function setStoredPieces(list: StoredPiece[]): void {
  library = { songs: [...SONGS, ...list.map(songFromStored)], stored: new Map(list.map((p) => [p.id, p] as const)), ready: true };
  for (const l of listeners) l();
}

export function useLibrary(): Library {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => library,
    () => library,
  );
}

export const allSongs = (): Song[] => library.songs;
export const findSong = (id: string): Song | undefined => library.songs.find((s) => s.id === id);
export const storedPiece = (id: string): StoredPiece | undefined => library.stored.get(id);

export interface PieceInfo {
  song: Song;
  bars: number;
  notes: number;
  hands: "right" | "left" | "both";
  lowest: number;
  highest: number;
  source: string;
}

export function describePiece(song: Song): PieceInfo {
  const notes = layout(song);
  const hands = new Set(notes.map((n) => n.hand));
  const range = rangeOf(notes) ?? { lowest: 60, highest: 60 };
  return {
    song,
    bars: barCount(song),
    notes: notes.length,
    hands: hands.size > 1 ? "both" : hands.has("left") ? "left" : "right",
    lowest: range.lowest,
    highest: range.highest,
    source: song.imported ? `Imported from ${song.imported.fileName}` : song.composer === "Exercise" ? "Built in, written for the Studio" : "Built in, public domain",
  };
}

export const handsLabel = (h: PieceInfo["hands"]): string => (h === "both" ? "Both hands" : h === "left" ? "Left hand" : "Right hand");
