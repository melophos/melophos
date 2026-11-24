// finds text that prints over other text. it reads the box of every line of every visible text node, ignores what a
// scroll area or a clip hides and reports each pair of boxes from different text nodes that share a real area.
// the existing checks passed over unreadable text because nothing measured this.
import type { Page } from "@playwright/test";

export async function overlaps(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    interface Box {
      l: number;
      t: number;
      r: number;
      b: number;
      text: string;
      node: Node;
    }
    const boxes: Box[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n.textContent ?? "").trim();
      const el = n.parentElement;
      if (!text || !el || el.closest("svg, script, style, noscript, .visually-hidden, .skip-link")) continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none" || style.opacity === "0") continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const rect of range.getClientRects()) {
        if (rect.width < 2 || rect.height < 2) continue;
        let l = rect.left;
        let t = rect.top;
        let r = rect.right;
        let b = rect.bottom;
        // clip to every ancestor that hides or scrolls its overflow
        for (let a: Element | null = el; a && a !== document.documentElement; a = a.parentElement) {
          const s = getComputedStyle(a);
          if (s.overflowX !== "visible" || s.overflowY !== "visible") {
            const c = a.getBoundingClientRect();
            if (s.overflowX !== "visible") {
              l = Math.max(l, c.left);
              r = Math.min(r, c.right);
            }
            if (s.overflowY !== "visible") {
              t = Math.max(t, c.top);
              b = Math.min(b, c.bottom);
            }
          }
        }
        if (r - l < 2 || b - t < 2) continue;
        boxes.push({ l, t, r, b, text: text.slice(0, 28), node: n });
      }
    }
    const out: string[] = [];
    boxes.sort((x, y) => x.t - y.t);
    for (let i = 0; i < boxes.length; i++) {
      const a = boxes[i];
      if (!a) continue;
      for (let j = i + 1; j < boxes.length; j++) {
        const c = boxes[j];
        if (!c || c.t >= a.b) break;
        if (a.node === c.node) continue;
        const w = Math.min(a.r, c.r) - Math.max(a.l, c.l);
        const h = Math.min(a.b, c.b) - Math.max(a.t, c.t);
        // lines of one paragraph share a sliver of height because a line box is taller than its line spacing, so a
        // real overlap is one that covers a third of the smaller box's height. any width counts: letters that share
        // even a few pixels with other letters are hard to read
        const smallerH = Math.min(a.b - a.t, c.b - c.t);
        if (w > 3 && h > smallerH / 3) out.push(`"${a.text}" overlaps "${c.text}" by ${Math.round(w)} by ${Math.round(h)} px`);
      }
    }
    return out.slice(0, 8);
  });
}
