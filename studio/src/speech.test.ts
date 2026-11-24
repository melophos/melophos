import { describe, expect, it } from "vitest";

import { availability, pickVoice, sentenceFor } from "./speech";

const local = { name: "Local GB", lang: "en-GB", localService: true };
const localUs = { name: "Local US", lang: "en-US", localService: true };
const online = { name: "Cloud", lang: "en-GB", localService: false };

describe("which voice speaks", () => {
  it("prefers a local British voice and never picks an online one unasked", () => {
    expect(pickVoice([online, localUs, local], false)).toBe(local);
    expect(pickVoice([online], false)).toBeNull();
    expect(pickVoice([online, localUs], false)).toBe(localUs);
  });

  it("uses an online voice only when it is allowed", () => {
    expect(pickVoice([online], true)).toBe(online);
    expect(pickVoice([online, local], true)).toBe(local);
  });

  it("says what is true in words", () => {
    expect(sentenceFor(availability([online], false))).toMatch(/no voice that runs on this device, so nothing will be spoken/);
    expect(sentenceFor(availability([online], true))).toMatch(/words go to your browser's speech service/);
    expect(sentenceFor(availability([local], false))).toMatch(/runs on this device/);
    expect(sentenceFor(availability(null, false))).toMatch(/cannot speak/);
  });
});
