import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { MAX_BYTES, MAX_NOTES, MAX_TRACKS, MidiError, parseMidi } from "./midi-file";
import { meter, name, noteOff, noteOn, randomSong, seeded, smf, tempo, track } from "../tests/lib/smf";

const simple = smf([track([meter(3, 2), tempo(0, 600_000), name("Piano"), noteOn(0, 0, 60), noteOff(480, 0, 60), noteOn(0, 0, 64), noteOff(480, 0, 64)])], 0);

describe("reading a MIDI file", () => {
  it("reads notes, tempo and the time signature", () => {
    const song = parseMidi(simple);
    // 600 000 microseconds a quarter note is 100 beats a minute, so 480 ticks at 480 a quarter is 600 ms
    expect(song.notes.map((n) => [n.tMs, n.durMs, n.note])).toEqual([[0, 600, 60], [600, 600, 64]]);
    expect(song.startTempo).toBe(100);
    expect(song.beatsPerBar).toBe(3);
    expect(song.tracks[0]).toMatchObject({ name: "Piano", notes: 2 });
  });

  it("follows a change of tempo", () => {
    const s = smf([track([noteOn(0, 0, 60), noteOff(480, 0, 60), tempo(0, 1_000_000), noteOn(0, 0, 62), noteOff(480, 0, 62)])], 0);
    expect(parseMidi(s).notes.map((n) => n.tMs)).toEqual([0, 500]);
  });

  it("skips percussion and counts it", () => {
    const s = smf([track([noteOn(0, 9, 36), noteOff(10, 9, 36), noteOn(0, 0, 60), noteOff(10, 0, 60)])], 0);
    const song = parseMidi(s);
    expect(song.notes).toHaveLength(1);
    expect(song.skippedPercussion).toBe(1);
  });

  it("ends a note still held at the end of the track", () => {
    const s = smf([track([noteOn(0, 0, 60), noteOn(100, 0, 62)], true)], 0);
    expect(parseMidi(s).notes).toHaveLength(2);
  });
});

describe("a file it cannot read gives a plain reason", () => {
  const reason = (bytes: Uint8Array): string => {
    try {
      parseMidi(bytes);
    } catch (e) {
      expect(e).toBeInstanceOf(MidiError);
      return (e as Error).message;
    }
    return "";
  };

  it("is not a MIDI file", () => {
    expect(reason(new Uint8Array([1, 2, 3]))).toMatch(/not a MIDI file/);
    expect(reason(new TextEncoder().encode("MThx" + "0".repeat(20)))).toMatch(/not a MIDI file/);
  });

  it("is too big, has too many tracks or no notes", () => {
    expect(reason(new Uint8Array(MAX_BYTES + 1))).toMatch(/larger than the 1024 KiB/);
    expect(reason(smf(Array.from({ length: MAX_TRACKS + 1 }, () => track([])), 1))).toMatch(/declares 33 tracks/);
    expect(reason(smf([track([])], 0))).toMatch(/no notes/);
  });

  it("has a header or a track that lies about its length", () => {
    const lie = Uint8Array.from(simple);
    lie[18] = 0x7f;
    expect(reason(lie)).toMatch(/longer than the file/);
    expect(reason(simple.subarray(0, 20))).toMatch(/no tracks|ends/);
  });

  it("uses SMPTE timing, format 2 or a zero tempo", () => {
    expect(reason(smf([track([noteOn(0, 0, 60)])], 0, 0x8000 | 25))).toMatch(/SMPTE/);
    expect(reason(smf([track([noteOn(0, 0, 60)])], 2))).toMatch(/format 0 and 1/);
    expect(reason(smf([track([tempo(0, 0), noteOn(0, 0, 60)])], 0))).toMatch(/tempo of zero/);
  });

  it("has more notes than the limit", () => {
    const evs = [];
    for (let i = 0; i < MAX_NOTES + 1; i++) evs.push(noteOn(0, 0, 60));
    expect(reason(smf([track(evs)], 0))).toMatch(/more than 50000 notes/);
  });

  it("is longer than two hours", () => {
    const s = smf([track([tempo(0, 16_000_000), noteOn(0, 0, 60), noteOff(2_000_000, 0, 60)])], 0, 1);
    expect(reason(s)).toMatch(/longer than 120 minutes/);
  });
});

// the Studio and the server read the same files in the same way: the same notes in the same order
describe("agreement with the server's reader", () => {
  const dir = new URL("../../server/", import.meta.url).pathname;
  const python = existsSync(join(dir, "app", "midi.py"));
  it.skipIf(!python)("gives the same notes for 40 seeded random files", () => {
    const random = seeded(2026);
    const files = Array.from({ length: 40 }, () => randomSong(random));
    const work = mkdtempSync(join(tmpdir(), "melophos-smf-"));
    files.forEach((f, i) => writeFileSync(join(work, `${i}.mid`), f));
    const script = `import sys, json\nsys.path.insert(0, ${JSON.stringify(dir)})\nfrom app.midi import parse\nout=[]\nfor i in range(${files.length}):\n    s=parse(open(sys.argv[1]+'/'+str(i)+'.mid','rb').read())\n    out.append({'n':[[n.t_ms,n.dur_ms,n.note,n.velocity,n.channel,n.track] for n in s.notes],'len':s.length_ms})\nprint(json.dumps(out))`;
    const server = JSON.parse(execFileSync("python3", ["-I", "-c", script, work], { encoding: "utf8" })) as { n: number[][]; len: number }[];
    files.forEach((f, i) => {
      const mine = parseMidi(f);
      expect(mine.notes.map((n) => [n.tMs, n.durMs, n.note, n.velocity, n.channel, n.track]), `file ${i}`).toEqual(server[i]?.n);
      expect(mine.lengthMs).toBe(server[i]?.len);
    });
  });
});
