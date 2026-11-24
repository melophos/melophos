import { describe, expect, it } from "vitest";

import { cleanTitle, readImportFile, songFromStored, storedFromImport, titleFromFileName } from "./imports";
import { withChange } from "./hands";
import { barCount, layout } from "./piece";
import { name, noteOff, noteOn, smf, track } from "../tests/lib/smf";

const bytes = smf([track([name("Right hand"), noteOn(0, 0, 72), noteOff(480, 0, 72), noteOn(0, 0, 74), noteOff(480, 0, 74)]), track([name("Left hand"), noteOn(0, 1, 48), noteOff(960, 1, 48)])]);
const file = (data: Uint8Array, nameText = "tune.mid"): File => new File([data as BlobPart], nameText);

describe("importing a file", () => {
  it("turns a file into a piece with a guessed split", async () => {
    const read = await readImportFile(file(bytes));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const stored = storedFromImport("import-1", "Tune", "tune.mid", read.bytes, read.result);
    const song = songFromStored(stored);
    expect(song.imported).toMatchObject({ method: "track_name", corrected: 0 });
    expect(song.tempo).toBe(120);
    expect(layout(song).map((n) => [n.hand, n.note, n.startBeat])).toEqual([["left", 48, 0], ["right", 72, 0], ["right", 74, 1]]);
    expect(barCount(song)).toBe(1);
  });

  it("applies the player's corrections on top of the guess and counts them", async () => {
    const read = await readImportFile(file(bytes));
    if (!read.ok) throw new Error("read failed");
    const stored = storedFromImport("import-1", "Tune", "tune.mid", read.bytes, read.result);
    const corrected = { ...stored, corrections: withChange(read.result.guess, {}, [{ idx: 2, hand: "left" }]) };
    const song = songFromStored(corrected);
    expect(song.imported?.corrected).toBe(1);
    expect(layout(song).filter((n) => n.hand === "left")).toHaveLength(2);
  });

  it("joins notes that start almost together into a chord", () => {
    const s = smf([track([noteOn(0, 0, 60), noteOn(5, 0, 64), noteOff(480, 0, 60), noteOff(0, 0, 64)])], 0);
    return readImportFile(file(s)).then((r) => {
      if (!r.ok) throw new Error("read failed");
      const song = songFromStored(storedFromImport("a", "A", "a.mid", r.bytes, r.result));
      expect(new Set(layout(song).map((n) => n.startBeat)).size).toBe(1);
    });
  });

  it("says why a file cannot be read and never reads a file that is too big", async () => {
    expect(await readImportFile(file(new Uint8Array([1, 2, 3])))).toMatchObject({ ok: false, reason: expect.stringMatching(/not a MIDI file/) });
    const big = file(new Uint8Array(1024 * 1024 + 1));
    expect(await readImportFile(big)).toMatchObject({ ok: false, reason: expect.stringMatching(/larger than the 1024 KiB/) });
  });

  it("cleans a title the way the server does", () => {
    expect(cleanTitle("  Nice tune ")).toBe("Nice tune");
    expect(cleanTitle("")).toBeNull();
    expect(cleanTitle("x".repeat(121))).toBeNull();
    expect(titleFromFileName("my_great-song.MID")).toBe("my great song");
  });
});
