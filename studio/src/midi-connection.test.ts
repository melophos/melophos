import { describe, expect, it } from "vitest";

import { MidiConnection, explain, initialState, type MidiHost, type MidiState } from "./midi-connection";

// a fake of the parts of Web MIDI the connection uses
class FakeInput {
  onmidimessage: ((e: MIDIMessageEvent) => void) | null = null;
  constructor(
    readonly name: string,
    public state: "connected" | "disconnected" = "connected",
  ) {}
  send(bytes: number[], timeStamp: number): void {
    this.onmidimessage?.({ data: new Uint8Array(bytes), timeStamp } as unknown as MIDIMessageEvent);
  }
}

class FakeAccess {
  inputs = new Map<string, FakeInput>();
  onstatechange: (() => void) | null = null;
  add(input: FakeInput): void {
    this.inputs.set(input.name, input);
    this.onstatechange?.();
  }
  remove(name: string): void {
    const input = this.inputs.get(name);
    if (input) input.state = "disconnected";
    this.onstatechange?.();
  }
}

function host(access: FakeAccess | Error, over: Partial<MidiHost> = {}): MidiHost {
  return {
    requestMIDIAccess: () => (access instanceof Error ? Promise.reject(access) : Promise.resolve(access as unknown as MIDIAccess)),
    secure: true,
    firefox: false,
    ...over,
  };
}

const kinds = (c: MidiConnection): MidiState["kind"][] => {
  const seen: MidiState["kind"][] = [];
  c.subscribe((s) => seen.push(s.kind));
  return seen;
};

describe("midi connection states", () => {
  it("is unsupported where the browser has no Web MIDI", () => {
    expect(initialState({ secure: true, firefox: false }).kind).toBe("unsupported");
  });

  it("needs a secure address", () => {
    const c = new MidiConnection(host(new FakeAccess(), { secure: false }));
    expect(c.state.kind).toBe("insecure");
  });

  it("does not ask the browser until connect is called", () => {
    let asked = 0;
    const c = new MidiConnection({ secure: true, firefox: false, requestMIDIAccess: () => ((asked += 1), Promise.resolve(new FakeAccess() as unknown as MIDIAccess)) });
    expect(c.state.kind).toBe("idle");
    expect(asked).toBe(0);
  });

  it("goes from idle through asking to connected", async () => {
    const access = new FakeAccess();
    access.inputs.set("Keys", new FakeInput("Keys"));
    const c = new MidiConnection(host(access));
    const seen = kinds(c);
    await c.connect();
    expect(seen).toEqual(["asking", "connected"]);
    expect(c.state).toEqual({ kind: "connected", names: ["Keys"] });
  });

  it("says allowed with no device when nothing is plugged in, then finds a keyboard plugged in later", async () => {
    const access = new FakeAccess();
    const c = new MidiConnection(host(access));
    await c.connect();
    expect(c.state.kind).toBe("no-devices");
    access.add(new FakeInput("Late keys"));
    expect(c.state).toEqual({ kind: "connected", names: ["Late keys"] });
  });

  it("notices an unplugged keyboard and its return", async () => {
    const access = new FakeAccess();
    access.inputs.set("Keys", new FakeInput("Keys"));
    const c = new MidiConnection(host(access));
    await c.connect();
    access.remove("Keys");
    expect(c.state).toEqual({ kind: "lost", names: ["Keys"] });
    access.add(new FakeInput("Keys"));
    expect(c.state.kind).toBe("connected");
  });

  it("is refused when the player says no", async () => {
    const c = new MidiConnection(host(new DOMException("blocked", "SecurityError") as unknown as Error));
    await c.connect();
    expect(c.state.kind).toBe("refused");
  });

  it("reports any other failure with the browser's reason", async () => {
    const c = new MidiConnection(host(new Error("driver missing")));
    await c.connect();
    expect(c.state).toEqual({ kind: "failed", message: "driver missing" });
  });

  it("hands on notes with the event's own timestamp", async () => {
    const access = new FakeAccess();
    const keys = new FakeInput("Keys");
    access.inputs.set("Keys", keys);
    const c = new MidiConnection(host(access));
    const got: unknown[] = [];
    const activity: boolean[] = [];
    c.onNote = (n) => got.push(n);
    c.onActivity = (a) => activity.push(a);
    await c.connect();
    keys.send([0x90, 60, 100], 1234.5);
    keys.send([0x80, 60, 0], 1300.25);
    expect(got).toEqual([
      { note: 60, velocity: 100, channel: 0, on: true, atMs: 1234.5 },
      { note: 60, velocity: 0, channel: 0, on: false, atMs: 1300.25 },
    ]);
    expect(activity).toEqual([true, false]);
  });

  it("listens only to the chosen input when there are two", async () => {
    const access = new FakeAccess();
    const a = new FakeInput("Stage piano");
    const b = new FakeInput("Pad controller");
    access.inputs.set(a.name, a);
    access.inputs.set(b.name, b);
    const c = new MidiConnection(host(access));
    const got: number[] = [];
    c.onNote = (n) => got.push(n.note);
    await c.connect();
    a.send([0x90, 60, 90], 1);
    b.send([0x90, 61, 90], 2);
    c.only = "Stage piano";
    a.send([0x90, 62, 90], 3);
    b.send([0x90, 63, 90], 4);
    expect(got).toEqual([60, 61, 62]);
  });

  it("reads the sustain pedal", async () => {
    const access = new FakeAccess();
    const keys = new FakeInput("Keys");
    access.inputs.set("Keys", keys);
    const c = new MidiConnection(host(access));
    const pedal: boolean[] = [];
    c.onPedal = (p) => pedal.push(p.down);
    await c.connect();
    keys.send([0xb0, 64, 127], 1);
    keys.send([0xb0, 64, 0], 2);
    keys.send([0xb0, 1, 90], 3);
    expect(pedal).toEqual([true, false]);
  });

  it("acts on the pedal only when it crosses from up to down, not on every value of a held pedal", async () => {
    const access = new FakeAccess();
    const keys = new FakeInput("Keys");
    access.inputs.set("Keys", keys);
    const c = new MidiConnection(host(access));
    const events: boolean[] = [];
    c.onPedal = (p) => events.push(p.down);
    await c.connect();
    for (const v of [64, 70, 90, 127, 127, 100, 64, 10, 0, 0, 64]) keys.send([0xb0, 64, v], 1);
    expect(events).toEqual([true, false, true]);
  });
});

describe("the words for each state", () => {
  const states: MidiState[] = [
    { kind: "unsupported" },
    { kind: "insecure" },
    { kind: "idle" },
    { kind: "asking" },
    { kind: "no-devices" },
    { kind: "connected", names: ["Keys"] },
    { kind: "refused" },
    { kind: "lost", names: ["Keys"] },
    { kind: "failed", message: "driver missing" },
  ];

  it("gives every state a plain headline and says what to do", () => {
    for (const s of states) {
      const e = explain(s, { firefox: false });
      expect(e.headline.length, s.kind).toBeGreaterThan(10);
      expect(e.detail.length, s.kind).toBeGreaterThan(20);
      expect(`${e.headline}${e.detail}`, s.kind).not.toMatch(/[\u2014\u2013]|usb_midi|ble_midi/);
    }
  });

  it("explains the prompt before it is shown and has a Firefox wording", () => {
    expect(explain({ kind: "idle" }, { firefox: false }).detail).toMatch(/asks? whether this page may use your MIDI/);
    expect(explain({ kind: "idle" }, { firefox: true }).detail).toMatch(/add-on/);
  });

  it("offers a working path when the browser has no MIDI", () => {
    expect(explain({ kind: "unsupported" }, { firefox: false }).detail).toMatch(/on-screen keys/);
    expect(explain({ kind: "refused" }, { firefox: false }).detail).toMatch(/site settings/);
  });
});
