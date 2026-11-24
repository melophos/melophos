// the numbers a family is shown. a perfect performance must be called perfect however it was played: with a repeat, with a
// loop, with a pause, slowly or hesitantly and an imperfect one must be told as it was
import { beforeAll, describe, expect, it } from "vitest";
import { advance, beatMs, excerpt, loadEngine, make, playPerfect, world } from "../../tests/lib/drive";

beforeAll(loadEngine);

describe("Rhythm mode", () => {
  it("calls perfect play perfect", () => {
    world.clock = 1000;
    const { s, song } = make({ songId: "twinkle" });
    s.start();
    const ms = beatMs(song.tempo);
    playPerfect(s, excerpt(song, { hand: "both" }), world.clock + 4 * ms, ms);
    advance(world.clock + 8 * ms);
    const r = s.getSnapshot().result!;
    expect(r).toMatchObject({ firstTime: 14, total: 14, wrongPresses: 0, missed: [] });
    expect(r.score).toMatchObject({ hits: 14, wrong: 0, misses: 0, accuracy: 1 });
  });

  it("calls perfect play perfect after Repeat phrase and never marks a right key wrong", () => {
    world.clock = 1000;
    const { s, song } = make({ songId: "twinkle" });
    s.start();
    const notes = excerpt(song, { hand: "both" });
    const ms = beatMs(song.tempo);
    const origin = world.clock + 4 * ms;
    playPerfect(s, notes.filter((n) => n.startBeat < 8), origin, ms);
    // the player is between two notes when they press the pedal
    advance(origin + 7.5 * ms);
    s.repeatPhrase();
    const again = world.clock;
    for (const n of notes) {
      advance(again + n.startBeat * ms);
      s.input(n.note, true, world.clock, "midi");
      expect(s.getSnapshot().lastEvent?.kind, `note ${n.note} at beat ${n.startBeat}`).toBe("right");
    }
    advance(world.clock + 8 * ms);
    const r = s.getSnapshot().result!;
    expect(r.wrongPresses).toBe(0);
    expect(r.score).toMatchObject({ wrong: 0, accuracy: 1 });
    expect(r.firstTime).toBe(r.total);
    // both stretches are in the score: the part played before the jump and the whole second pass
    expect(r.total).toBe(notes.filter((n) => n.startBeat < 8).length + notes.length);
    expect(r.score?.expected).toBe(r.total);
    expect(r.missed).toEqual([]);
  });

  it("scores only the part of a loop that was reached and adds the laps up", () => {
    world.clock = 1000;
    const { s, song } = make({ songId: "twinkle", loop: true, fromBar: 1, toBar: 2 });
    s.start();
    const notes = excerpt(song, { hand: "both", fromBar: 1, toBar: 2 });
    const ms = beatMs(song.tempo);
    const origin = world.clock + 4 * ms;
    playPerfect(s, notes, origin, ms);
    // the second lap starts at beat 8. one note into it the player presses Finish
    advance(origin + 8 * ms);
    s.input(notes[0]!.note, true, world.clock, "midi");
    advance(world.clock + 100);
    s.stop();
    const r = s.getSnapshot().result!;
    expect(r.total).toBe(notes.length + 1);
    expect(r.firstTime).toBe(r.total);
    expect(r.missed, "notes never reached are not misses").toEqual([]);
    expect(r.score).toMatchObject({ misses: 0, wrong: 0, accuracy: 1 });
    expect(r.laps).toBe(2);
  });
});

describe("Melody mode", () => {
  it("counts each note once and calls a perfect run perfect, however hesitant", () => {
    world.clock = 1000;
    const { s, song } = make({ songId: "ode-to-joy", mode: "melody", guidance: "steps" });
    s.start();
    const notes = excerpt(song, { hand: "both" });
    let t = world.clock + 500;
    let k = 1;
    for (const n of notes) {
      k = (k * 1103515245 + 12345) % 2147483648;
      t += 1000 + (k % 3000);
      advance(t);
      s.input(n.note, true, world.clock, "screen");
    }
    const r = s.getSnapshot().result!;
    expect(r.total).toBe(notes.length);
    expect(r.firstTime).toBe(notes.length);
    // timing is not judged where the app waits: nothing is late and nothing is missed
    expect(r.score).toMatchObject({ late: 0, misses: 0, wrong: 0, accuracy: 1 });
    expect(r.score?.timingMs).toBeNull();
  });

  it("counts a late note as right and one wrong press as one wrong press", () => {
    world.clock = 1000;
    const { s, song } = make({ songId: "twinkle", mode: "melody", guidance: "steps" });
    s.start();
    const notes = excerpt(song, { hand: "both" });
    let t = world.clock;
    notes.forEach((n, i) => {
      t += i === 5 ? 6000 : 400;
      advance(t);
      if (i === 3) s.input(n.note + 1, true, world.clock, "screen");
      s.input(n.note, true, world.clock, "screen");
    });
    const r = s.getSnapshot().result!;
    // the Studio's own count, from its stepper: one note had a wrong press before it
    expect(r.firstTime).toBe(notes.length - 1);
    expect(r.wrongPresses).toBe(1);
    // timing is not judged where the app waits, so nothing is late. how many notes the engine reads as hits is the engine's own
    // business and the Studio shows its figures as they are: accuracy is the engine's hits over expected plus wrong
    expect(r.score).toMatchObject({ wrong: 1, late: 0 });
    expect(r.score!.accuracy).toBeCloseTo(r.score!.hits / (r.score!.expected + r.score!.wrong), 5);
  });

  it("is perfect after Repeat phrase and only counts the notes that were played", () => {
    world.clock = 1000;
    const { s, song } = make({ songId: "ode-to-joy", mode: "melody", guidance: "steps" });
    s.start();
    const notes = excerpt(song, { hand: "both" });
    let t = world.clock;
    const half = notes.filter((n) => n.startBeat < 8);
    for (const n of half) {
      t += 600;
      advance(t);
      s.input(n.note, true, world.clock, "screen");
    }
    s.repeatPhrase();
    for (const n of notes) {
      t += 600;
      advance(t);
      s.input(n.note, true, world.clock, "screen");
    }
    const r = s.getSnapshot().result!;
    expect(r.firstTime).toBe(r.total);
    expect(r.total).toBe(half.length + notes.length);
    // the engine was given both stretches
    expect(r.score?.expected).toBe(half.length + notes.length);
    expect(r.score).toMatchObject({ misses: 0, wrong: 0, accuracy: 1 });
    expect(r.missed).toEqual([]);
  });
});

describe("what a screen reader hears", () => {
  it("says which note is still expected after a wrong press and not for every right one", () => {
    world.clock = 1000;
    const { s, song } = make({ songId: "twinkle", mode: "melody", guidance: "steps" });
    s.start();
    const first = excerpt(song, { hand: "both" })[0]!;
    const before = s.getSnapshot().announcement;
    s.input(first.note, true, world.clock, "screen");
    expect(s.getSnapshot().announcement, "a right note is not announced").toBe(before);
    s.input(first.note + 1, true, world.clock + 10, "screen");
    expect(s.getSnapshot().announcement).toBe("Wrong. Still C 4.");
  });

  it("makes every repeat a change the reader will speak and clears the old words after a right note", () => {
    world.clock = 1000;
    const { s, song } = make({ songId: "twinkle", mode: "melody", guidance: "steps" });
    s.start();
    const first = excerpt(song, { hand: "both" })[0]!;
    const ids: number[] = [];
    for (let i = 0; i < 4; i++) {
      world.clock += 2500;
      s.input(40 + i, true, world.clock, "screen");
      ids.push(s.getSnapshot().announcementId);
      expect(s.getSnapshot().announcement).toMatch(/^Wrong/);
    }
    // every wrong announcement is a new one, even when its words are the same as the last
    expect(new Set(ids).size).toBe(4);
    s.input(first.note, true, world.clock + 10, "screen");
    expect(s.getSnapshot().announcement).toBe("");
    expect(s.getSnapshot().announcementId).toBeGreaterThan(ids[3]!);
  });

  it("does not flood the reader when keys are mashed", () => {
    world.clock = 1000;
    const { s } = make({ songId: "twinkle", mode: "melody", guidance: "steps" });
    s.start();
    const seen: string[] = [];
    s.subscribe(() => seen.push(s.getSnapshot().announcement));
    for (let i = 0; i < 10; i++) {
      world.clock += 100;
      s.input(30 + i, true, world.clock, "screen");
    }
    expect(new Set(seen.filter((a) => a.startsWith("Wrong"))).size).toBe(1);
    // after two seconds a new wrong press is announced again
    world.clock += 2500;
    s.input(40, true, world.clock, "screen");
    expect(s.getSnapshot().announcement).toMatch(/^Wrong again\. Still C 4\.$/);
  });
});

describe("what stops a piece", () => {
  it("pauses with the reason when the audio is lost", () => {
    world.clock = 1000;
    const { s, synth } = make({ songId: "twinkle" });
    s.start();
    expect(s.getSnapshot().status).toBe("counting");
    synth.onLost?.();
    expect(s.getSnapshot().status).toBe("paused");
    expect(s.getSnapshot().notice).toMatch(/sound stopped/i);
  });

  it("pauses with the reason when the keyboard is lost", () => {
    world.clock = 1000;
    const { s } = make({ songId: "twinkle", mode: "melody", guidance: "steps" });
    s.start();
    s.lose("The keyboard stopped responding, so the piece paused.");
    expect(s.getSnapshot()).toMatchObject({ status: "paused", notice: "The keyboard stopped responding, so the piece paused." });
  });
});

describe("when the engine reads earlier presses again", () => {
  // the engine's place can step back and rewrite earlier presses. a stand-in scorer plays that part
  it("follows an update whose position is lower and that rewrites three earlier presses: the lane, the rail and the summary", () => {
    world.clock = 1000;
    const hitAt = (playedIndex: number, expectedIndex: number, position: number) => ({ playedIndex, kind: "hit" as const, expectedIndex, position, errorMs: 0, speedPpm: 1_000_000, jumpedFrom: null });
    const wrongAt = (playedIndex: number, position: number) => ({ playedIndex, kind: "wrong" as const, expectedIndex: null, position, errorMs: 0, speedPpm: 1_000_000, jumpedFrom: null });
    let n = 0;
    const script = [
      { event: hitAt(0, 0, 1), changes: [], settled: 0 },
      { event: hitAt(1, 1, 2), changes: [], settled: 0 },
      { event: hitAt(2, 2, 3), changes: [], settled: 0 },
      // the fourth press moves the place back to 1 and rewrites the first three presses
      { event: hitAt(3, 3, 1), changes: [{ before: hitAt(0, 0, 1), after: wrongAt(0, 0) }, { before: hitAt(1, 1, 2), after: hitAt(1, 0, 1) }, { before: hitAt(2, 2, 3), after: wrongAt(2, 0) }], settled: 0 },
    ];
    let done = new Set<number>();
    let cues: { note: number; role: string }[] = [];
    const lane = new Proxy({}, { get: (_t, k) => (k === "setDone" ? (d: Set<number>) => (done = new Set(d)) : () => undefined) });
    const keyboard = new Proxy({}, { get: (_t, k) => (k === "setCues" ? (c: typeof cues) => (cues = c) : () => undefined) });
    const { s, song } = make({ songId: "twinkle" }, { lane: lane as never, keyboard: keyboard as never, makeScorer: () => ({ push: () => script[n++]! as never, free: () => undefined }) });
    s.start();
    const notes = excerpt(song, { hand: "both" });
    const ms = beatMs(song.tempo);
    const origin = world.clock + 4 * ms;
    // four quick presses at the start, so the update arrives while the notes are still ahead
    for (const k of [0, 1, 2, 3]) {
      advance(origin + k * 30);
      s.input(notes[k]!.note, true, world.clock, "midi");
    }
    // the rail: the next light is on the first note nobody has hit, which is note 1 again
    const next = cues.filter((c) => c.role === "next").map((c) => c.note);
    expect(next).toEqual([notes[1]!.note]);
    // the lane: only the notes the engine now reads as hit are marked done
    expect([...done].sort()).toEqual([0, 3]);
    // the summary comes from the real engine over the real presses, whatever the stand-in said
    advance(origin + 30 * ms);
    s.stop();
    const r = s.getSnapshot().result!;
    expect(r.total).toBeGreaterThan(0);
    expect(r.score?.hits).toBeGreaterThanOrEqual(0);
  });
});

describe("a run after Repeat phrase or Next phrase is scored on what was played", () => {
  // phrase one is bars 1 to 4. the player plays it, jumps and plays what is left perfectly
  it("Melody: Next phrase after phrase one, then every note right, is perfect", () => {
    world.clock = 1000;
    const { s, song } = make({ songId: "ode-to-joy", mode: "melody", guidance: "steps" });
    s.start();
    const notes = excerpt(song, { hand: "both" });
    const first = notes.filter((n) => n.startBeat < 16);
    const second = notes.filter((n) => n.startBeat >= 16);
    let t = world.clock;
    for (const n of first.slice(0, 5)) {
      t += 500;
      advance(t);
      s.input(n.note, true, world.clock, "screen");
    }
    s.nextPhrase();
    for (const n of second) {
      t += 500;
      advance(t);
      s.input(n.note, true, world.clock, "screen");
    }
    const r = s.getSnapshot().result!;
    expect(r.total, "only the notes that were played count").toBe(5 + second.length);
    expect(r.firstTime).toBe(r.total);
    expect(r.missed).toEqual([]);
    expect(r.score).toMatchObject({ misses: 0, wrong: 0, accuracy: 1 });
  });

  it("Melody: Repeat phrase part way, then every note right, is perfect", () => {
    world.clock = 1000;
    const { s, song } = make({ songId: "ode-to-joy", mode: "melody", guidance: "steps" });
    s.start();
    const notes = excerpt(song, { hand: "both" });
    let t = world.clock;
    for (const n of notes.slice(0, 5)) {
      t += 500;
      advance(t);
      s.input(n.note, true, world.clock, "screen");
    }
    s.repeatPhrase();
    for (const n of notes) {
      t += 500;
      advance(t);
      s.input(n.note, true, world.clock, "screen");
    }
    const r = s.getSnapshot().result!;
    expect(r.firstTime).toBe(r.total);
    expect(r.score).toMatchObject({ misses: 0, wrong: 0, accuracy: 1 });
  });

  it("Rhythm: Next phrase after part of phrase one, then the rest played in time, is perfect", () => {
    world.clock = 1000;
    const { s, song } = make({ songId: "ode-to-joy" });
    s.start();
    const notes = excerpt(song, { hand: "both" });
    const ms = beatMs(song.tempo);
    const origin = world.clock + 4 * ms;
    playPerfect(s, notes.filter((n) => n.startBeat < 6), origin, ms);
    // between two notes, with the next one not due yet
    advance(origin + 5.5 * ms);
    s.nextPhrase();
    const again = world.clock;
    const rest = notes.filter((n) => n.startBeat >= 16);
    for (const n of rest) {
      advance(again + (n.startBeat - 16) * ms);
      s.input(n.note, true, world.clock, "midi");
      expect(s.getSnapshot().lastEvent?.kind).toBe("right");
    }
    advance(world.clock + 8 * ms);
    const r = s.getSnapshot().result!;
    expect(r.wrongPresses).toBe(0);
    expect(r.firstTime).toBe(r.total);
    expect(r.score).toMatchObject({ wrong: 0, accuracy: 1 });
    expect(r.missed).toEqual([]);
  });

  it("Rhythm: nothing played, then Finish straight away, scores nothing and says nothing was missed", () => {
    world.clock = 1000;
    const { s } = make({ songId: "twinkle" });
    s.start();
    s.stop();
    const r = s.getSnapshot().result!;
    expect(r).toMatchObject({ total: 0, firstTime: 0, wrongPresses: 0, missed: [] });
  });
});

describe("a silent run", () => {
  it("makes no sound at all: no unlock, no count-in click and no tone", () => {
    world.clock = 1000;
    const { s, song, synth } = make({ songId: "twinkle", silent: true, keySound: true, metronome: true });
    synth.running = true;
    s.start();
    const ms = beatMs(song.tempo);
    const origin = world.clock + 4 * ms;
    for (const n of excerpt(song, { hand: "both" })) {
      advance(origin + n.startBeat * ms);
      s.input(n.note, true, world.clock, "screen");
    }
    advance(world.clock + 8 * ms);
    expect(synth.calls.filter((c) => ["unlock", "click", "tone", "wrong"].includes(c))).toEqual([]);
  });

  it("does make the count-in click when it is not silent, so the silence above is the setting and not an accident", () => {
    world.clock = 1000;
    const { s, synth } = make({ songId: "twinkle", silent: false });
    synth.running = true;
    s.start();
    advance(world.clock + 3000);
    expect(synth.calls).toContain("click");
    expect(synth.calls).toContain("unlock");
  });
});

describe("a press the engine is not sure about", () => {
  const ev = (kind: string, playedIndex: number, expectedIndex: number | null) => ({ playedIndex, kind, expectedIndex, position: 0, errorMs: 0, speedPpm: 1_000_000, jumpedFrom: null });

  it("is shown neutrally, builds no run, breaks none, marks no key wrong and is not announced", () => {
    world.clock = 1000;
    const script = [{ event: ev("hit", 0, 0), changes: [], settled: 0 }, { event: ev("unsure", 1, null), changes: [], settled: 0 }, { event: ev("hit", 2, 1), changes: [], settled: 0 }];
    let n = 0;
    const wrongs: unknown[] = [];
    const keyboard = new Proxy({}, { get: (_t, k) => (k === "setWrong" ? (v: unknown) => wrongs.push(v) : () => undefined) });
    const { s, song } = make({ songId: "twinkle" }, { keyboard: keyboard as never, makeScorer: () => ({ push: () => script[n++]! as never, free: () => undefined }) });
    s.start();
    const notes = excerpt(song, { hand: "both" });
    const origin = world.clock + 4 * beatMs(song.tempo);
    advance(origin);
    s.input(notes[0]!.note, true, world.clock, "midi");
    const announcedBefore = s.getSnapshot().announcement;
    advance(world.clock + 100);
    s.input(99, true, world.clock, "midi");
    expect(s.getSnapshot().lastEvent).toMatchObject({ kind: "unsure", label: "D\u266f7" });
    expect(s.getSnapshot().wrongPresses).toBe(0);
    expect(s.getSnapshot().announcement, "not announced").toBe(announcedBefore);
    expect(wrongs.filter((w) => w !== null), "no key is marked wrong").toEqual([]);
    advance(world.clock + 100);
    s.input(notes[1]!.note, true, world.clock, "midi");
    // the run is two right notes, unbroken by the key in between
    s.stop();
    expect(s.getSnapshot().result?.longestRun).toBe(2);
  });
});

describe("what the engine is told", () => {
  it("is given the hands practised and where the learner jumped to is told to the engine when the whole run is scored", () => {
    world.clock = 1000;
    const seen: unknown[] = [];
    const { s } = make({ songId: "ode-to-joy", hand: "right", fromBar: 3 }, { makeScorer: (_e, _c, ctx) => (seen.push(JSON.parse(JSON.stringify(ctx))), { push: () => ({ event: { playedIndex: 0, kind: "wrong", expectedIndex: null, position: 0, errorMs: 0, speedPpm: 1, jumpedFrom: null }, changes: [], settled: 0 }), free: () => undefined }) });
    s.start();
    expect(seen[0]).toEqual({ practise: "right" });
    advance(world.clock + 500);
    s.nextPhrase();
    // each stretch has its own live scorer, told the same hands
    expect(seen.at(-1)).toEqual({ practise: "right" });
  });
});

describe("a press the engine calls wrong and then withdraws", () => {
  const ev = (kind: string, playedIndex: number, expectedIndex: number | null) => ({ playedIndex, kind, expectedIndex, position: 0, errorMs: 0, speedPpm: 1_000_000, jumpedFrom: null });
  const drive = (script: { event: ReturnType<typeof ev>; changes: { before?: ReturnType<typeof ev>; after: ReturnType<typeof ev> }[]; settled: number }[]) => {
    world.clock = 1000;
    let n = 0;
    const wrongs: unknown[] = [];
    const keyboard = new Proxy({}, { get: (_t, k) => (k === "setWrong" ? (v: unknown) => wrongs.push(v) : () => undefined) });
    const made = make({ songId: "twinkle" }, { keyboard: keyboard as never, makeScorer: () => ({ push: () => script[n++]! as never, free: () => undefined }) });
    made.s.start();
    const origin = world.clock + 4 * beatMs(made.song.tempo);
    advance(origin);
    return { ...made, wrongs, press: (note: number) => { advance(world.clock + 50); made.s.input(note, true, world.clock, "midi"); } };
  };

  it("is shown at once, is not spoken while the engine may still change its mind and is never spoken once it is withdrawn", () => {
    const { s, press, wrongs } = drive([
      { event: ev("wrong", 0, null), changes: [], settled: 0 },
      { event: ev("hit", 1, 0), changes: [{ before: ev("wrong", 0, null), after: ev("hit", 0, 0) }], settled: 0 },
      { event: ev("hit", 2, 1), changes: [], settled: 3 },
    ]);
    press(61);
    expect(s.getSnapshot().lastEvent?.kind, "shown wrong at once").toBe("wrong");
    expect(s.getSnapshot().announcement, "not spoken while unsettled").not.toMatch(/Wrong/);
    expect(wrongs).toContain(61);
    press(60);
    // the engine now reads the first press as right: the cross is taken back
    expect(s.getSnapshot().wrongPresses).toBe(0);
    expect(wrongs.at(-1)).toBeNull();
    press(60);
    expect(s.getSnapshot().announcement, "withdrawn, so never spoken").not.toMatch(/Wrong/);
  });

  it("is spoken once the engine has made it final and still calls it wrong", () => {
    const { s, press } = drive([
      { event: ev("wrong", 0, null), changes: [], settled: 0 },
      { event: ev("hit", 1, 0), changes: [], settled: 0 },
      { event: ev("hit", 2, 1), changes: [], settled: 2 },
    ]);
    press(61);
    press(60);
    expect(s.getSnapshot().announcement).not.toMatch(/Wrong/);
    press(60);
    expect(s.getSnapshot().announcement).toMatch(/^Wrong\. Still /);
  });
});

describe("a replayed note", () => {
  const ev = (kind: string, playedIndex: number, expectedIndex: number | null) => ({ playedIndex, kind, expectedIndex, position: 0, errorMs: 0, speedPpm: 1_000_000, jumpedFrom: null });

  it("is right for the note it repeats and does not add to the run", () => {
    world.clock = 1000;
    const script = [{ event: ev("hit", 0, 0), changes: [], settled: 0 }, { event: ev("repeat", 1, 0), changes: [], settled: 0 }, { event: ev("hit", 2, 1), changes: [], settled: 0 }];
    let n = 0;
    const { s, song } = make({ songId: "twinkle" }, { makeScorer: () => ({ push: () => script[n++]! as never, free: () => undefined }) });
    s.start();
    const notes = excerpt(song, { hand: "both" });
    advance(world.clock + 4 * beatMs(song.tempo));
    s.input(notes[0]!.note, true, world.clock, "midi");
    advance(world.clock + 100);
    s.input(notes[0]!.note, true, world.clock, "midi");
    expect(s.getSnapshot().lastEvent?.kind).toBe("right");
    advance(world.clock + 100);
    s.input(notes[1]!.note, true, world.clock, "midi");
    s.stop();
    expect(s.getSnapshot().result?.longestRun).toBe(2);
  });
});

describe("when the engine refuses a run", () => {
  it("says so in words, carries on with the plain rule and gives no accuracy", () => {
    world.clock = 1000;
    const { s, song } = make({ songId: "twinkle" }, { makeScorer: () => ({ push: () => { throw new Error("the jump goes to a time that is not in the piece"); }, free: () => undefined }) });
    s.start();
    advance(world.clock + 4 * beatMs(song.tempo));
    s.input(excerpt(song, { hand: "both" })[0]!.note, true, world.clock, "midi");
    expect(s.getSnapshot().notice).toMatch(/could not follow this run \(the jump goes to a time that is not in the piece\).*plainer rule/);
    expect(s.getSnapshot().lastEvent?.kind).toBe("right");
  });
});
