import { describe, expect, it } from "vitest";

import { medianOffset } from "./calibration";

const clicks = [1000, 1750, 2500, 3250, 4000, 4750, 5500, 6250];

describe("calibration", () => {
  it("is the median gap between taps and clicks, to 5 ms", () => {
    expect(medianOffset(clicks.map((c) => c + 40), clicks)).toBe(40);
    expect(medianOffset(clicks.map((c, i) => c + (i % 2 ? 30 : 52)), clicks)).toBe(40);
  });

  it("allows a tap before the click", () => {
    expect(medianOffset(clicks.map((c) => c - 62), clicks)).toBe(-60);
  });

  it("leaves out a stray tap and asks for more when too few are left", () => {
    expect(medianOffset([1040, 1790, 2540, 9000], clicks)).toBeNull();
    expect(medianOffset([...clicks.map((c) => c + 20), 20000], clicks)).toBe(20);
  });
});
