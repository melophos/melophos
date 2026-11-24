// from a MIDI file to a piece the Studio can practise and back to what is stored.
import { EXPLANATIONS, correctedCount, effectiveHands, splitHands } from "./hands";
import { MAX_BYTES, MidiError, parseMidi, type MidiSong } from "./midi-file";
import type { StoredPiece } from "./app/store";
import type { Hand, Song, SongNote } from "./songs";

// notes that start within this many milliseconds of each other are one chord, as the scoring engine reads them
const CHORD_MS = 25;

export function cleanTitle(raw: string): string | null {
  const t = [...raw].filter((c) => c >= " " && c !== "\u007f").join("").trim();
  return t.length >= 1 && t.length <= 120 ? t : null;
}

export function titleFromFileName(name: string): string {
  const base = name.replace(/\.(mid|midi|kar)$/i, "").replace(/[_-]+/g, " ").trim();
  return cleanTitle(base.slice(0, 120)) ?? "Imported piece";
}

export interface ImportResult {
  song: MidiSong;
  guess: Hand[];
  method: StoredPiece["method"];
}

export async function readImportFile(file: File): Promise<{ ok: true; bytes: Uint8Array; result: ImportResult } | { ok: false; reason: string }> {
  // the size is checked before the file is read at all
  if (file.size > MAX_BYTES) return { ok: false, reason: `That file is larger than the ${MAX_BYTES / 1024} KiB limit, so it is not a piece the Studio can read.` };
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return { ok: false, reason: "The browser could not read that file." };
  }
  try {
    const song = parseMidi(bytes);
    const split = splitHands(song);
    return { ok: true, bytes, result: { song, guess: split.hands, method: split.method } };
  } catch (error) {
    if (error instanceof MidiError) return { ok: false, reason: `That file could not be read: ${error.message}.` };
    return { ok: false, reason: "That file could not be read." };
  }
}

export function storedFromImport(id: string, title: string, fileName: string, bytes: Uint8Array, r: ImportResult, now: Date = new Date()): StoredPiece {
  return {
    id,
    title,
    fileName: fileName.slice(0, 200),
    importedAt: now.toISOString(),
    tempo: r.song.startTempo,
    beatsPerBar: r.song.beatsPerBar,
    lengthMs: r.song.lengthMs,
    method: r.method,
    notes: r.song.notes.map((n) => [n.tMs, n.durMs, n.note, n.track, n.channel]),
    guess: r.guess.map((h) => (h === "left" ? "l" : "r")),
    corrections: {},
    serverId: null,
    file: bytes,
  };
}

export const guessOf = (p: StoredPiece): Hand[] => p.guess.map((g) => (g === "l" ? "left" : "right"));

// the piece as the practice view reads it. the hands are the guess with the player's corrections on top
export function songFromStored(p: StoredPiece): Song {
  const hands = effectiveHands(guessOf(p), p.corrections);
  const perMs = p.tempo / 60_000;
  const notes: SongNote[] = [];
  let lastStartMs = -Infinity;
  let lastStartBeat = 0;
  p.notes.forEach(([t, d, note], i) => {
    // the notes are in time order, so a note close to the one before joins its chord
    const snapped = t - lastStartMs <= CHORD_MS;
    const at = snapped ? lastStartBeat : t * perMs;
    if (!snapped) {
      lastStartMs = t;
      lastStartBeat = at;
    }
    notes.push({ note, beats: Math.max(0.05, d * perMs), hand: hands[i] ?? "right", at });
  });
  return {
    id: p.id,
    title: p.title,
    composer: "Imported from a MIDI file",
    tempo: p.tempo,
    beatsPerBar: p.beatsPerBar,
    notes,
    imported: { fileName: p.fileName, method: p.method, corrected: correctedCount(guessOf(p), p.corrections), serverId: p.serverId },
  };
}

export const explanationFor = (method: StoredPiece["method"]): string => EXPLANATIONS[method];
