// practice records, kept on this device. IndexedDB holds them, with a plain in-memory list as the fallback where
// IndexedDB is blocked, so the app still works and the record lasts for the visit. nothing is sent anywhere.
import type { Best } from "../game";
import type { Corrections, Method } from "../hands";
import type { Mode } from "./types";

export interface MissedKey {
  note: number;
  count: number;
}

export interface LapScore {
  expected: number;
  hits: number;
  // notes matched outside the timing window. absent in records made before the engine reported them
  late?: number;
  // presses the engine was not sure about. they count neither for nor against. absent in older records
  notJudged?: number;
  misses: number;
  wrong: number;
  repeats: number;
  accuracy: number;
  // set in Rhythm mode only, after calibration, rounded to 10 ms
  timingMs: number | null;
}

// a finished run. a simulated run is never stored
export interface SessionRecord {
  id: string;
  pieceId: string;
  pieceTitle: string;
  // an ISO 8601 date and time with a zone
  startedAt: string;
  durationMs: number;
  mode: Mode;
  hand: "both" | "left" | "right";
  fromBar: number | null;
  toBar: number | null;
  // the speed as a percentage of the written tempo
  speedPct: number;
  // counts of steps, kept by the stepper: notes in the run and notes right first time
  total: number;
  firstTime: number;
  wrongPresses: number;
  longestRun: number;
  // the figures from the scoring engine. null when the engine could not load
  score: LapScore | null;
  laps: number;
  // set when the engine refused the run, in its own words
  scoreProblem?: string;
  missed: MissedKey[];
}

// a piece the player imported from a MIDI file. the notes are kept as the file gave them and the split into hands is kept
// as the first guess plus the player's corrections, so a correction can always be taken back
export interface StoredPiece {
  id: string;
  title: string;
  fileName: string;
  importedAt: string;
  tempo: number;
  beatsPerBar: number;
  lengthMs: number;
  method: Method;
  // each note as [start ms, length ms, key, track, channel], in the file's sorted order. a note's place here is its idx
  notes: [number, number, number, number, number][];
  // the first guess, one entry per note: "l" or "r"
  guess: ("l" | "r")[];
  corrections: Corrections;
  // the id the piece has on the player's own server once it has been sent there
  serverId: string | null;
  // the original file, kept so it can be sent to the player's own server. never exported
  file: Uint8Array | null;
}

export interface SessionStore {
  // personal bests of the rhythm game, one for each song, difficulty and version of the scoring engine
  listBests(): Promise<Best[]>;
  putBest(best: Best): Promise<void>;
  // adds or replaces records and bests all together or not at all, so a full disk part way through leaves the record as it was
  addMany(records: SessionRecord[], bests?: Best[]): Promise<void>;
  // lets go of the database so it can be deleted
  close(): void;
  listPieces(): Promise<StoredPiece[]>;
  putPiece(piece: StoredPiece): Promise<void>;
  deletePiece(id: string): Promise<void>;
  list(): Promise<SessionRecord[]>;
  add(record: SessionRecord): Promise<void>;
  clear(): Promise<void>;
  readonly durable: boolean;
}

const DB = "melophos";
const STORE = "sessions";
const PIECES = "pieces";
const BESTS = "bests";

function wrap<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB failed"));
  });
}

class IdbStore implements SessionStore {
  readonly durable = true;
  private db: Promise<IDBDatabase> | null = null;

  // the connection is made when it is needed and made again when another tab has made this one let go. a tab left open
  // while another deletes everything therefore still saves its next run
  private connect(): Promise<IDBDatabase> {
    if (!this.db) {
      this.db = new Promise((resolve, reject) => {
        const open = indexedDB.open(DB, 3);
        open.onupgradeneeded = () => {
          const names = open.result.objectStoreNames;
          if (!names.contains(STORE)) open.result.createObjectStore(STORE, { keyPath: "id" });
          if (!names.contains(PIECES)) open.result.createObjectStore(PIECES, { keyPath: "id" });
          if (!names.contains(BESTS)) open.result.createObjectStore(BESTS, { keyPath: "id" });
        };
        open.onsuccess = () => {
          // when something asks to delete or upgrade the database this connection lets go, so it is never in the way
          open.result.onversionchange = () => {
            open.result.close();
            this.db = null;
          };
          resolve(open.result);
        };
        open.onerror = () => {
          this.db = null;
          reject(open.error ?? new Error("IndexedDB could not open"));
        };
        open.onblocked = () => {
          this.db = null;
          reject(new Error("IndexedDB is blocked"));
        };
      });
    }
    return this.db;
  }

  constructor() {
    void this.connect().catch(() => undefined);
  }

  private async store(mode: IDBTransactionMode, name = STORE): Promise<IDBObjectStore> {
    return (await this.connect()).transaction(name, mode).objectStore(name);
  }

  async listPieces(): Promise<StoredPiece[]> {
    const all = (await wrap((await this.store("readonly", PIECES)).getAll())) as unknown[];
    // one piece of an old shape never hides the rest
    return all.filter(validPiece) as StoredPiece[];
  }

  close(): void {
    const open = this.db;
    this.db = null;
    void open?.then((d) => d.close()).catch(() => undefined);
  }

  async listBests(): Promise<Best[]> {
    const all = (await wrap((await this.store("readonly", BESTS)).getAll())) as unknown[];
    return all.filter(validBest);
  }

  async putBest(best: Best): Promise<void> {
    await wrap((await this.store("readwrite", BESTS)).put(best));
  }

  async addMany(records: SessionRecord[], bests: Best[] = []): Promise<void> {
    const db = await this.connect();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE, BESTS], "readwrite");
      const os = tx.objectStore(STORE);
      const bs = tx.objectStore(BESTS);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("The records could not be saved."));
      tx.onabort = () => reject(tx.error ?? new Error("The records could not be saved."));
      try {
        for (const r of records) os.put(r);
        for (const b of bests) bs.put(b);
      } catch (error) {
        tx.abort();
        reject(error instanceof Error ? error : new Error("The records could not be saved."));
      }
    });
  }

  async putPiece(piece: StoredPiece): Promise<void> {
    await wrap((await this.store("readwrite", PIECES)).put(piece));
  }

  async deletePiece(id: string): Promise<void> {
    await wrap((await this.store("readwrite", PIECES)).delete(id));
  }

  async list(): Promise<SessionRecord[]> {
    const all = (await wrap((await this.store("readonly")).getAll())) as unknown[];
    // every record is checked as it is read. one of an old shape is left out and the rest still show
    return all.map(validRecord).filter((r): r is SessionRecord => r !== null).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }

  async add(record: SessionRecord): Promise<void> {
    await wrap((await this.store("readwrite")).put(record));
  }

  async clear(): Promise<void> {
    await wrap((await this.store("readwrite")).clear());
    await wrap((await this.store("readwrite", PIECES)).clear());
  }

}

class MemoryStore implements SessionStore {
  readonly durable = false;
  private records: SessionRecord[] = [];
  private pieces: StoredPiece[] = [];
  private bests: Best[] = [];

  listBests(): Promise<Best[]> {
    return Promise.resolve([...this.bests]);
  }

  putBest(best: Best): Promise<void> {
    this.bests = [...this.bests.filter((b) => b.id !== best.id), best];
    return Promise.resolve();
  }

  listPieces(): Promise<StoredPiece[]> {
    return Promise.resolve([...this.pieces]);
  }

  putPiece(piece: StoredPiece): Promise<void> {
    this.pieces = [...this.pieces.filter((p) => p.id !== piece.id), piece];
    return Promise.resolve();
  }

  deletePiece(id: string): Promise<void> {
    this.pieces = this.pieces.filter((p) => p.id !== id);
    return Promise.resolve();
  }

  list(): Promise<SessionRecord[]> {
    return Promise.resolve([...this.records].sort((a, b) => a.startedAt.localeCompare(b.startedAt)));
  }

  add(record: SessionRecord): Promise<void> {
    this.records = [...this.records.filter((r) => r.id !== record.id), record];
    return Promise.resolve();
  }

  clear(): Promise<void> {
    this.records = [];
    this.pieces = [];
    this.bests = [];
    return Promise.resolve();
  }

  addMany(records: SessionRecord[], bests: Best[] = []): Promise<void> {
    const next = new Map(this.records.map((r) => [r.id, r] as const));
    for (const r of records) next.set(r.id, r);
    this.records = [...next.values()];
    const nb = new Map(this.bests.map((b) => [b.id, b] as const));
    for (const b of bests) nb.set(b.id, b);
    this.bests = [...nb.values()];
    return Promise.resolve();
  }

  close(): void {}
}

// IndexedDB is tried once. if it fails for any reason the memory store takes over and the interface says so
let chosen: SessionStore | null = null;

let opening: Promise<SessionStore> | null = null;

export function openStore(): Promise<SessionStore> {
  // one opening at a time: two calls at once share it, so there is only ever one connection to close
  opening ??= open_().finally(() => {
    opening = null;
  });
  return opening;
}

async function open_(): Promise<SessionStore> {
  if (chosen) return chosen;
  if (typeof indexedDB === "undefined") return (chosen = new MemoryStore());
  try {
    const store = new IdbStore();
    // opening is the test. reading is not: a record of an old shape is skipped and a read that fails is shown by the caller
    await store.list().catch(() => []);
    chosen = store;
  } catch {
    chosen = new MemoryStore();
  }
  return chosen;
}

export interface WipeReport {
  ok: boolean;
  // what is still there, in words, when it is not ok
  remaining: string[];
}

// the steps of a wipe and the look afterwards, as one object so a test can give each a failure
export interface WipeEnv {
  deleteDatabase(): Promise<void>;
  clearLocal(): void;
  clearCaches(): Promise<void>;
  unregisterWorkers(): Promise<void>;
  // what is still there, in words. an empty list means nothing is
  look(): Promise<string[]>;
}

export function browserWipeEnv(): WipeEnv {
  return {
    deleteDatabase: () =>
      typeof indexedDB === "undefined"
        ? Promise.resolve()
        : new Promise<void>((resolve, reject) => {
            const request = indexedDB.deleteDatabase(DB);
            request.onerror = () => reject(request.error ?? new Error("The database could not be deleted."));
            // a connection in another tab closes itself when asked, so a block is only waited out, with a limit
            request.onblocked = () => {
              AbortSignal.timeout(4000).addEventListener("abort", () => reject(new Error("Another tab of the Studio is holding the record. Close it and try again.")));
            };
            request.onsuccess = () => resolve();
          }),
    clearLocal: () => {
      localStorage.clear();
      sessionStorage.clear();
    },
    clearCaches: async () => {
      if (typeof caches !== "undefined") for (const key of await caches.keys()) await caches.delete(key);
    },
    unregisterWorkers: async () => {
      for (const r of (await navigator.serviceWorker?.getRegistrations?.()) ?? []) await r.unregister();
    },
    look: async () => {
      const left: string[] = [];
      try {
        if (typeof indexedDB !== "undefined" && indexedDB.databases) {
          if ((await indexedDB.databases()).some((d) => d.name === DB)) left.push("The saved record is still there.");
        }
        if (localStorage.length > 0) left.push("Saved settings are still there.");
        if (typeof caches !== "undefined" && (await caches.keys()).length > 0) left.push("The saved copy of the app is still there.");
        if (((await navigator.serviceWorker?.getRegistrations?.()) ?? []).length > 0) left.push("The app's background worker is still registered.");
      } catch {
        // a browser that cannot be asked cannot be checked: what could be checked has been
      }
      return left;
    },
  };
}

// deletes everything this app keeps in the browser and then looks to see that it is gone: the database itself, the saved
// settings, the cached files and the service worker. it reports success only after that look
export async function wipeEverything(env: WipeEnv = browserWipeEnv()): Promise<WipeReport> {
  const remaining: string[] = [];
  const open = chosen;
  chosen = null;
  open?.close();
  const attempt = async (what: string, step: () => Promise<void> | void): Promise<void> => {
    try {
      await step();
    } catch (error) {
      remaining.push(error instanceof Error && what === "record" ? error.message : `The ${what} could not be removed.`);
    }
  };
  await attempt("record", () => env.deleteDatabase());
  await attempt("saved settings", () => env.clearLocal());
  await attempt("saved copy of the app", () => env.clearCaches());
  await attempt("background worker", () => env.unregisterWorkers());
  // the look: nothing may be left of any of it
  remaining.push(...(await env.look()));
  return { ok: remaining.length === 0, remaining };
}

// forgets the connection, so the next use opens a fresh one
export function resetStore(): void {
  chosen = null;
  opening = null;
}

export function memoryStore(): SessionStore {
  return new MemoryStore();
}

// asks the browser to keep the data when space is short. the answer is shown as it is, never assumed
export async function requestPersistence(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persist) return null;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

export async function persistenceStatus(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persisted) return null;
    return await navigator.storage.persisted();
  } catch {
    return null;
  }
}

// the export file: one JSON document the player owns
export interface ExportFile {
  format: "melophos-studio-export";
  version: 1;
  exportedAt: string;
  sessions: SessionRecord[];
  // personal bests. absent in files made before the game
  bests?: Best[];
}

export function exportJson(records: SessionRecord[], now: Date = new Date(), bests: Best[] = []): string {
  const file: ExportFile = { format: "melophos-studio-export", version: 1, exportedAt: now.toISOString(), sessions: records, bests };
  return JSON.stringify(file, null, 2);
}

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function validRecord(raw: unknown): SessionRecord | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const modes = ["melody", "rhythm", "listen"];
  const hands = ["both", "left", "right"];
  if (typeof r["id"] !== "string" || r["id"].length === 0 || r["id"].length > 80) return null;
  if (typeof r["pieceId"] !== "string" || typeof r["pieceTitle"] !== "string" || r["pieceTitle"].length > 200) return null;
  if (typeof r["startedAt"] !== "string" || Number.isNaN(Date.parse(r["startedAt"]))) return null;
  if (!modes.includes(r["mode"] as string) || !hands.includes(r["hand"] as string)) return null;
  for (const k of ["durationMs", "speedPct", "total", "firstTime", "wrongPresses", "longestRun", "laps"]) if (!isNumber(r[k])) return null;
  if (!Array.isArray(r["missed"]) || r["missed"].length > 128) return null;
  const missed = r["missed"].filter((m): m is MissedKey => typeof m === "object" && m !== null && isNumber((m as MissedKey).note) && isNumber((m as MissedKey).count));
  return { ...(r as unknown as SessionRecord), missed };
}

export function validBest(raw: unknown): raw is Best {
  if (typeof raw !== "object" || raw === null) return false;
  const b = raw as Record<string, unknown>;
  const d = b["difficulty"] as Record<string, unknown> | undefined;
  return (
    typeof b["id"] === "string" && b["id"].length > 0 && b["id"].length < 200 &&
    typeof b["songId"] === "string" && typeof b["songTitle"] === "string" && typeof b["engine"] === "string" &&
    typeof b["achievedAt"] === "string" && !Number.isNaN(Date.parse(b["achievedAt"])) &&
    ["accuracy", "hits", "late", "misses", "wrong", "expected"].every((k) => isNumber(b[k])) &&
    (b["notJudged"] === undefined || isNumber(b["notJudged"])) &&
    (b["accuracy"] as number) >= 0 && (b["accuracy"] as number) <= 1 &&
    typeof d === "object" && d !== null && ["both", "left", "right"].includes(d["hand"] as string) && isNumber(d["speedPct"]) && (d["fromBar"] === null || isNumber(d["fromBar"])) && (d["toBar"] === null || isNumber(d["toBar"]))
  );
}

export function validPiece(raw: unknown): raw is StoredPiece {
  if (typeof raw !== "object" || raw === null) return false;
  const p = raw as Record<string, unknown>;
  return typeof p["id"] === "string" && typeof p["title"] === "string" && Array.isArray(p["notes"]) && Array.isArray(p["guess"]) && p["guess"].length === p["notes"].length && isNumber(p["tempo"]) && isNumber(p["beatsPerBar"]) && typeof p["corrections"] === "object" && p["corrections"] !== null;
}

export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
export const MAX_IMPORT_SESSIONS = 20000;

// reads an export file and says what is wrong when it cannot. nothing is trusted: size, count and every field is checked
export function parseExport(text: string): { ok: true; sessions: SessionRecord[]; bests: Best[]; skipped: number } | { ok: false; reason: string } {
  if (text.length > MAX_IMPORT_BYTES) return { ok: false, reason: "That file is larger than 20 MB, which is more than a Studio export holds." };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, reason: "That file is not a Studio export. It is not valid JSON." };
  }
  const file = data as Partial<ExportFile> | null;
  if (!file || file.format !== "melophos-studio-export") return { ok: false, reason: "That file is not a Studio export. It does not carry the Studio's format name." };
  if (file.version !== 1) return { ok: false, reason: "That export is from a newer Studio. Update this app and try again." };
  if (!Array.isArray(file.sessions)) return { ok: false, reason: "That export has no list of sessions." };
  if (file.sessions.length > MAX_IMPORT_SESSIONS) return { ok: false, reason: `That export holds more than ${MAX_IMPORT_SESSIONS} sessions.` };
  const sessions: SessionRecord[] = [];
  let skipped = 0;
  for (const raw of file.sessions) {
    const ok = validRecord(raw);
    if (ok) sessions.push(ok);
    else skipped += 1;
  }
  const bests = Array.isArray(file.bests) ? file.bests.slice(0, 5000).filter(validBest) : [];
  return { ok: true, sessions, bests, skipped };
}
