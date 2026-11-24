"use client";

// one still moment of the Studio, drawn by the Studio's own code: its keyboard with the light rail
// (studio/src/instrument/keyboard-view.ts) and its falling notes (studio/src/instrument/lane.ts), on a built-in piece.
// nothing here is redrawn by hand, so the picture is what a player sees. it never moves: the lane is drawn once at one
// position and drawn again only when the theme changes. the keys are not live, so the frame is inert and is read as
// one picture with a description
import { useEffect, useRef } from "react";
import "../../../studio/src/instrument/instrument.css";
import { KeyboardView, type Cue } from "../../../studio/src/instrument/keyboard-view.ts";
import { Lane } from "../../../studio/src/instrument/lane.ts";
import { beatsPerBar, groupsOf, layout, rangeOf } from "../../../studio/src/piece.ts";
import { SONGS } from "../../../studio/src/songs.ts";

const SONG_ID = "brother-john";
// the start of bar 3, where both hands have a note to play
const AT_BEAT = 8;

export function StudioMoment({ label }: { label: string }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    const song = SONGS.find((s) => s.id === SONG_ID);
    if (!el || !song) return;
    const notes = layout(song);
    const range = rangeOf(notes);
    if (!range) return;
    const lowest = Math.floor(range.lowest / 12) * 12;
    const highest = Math.ceil((range.highest + 1) / 12) * 12;

    const keyboard = new KeyboardView(el, { lowest, highest, names: { naming: "english", octave: "c4", accidental: "sharp" }, labels: "c" });
    const lane = new Lane(keyboard.slot, { lowest, highest, lookBeats: 6 });
    lane.setNotes(notes, beatsPerBar(song));
    lane.setDone(new Set(notes.filter((n) => n.startBeat < AT_BEAT).map((n) => n.index)));

    // per hand: the next group is lit as next and the two after it as coming up, as the practice view does
    const cues: Cue[] = [];
    for (const hand of ["right", "left"] as const) {
      const ahead = groupsOf(notes.filter((n) => n.hand === hand && n.startBeat >= AT_BEAT));
      ahead.slice(0, 3).forEach((group, i) => {
        for (const n of group) cues.push({ note: n.note, hand, role: i === 0 ? "next" : "soon" });
      });
    }
    keyboard.setCues(cues);
    lane.setCurrent(new Set(notes.filter((n) => n.startBeat === AT_BEAT).map((n) => n.index)));
    lane.draw(AT_BEAT);

    // the lane reads its colours from the tokens, so a change of theme or contrast draws it again
    const redraw = (): void => {
      lane.refreshColours();
      lane.draw(AT_BEAT);
    };
    const queries = ["(prefers-color-scheme: dark)", "(prefers-contrast: more)", "(forced-colors: active)"].map((q) => window.matchMedia(q));
    for (const q of queries) q.addEventListener("change", redraw);
    const watch = new MutationObserver(redraw);
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-contrast"] });

    return () => {
      watch.disconnect();
      for (const q of queries) q.removeEventListener("change", redraw);
      lane.destroy();
      keyboard.destroy();
    };
  }, []);

  return (
    <div className="studio-moment" role="img" aria-label={label}>
      <div ref={host} className="studio-moment-host" inert />
    </div>
  );
}
