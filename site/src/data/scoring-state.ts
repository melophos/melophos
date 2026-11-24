// what is true of the scoring engine, as the pages state it. each statement names engine tests (core/) or Studio tests and
// tests/claims.test.ts checks that each exists, is not skipped and asserts something. every figure behind these statements
// comes from synthetic performances. nobody has played into the engine and no accuracy figure is quoted on the site.

import type { Check } from "../lib/checks.ts";

export interface ScoringClaim {
  id: string;
  text: string;
  checks: Check[];
}

const P = "core/tests/properties.rs";
const t = (file: string, title: string): Check => ({ test: { file, title } });

export const SCORING_CLAIMS: Record<string, ScoringClaim> = {
  lines: {
    id: "lines",
    text: "Each hand is followed as its own line and the two hands share one tempo.",
    checks: [t(P, "steady_play_at_any_speed_over_any_texture_is_all_hits"), t(P, "a_steady_run_always_recovers_the_tempo")],
  },
  verdicts: {
    id: "verdicts",
    text: "A press is called wrong only when the engine is sure of the place and no note of that key could have been meant. Otherwise it is not judged, a neutral verdict that counts neither for nor against the player. The Studio shows it with its own shape and words.",
    checks: [
      t(P, "a_note_is_turned_wrong_only_by_a_press_that_is_that_note"),
      t(P, "no_single_interval_can_make_the_rest_of_a_session_unsure"),
      t("studio/src/scoring.test.ts", "calls an unsure press unsure and anything unknown unsure, so a new kind of outcome is never called right or wrong by mistake"),
    ],
  },
  timing: {
    id: "timing",
    text: "Timing is judged against the player's own tempo, in a window that grows with the gap between notes.",
    checks: [t("core/src/follow.rs", "the_window_is_a_quarter_of_the_gap_between_notes_with_a_floor"), t("core/src/follow.rs", "rubato_in_slow_practice_is_not_late"), t(P, "a_steady_performance_at_any_speed_is_all_hits_at_that_speed")],
  },
  studioTells: {
    id: "studioTells",
    text: "The Studio tells the engine which hand is being practised and each Repeat phrase or Next phrase.",
    checks: [
      { file: "studio/src/scoring.ts", contains: "practise: c?.practise" },
      t(P, "a_stated_jump_in_a_batch_is_the_live_jump"),
      t("studio/src/scoring.test.ts", "calls a replayed note right, for the note it repeats"),
    ],
  },
  limits: {
    id: "limits",
    text: "It is still being worked on. A chord struck twice on purpose can shift the reading, practising one hand while also playing the other is read inconsistently where the hands share keys. Hesitations can still cost late marks.",
    checks: [{ file: "docs/scoring.md", contains: "Every chord struck twice on purpose is read badly" }, { file: "docs/scoring.md", contains: "With one hand named, the other hand's presses are never judged" }],
  },
  synthetic: {
    id: "synthetic",
    text: "Every figure comes from synthetic performances. Nobody has played into the engine.",
    checks: [{ file: "docs/scoring-design.md", contains: "Nobody has played into this engine" }, { file: "docs/scoring.md", contains: "Every figure on this page comes from synthetic performances" }],
  },
};
