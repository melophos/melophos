import { describe, expect, it } from "vitest";

import { forgetServer, setToken, tokenFor } from "./serverLink";

describe("the sign-in token belongs to the address that issued it", () => {
  it("is handed out for that address only", () => {
    setToken("TOKEN-A", "https://a.example");
    expect(tokenFor("https://a.example")).toBe("TOKEN-A");
    expect(tokenFor("https://b.example")).toBeNull();
  });

  it("is gone once forgotten and is never kept without an address", () => {
    setToken("TOKEN-A", "https://a.example");
    forgetServer();
    expect(tokenFor("https://a.example")).toBeNull();
    setToken("TOKEN-B", null);
    expect(tokenFor("https://a.example")).toBeNull();
  });

  it("is never written to storage", () => {
    const written: string[] = [];
    const store = { setItem: (_k: string, v: string) => written.push(v) };
    (globalThis as Record<string, unknown>)["localStorage"] = store;
    (globalThis as Record<string, unknown>)["sessionStorage"] = store;
    setToken("SECRET-TOKEN-VALUE", "https://a.example");
    expect(written.join("")).not.toContain("SECRET-TOKEN-VALUE");
  });
});
