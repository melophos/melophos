import { describe, expect, it } from "vitest";

import { hubNotices } from "./hub";

describe("hub notices", () => {
  it("says nothing when no hub has reported", () => {
    expect(hubNotices(null)).toEqual([]);
    expect(hubNotices({})).toEqual([]);
    expect(hubNotices({ encrypted: true })).toEqual([]);
  });

  it("names the development mode in words, with the light it makes", () => {
    const [n] = hubNotices({ encrypted: false });
    expect(n?.headline).toBe("This hub is in development mode: its connection is not encrypted.");
    expect(n?.detail).toMatch(/dim white glow/);
    expect(n?.problem).toBe(true);
  });
});
