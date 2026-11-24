import { describe, expect, it } from "vitest";

import { __setReload, onControllerChange, setPractising } from "./update";

describe("an update takes over this tab", () => {
  it("reloads at once when no piece is running here", () => {
    let reloads = 0;
    __setReload(() => (reloads += 1));
    onControllerChange();
    expect(reloads).toBe(1);
  });

  it("waits while a piece is running and reloads the moment it stops", () => {
    let reloads = 0;
    __setReload(() => (reloads += 1));
    setPractising(true);
    onControllerChange();
    expect(reloads).toBe(0);
    setPractising(false);
    expect(reloads).toBe(1);
  });
});

import { PEER_TTL_MS, PeerTable } from "./update";

describe("another tab that says it is playing", () => {
  it("blocks an update only while it keeps saying so", () => {
    const t = new PeerTable();
    t.heard("a", true, 0);
    expect(t.anyPlaying(1000)).toBe(true);
    // the tab vanished: nothing more is heard, so after the expiry it no longer counts
    expect(t.anyPlaying(PEER_TTL_MS + 1)).toBe(false);
  });

  it("stops counting the moment it says goodbye or says it has stopped", () => {
    const t = new PeerTable();
    t.heard("a", true, 0);
    t.forget("a");
    expect(t.anyPlaying(10)).toBe(false);
    t.heard("b", true, 0);
    t.heard("b", false, 100);
    expect(t.anyPlaying(200)).toBe(false);
  });

  it("keeps counting while heartbeats keep coming", () => {
    const t = new PeerTable();
    for (let now = 0; now < 60_000; now += 2000) t.heard("a", true, now);
    expect(t.anyPlaying(60_001)).toBe(true);
  });
});
