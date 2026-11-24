// input calibration: the player taps along with a click and the median gap between each tap and its click is the delay
// to take off every press from that input. a tap more than 350 ms from any click is a stray and is left out.
// it is the player's own delay including the keyboard's and the browser's, which is the figure the scoring needs.
export const CALIBRATION_WINDOW_MS = 350;
export const MIN_TAPS = 5;

export function medianOffset(taps: readonly number[], clicks: readonly number[]): number | null {
  const offsets: number[] = [];
  for (const tap of taps) {
    let best: number | null = null;
    for (const click of clicks) {
      const d = tap - click;
      if (Math.abs(d) <= CALIBRATION_WINDOW_MS && (best === null || Math.abs(d) < Math.abs(best))) best = d;
    }
    if (best !== null) offsets.push(best);
  }
  if (offsets.length < MIN_TAPS) return null;
  offsets.sort((a, b) => a - b);
  const mid = Math.floor(offsets.length / 2);
  const median = offsets.length % 2 ? (offsets[mid] ?? 0) : ((offsets[mid - 1] ?? 0) + (offsets[mid] ?? 0)) / 2;
  // to the nearest 5 ms, since the measure is no better than that
  return Math.round(median / 5) * 5;
}
