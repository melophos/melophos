// reads a standard MIDI file in the browser. nothing in the file is trusted. the limits are the server's own
// (server/app/midi.py) so a file that the Studio takes is a file the server takes and the other way round:
//   - the size is capped before anything is read, every length is checked against the bytes that are left
//   - every loop step eats at least one byte, so a track of n bytes costs at most n steps
//   - the counts of tracks, chunks, events, notes and tempo changes have hard caps and the read stops with a reason
//   - text in the file (track names) is read for hints only, cut short and never used as anything else
// every failure is a MidiError whose message is safe and plain enough to show to the person who chose the file.
export const MAX_BYTES = 1024 * 1024;
export const MAX_TRACKS = 32;
export const MAX_CHUNKS = 64;
export const MAX_EVENTS = 300_000;
export const MAX_NOTES = 50_000;
export const MAX_TEMPO_CHANGES = 2_000;
export const MAX_DURATION_MS = 2 * 60 * 60 * 1000;
const MAX_TICK = 2 ** 32;
const MAX_VLQ_BYTES = 4;
const PERCUSSION_CHANNEL = 9;
const DEFAULT_TEMPO_US = 500_000;

export class MidiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MidiError";
  }
}

export interface MidiNote {
  tMs: number;
  durMs: number;
  note: number;
  velocity: number;
  channel: number;
  track: number;
}

export interface TrackInfo {
  index: number;
  name: string;
  notes: number;
}

export interface MidiSong {
  format: 0 | 1;
  ticksPerQuarter: number;
  tracks: TrackInfo[];
  // sorted by start, then pitch, then track and channel. a note's position in this list is its idx on the server too
  notes: MidiNote[];
  lengthMs: number;
  skippedPercussion: number;
  tempoChanges: number;
  // beats a minute at the start of the file
  startTempo: number;
  // quarter notes in a bar from the first time signature, 4 when the file gives none
  beatsPerBar: number;
}

interface RawNote {
  start: number;
  end: number;
  note: number;
  velocity: number;
  channel: number;
  track: number;
}

class Reader {
  constructor(
    private readonly data: Uint8Array,
    public pos: number,
    private readonly end: number,
  ) {}

  left(): number {
    return this.end - this.pos;
  }

  byte(): number {
    if (this.pos >= this.end) throw new MidiError("the file ends in the middle of an event");
    return this.data[this.pos++] ?? 0;
  }

  take(count: number): Uint8Array {
    if (count < 0 || count > this.left()) throw new MidiError("an event is longer than the data that is left in its track");
    const chunk = this.data.subarray(this.pos, this.pos + count);
    this.pos += count;
    return chunk;
  }

  vlq(): number {
    let value = 0;
    for (let i = 0; i < MAX_VLQ_BYTES; i++) {
      const b = this.byte();
      value = value * 128 + (b & 0x7f);
      if (!(b & 0x80)) return value;
    }
    throw new MidiError("a variable-length number is longer than the standard allows");
  }
}

const be = (d: Uint8Array, at: number, n: number): number => {
  let v = 0;
  for (let i = 0; i < n; i++) v = v * 256 + (d[at + i] ?? 0);
  return v;
};

function cleanName(raw: Uint8Array): string {
  let out = "";
  for (const b of raw.subarray(0, 64)) if (b >= 0x20 && b < 0x7f) out += String.fromCharCode(b);
  return out;
}

export function parseMidi(data: Uint8Array): MidiSong {
  if (data.length > MAX_BYTES) throw new MidiError(`the file is larger than the ${MAX_BYTES / 1024} KiB limit`);
  if (data.length < 14 || be(data, 0, 4) !== 0x4d546864) throw new MidiError("this is not a MIDI file (it does not start with MThd)");
  const headerLen = be(data, 4, 4);
  if (headerLen < 6 || headerLen > 64 || 8 + headerLen > data.length) throw new MidiError("the MIDI header is the wrong size");
  const format = be(data, 8, 2);
  const declared = be(data, 10, 2);
  const division = be(data, 12, 2);
  if (format !== 0 && format !== 1) throw new MidiError("only MIDI format 0 and 1 files are supported (format 2 holds unrelated songs)");
  if (declared < 1 || declared > MAX_TRACKS) throw new MidiError(`the file declares ${declared} tracks, the limit is ${MAX_TRACKS}`);
  if (format === 0 && declared !== 1) throw new MidiError("a format 0 file must have exactly one track");
  if (division & 0x8000) throw new MidiError("SMPTE time division is not supported, save the file with beats and ticks");
  if (division === 0) throw new MidiError("the file has no time division");

  let pos = 8 + headerLen;
  const raw: RawNote[] = [];
  const tempos: [number, number][] = [];
  const tracks: TrackInfo[] = [];
  const meter = { beatsPerBar: 0 };
  let events = 0;
  let chunks = 0;
  let skipped = 0;
  while (pos + 8 <= data.length && tracks.length < declared) {
    chunks += 1;
    if (chunks > MAX_CHUNKS) throw new MidiError("the file has too many chunks");
    const kind = be(data, pos, 4);
    const length = be(data, pos + 4, 4);
    const body = pos + 8;
    if (length > data.length - body) throw new MidiError("a track claims to be longer than the file");
    if (kind === 0x4d54726b) {
      const info: TrackInfo = { index: tracks.length, name: "", notes: 0 };
      tracks.push(info);
      const result = readTrack(new Reader(data, body, body + length), info, raw, tempos, events, meter);
      events = result.events;
      skipped += result.skipped;
    }
    pos = body + length;
  }
  if (tracks.length === 0) throw new MidiError("the file has no tracks");
  if (raw.length === 0) throw new MidiError("the file has no notes");

  const map = tempoMap(tempos);
  const notes: MidiNote[] = raw.map((n) => {
    const start = toMs(n.start, map, division);
    return { tMs: start, durMs: Math.max(1, toMs(n.end, map, division) - start), note: n.note, velocity: n.velocity, channel: n.channel, track: n.track };
  });
  const lengthMs = notes.reduce((m, n) => Math.max(m, n.tMs + n.durMs), 0);
  if (lengthMs > MAX_DURATION_MS) throw new MidiError(`the song is longer than ${MAX_DURATION_MS / 60000} minutes`);
  notes.sort((a, b) => a.tMs - b.tMs || a.note - b.note || a.track - b.track || a.channel - b.channel);
  for (const n of notes) {
    const t = tracks[n.track];
    if (t) t.notes += 1;
  }
  const firstTempo = map.micros[0] ?? DEFAULT_TEMPO_US;
  return {
    format,
    ticksPerQuarter: division,
    tracks,
    notes,
    lengthMs,
    skippedPercussion: skipped,
    tempoChanges: tempos.length,
    startTempo: Math.min(240, Math.max(30, Math.round(60_000_000 / firstTempo))),
    beatsPerBar: meter.beatsPerBar || 4,
  };
}

function readTrack(r: Reader, info: TrackInfo, out: RawNote[], tempos: [number, number][], eventsIn: number, meter: { beatsPerBar: number }): { events: number; skipped: number } {
  let tick = 0;
  let status = 0;
  let events = eventsIn;
  let skipped = 0;
  let held = 0;
  const open = new Map<number, { tick: number; velocity: number }[]>();
  while (r.left() > 0) {
    events += 1;
    if (events > MAX_EVENTS) throw new MidiError(`the file has more than ${MAX_EVENTS} events`);
    tick += r.vlq();
    if (tick > MAX_TICK) throw new MidiError("the file runs for an impossible number of ticks");
    const first = r.byte();
    if (first === 0xff) {
      const meta = r.byte();
      const payload = r.take(r.vlq());
      if (meta === 0x2f) break;
      if (meta === 0x03 && !info.name) info.name = cleanName(payload);
      else if (meta === 0x58 && meter.beatsPerBar === 0 && payload.length >= 2) {
        // numerator over a power of two, counted in quarter notes
        const quarters = ((payload[0] ?? 4) * 4) / 2 ** Math.min(6, payload[1] ?? 2);
        meter.beatsPerBar = Math.min(16, Math.max(1, Math.round(quarters)));
      } else if (meta === 0x51) {
        if (payload.length !== 3) throw new MidiError("a tempo event has the wrong length");
        const micros = be(payload, 0, 3);
        if (micros === 0) throw new MidiError("a tempo of zero is not possible");
        if (tempos.length >= MAX_TEMPO_CHANGES) throw new MidiError(`the file has more than ${MAX_TEMPO_CHANGES} tempo changes`);
        tempos.push([tick, micros]);
      }
      continue;
    }
    if (first === 0xf0 || first === 0xf7) {
      r.take(r.vlq());
      continue;
    }
    let data1: number;
    if (first >= 0x80) {
      status = first;
      data1 = r.byte();
    } else {
      if (status === 0) throw new MidiError("an event has no status byte");
      data1 = first;
    }
    if (status >= 0xf0) throw new MidiError("an unsupported system message is in a track");
    const kind = status & 0xf0;
    const channel = status & 0x0f;
    if (data1 > 0x7f) throw new MidiError("an event has a data byte that is out of range");
    const two = kind === 0x80 || kind === 0x90 || kind === 0xa0 || kind === 0xb0 || kind === 0xe0;
    const data2 = two ? r.byte() : 0;
    if (two && data2 > 0x7f) throw new MidiError("an event has a data byte that is out of range");
    if (kind !== 0x80 && kind !== 0x90) continue;
    if (channel === PERCUSSION_CHANNEL) {
      if (kind === 0x90 && data2 > 0) skipped += 1;
      continue;
    }
    const key = channel * 128 + data1;
    if (kind === 0x90 && data2 > 0) {
      if (out.length + held >= MAX_NOTES) throw new MidiError(`the file has more than ${MAX_NOTES} notes`);
      const stack = open.get(key) ?? [];
      stack.push({ tick, velocity: data2 });
      open.set(key, stack);
      held += 1;
    } else {
      const stack = open.get(key);
      const on = stack?.shift();
      if (on) {
        held -= 1;
        out.push({ start: on.tick, end: Math.max(tick, on.tick), note: data1, velocity: on.velocity, channel, track: info.index });
      }
    }
  }
  for (const [key, stack] of open) {
    for (const on of stack) out.push({ start: on.tick, end: Math.max(tick, on.tick), note: key % 128, velocity: on.velocity, channel: Math.floor(key / 128), track: info.index });
  }
  return { events, skipped };
}

interface TempoMap {
  ticks: number[];
  micros: number[];
  atUs: bigint[];
}

function tempoMap(tempos: [number, number][]): TempoMap {
  const ticks = [0];
  const micros = [DEFAULT_TEMPO_US];
  for (const [tick, tempo] of [...tempos].sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    if (tick === ticks[ticks.length - 1]) micros[micros.length - 1] = tempo;
    else {
      ticks.push(tick);
      micros.push(tempo);
    }
  }
  return { ticks, micros, atUs: [] };
}

function toMs(tick: number, m: TempoMap, division: number): number {
  const div = BigInt(division);
  if (m.atUs.length === 0) {
    let total = 0n;
    m.ticks.forEach((t, i) => {
      m.atUs.push(total);
      const next = m.ticks[i + 1];
      if (next !== undefined) total += (BigInt(next - t) * BigInt(m.micros[i] ?? DEFAULT_TEMPO_US)) / div;
    });
  }
  let lo = 0;
  let hi = m.ticks.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((m.ticks[mid] ?? 0) <= tick) lo = mid;
    else hi = mid - 1;
  }
  const us = (m.atUs[lo] ?? 0n) + (BigInt(tick - (m.ticks[lo] ?? 0)) * BigInt(m.micros[lo] ?? DEFAULT_TEMPO_US)) / div;
  return Number(us / 1000n);
}
