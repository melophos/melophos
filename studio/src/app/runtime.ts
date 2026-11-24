// the things the whole app shares: the MIDI connection, the latency probe and the stored sessions
import { useEffect, useState, useSyncExternalStore } from "react";
import { LatencyProbe } from "../latency";
import { MidiConnection, type MidiState } from "../midi-connection";
import type { Best } from "../game";
import { setStoredPieces } from "../pieces";
import { openStore, resetStore, type SessionRecord, type SessionStore, type StoredPiece } from "./store";

export const midi = new MidiConnection();
export const probe = new LatencyProbe();

export function useMidiState(): MidiState {
  return useSyncExternalStore(
    (l) => midi.subscribe(l),
    () => midi.state,
    () => midi.state,
  );
}

export interface SessionsState {
  records: SessionRecord[];
  loading: boolean;
  durable: boolean;
  store: SessionStore | null;
  reload: () => void;
}

export function useSessions(): SessionsState {
  const [records, setRecords] = useState<SessionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [store, setStore] = useState<SessionStore | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    void openStore().then(async (s) => {
      // a read that fails shows an empty record, never a broken page and Delete everything still works
      const list = await s.list().catch(() => []);
      if (live) {
        setStore(s);
        setRecords(list);
        setLoading(false);
      }
    });
    return () => {
      live = false;
    };
  }, [tick]);
  return { records, loading, durable: store?.durable ?? true, store, reload: () => setTick((t) => t + 1) };
}

// the last setup the player used, so Start can offer to carry on
const LAST = "melophos.last";
export interface LastSetup {
  pieceId: string;
  query: Record<string, string>;
}

export function rememberSetup(setup: LastSetup): void {
  try {
    localStorage.setItem(LAST, JSON.stringify(setup));
  } catch {
    // storage is blocked: nothing to resume next time
  }
}

export function lastSetup(): LastSetup | null {
  try {
    const raw = localStorage.getItem(LAST);
    if (!raw) return null;
    const v = JSON.parse(raw) as LastSetup;
    return typeof v.pieceId === "string" && typeof v.query === "object" ? v : null;
  } catch {
    return null;
  }
}

// imported pieces are read from storage once at start and kept in the library registry
let loading: Promise<void> | null = null;
export function forgetLibrary(): void {
  loading = null;
  setStoredPieces([]);
}

export function loadLibrary(): Promise<void> {
  loading ??= openStore().then(async (s) => {
    setStoredPieces(await s.listPieces());
  });
  return loading;
}

async function refresh(): Promise<void> {
  const s = await openStore();
  setStoredPieces(await s.listPieces());
}

export async function savePiece(piece: StoredPiece): Promise<void> {
  await (await openStore()).putPiece(piece);
  await refresh();
}

export async function removePiece(id: string): Promise<void> {
  await (await openStore()).deletePiece(id);
  await refresh();
}

// saves a finished run. if the connection was closed under it, for example because another tab deleted everything, it opens
// a new one and tries again. when it truly cannot be saved the caller is told, so the page can say so
export async function saveSession(record: SessionRecord): Promise<{ ok: true } | { ok: false; reason: string }> {
  const attempt = async (): Promise<void> => {
    await (await openStore()).add(record);
  };
  try {
    await attempt();
    return { ok: true };
  } catch {
    resetStore();
    try {
      await attempt();
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: error instanceof Error && error.message ? error.message : "The browser would not store it." };
    }
  }
}

// the personal bests of the rhythm game, read from the browser's own record
export function useBests(): { bests: Best[]; loading: boolean; reload: () => void } {
  const [bests, setBests] = useState<Best[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    void openStore().then(async (s) => {
      const list = await s.listBests().catch(() => []);
      if (live) {
        setBests(list);
        setLoading(false);
      }
    });
    return () => {
      live = false;
    };
  }, [tick]);
  return { bests, loading, reload: () => setTick((t) => t + 1) };
}

export async function saveBest(best: Best): Promise<boolean> {
  try {
    await (await openStore()).putBest(best);
    return true;
  } catch {
    resetStore();
    try {
      await (await openStore()).putBest(best);
      return true;
    } catch {
      return false;
    }
  }
}

export async function readBests(): Promise<Best[]> {
  try {
    return await (await openStore()).listBests();
  } catch {
    return [];
  }
}
