// what a run came to. counts come first. accuracy is the scoring engine's own figure. timing is only shown in Rhythm
// mode after calibration, rounded to 10 ms with the word "about", because it is not better than a frame.
import { useMemo, type ReactNode } from "react";
import type { NameOptions } from "../../notes";
import { HeatKeyboard, HeatTable } from "../charts";
import type { SessionRecord } from "../store";
import { formatDuration } from "../ui";

export function Summary({ record, names, simulated }: { record: SessionRecord; names: NameOptions; simulated?: boolean }): ReactNode {
  const missed = useMemo(() => new Map(record.missed.map((m) => [m.note, m.count] as const)), [record]);
  const score = record.score;
  const rows: [string, string][] = [
    ["Notes right first time", `${record.firstTime} of ${record.total}`],
    ["Wrong presses", String(record.wrongPresses)],
    ["Longest run of right notes", `${record.longestRun} ${record.longestRun === 1 ? "note" : "notes"}`],
    ["Time taken", formatDuration(record.durationMs)],
  ];
  if (record.speedPct !== 100) rows.push(["Tempo", `${record.speedPct}% of the written speed`]);
  if (score) {
    rows.push(["Keys not judged", `${score.notJudged ?? 0}. The scoring engine was not sure about these, so they count neither for you nor against you.`]);
    rows.push(["Accuracy", `${Math.round(score.accuracy * 100)}% (${score.hits} hits${score.late ? `, ${score.late} late` : ""} out of ${score.expected} notes plus ${score.wrong} wrong ${score.wrong === 1 ? "press" : "presses"})`]);
    if (score.timingMs !== null) rows.push(["Timing", `about ${score.timingMs} ms from the beat`]);
  }
  // finishing straight after Start leaves nothing to score. say that and do not blame the scoring module
  if (record.total === 0 && record.wrongPresses === 0 && record.firstTime === 0) {
    return (
      <section className="panel summary" aria-labelledby="summary-title" data-testid="nothing-played">
        <h2 id="summary-title" tabIndex={-1}>
          Nothing was played
        </h2>
        <p>You finished before playing a note, so there is nothing to score and this run is not saved.</p>
      </section>
    );
  }
  return (
    <section className="panel summary" aria-labelledby="summary-title">
      <h2 id="summary-title" tabIndex={-1}>
        {simulated ? "Simulated run, not saved" : "Summary"}
      </h2>
      {simulated ? <p>This run was played by the simulator, so it is not part of your record.</p> : null}
      {!score && record.mode !== "listen" ? (
        <p className="note">
          {record.scoreProblem
            ? `There is no accuracy figure for this run. The scoring engine said: ${record.scoreProblem} The counts here come from the app itself.`
            : "There is no accuracy figure for this run, because the scoring module did not load. The counts here come from the app itself."}
        </p>
      ) : null}
      <dl className="facts">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {record.missed.length > 0 ? (
        <>
          <h3>Keys that went wrong</h3>
          <HeatKeyboard counts={missed} names={names} title="The keys that went wrong, each with the number of times" />
          <HeatTable counts={missed} names={names} />
        </>
      ) : (
        <p>No key went wrong in this run.</p>
      )}
    </section>
  );
}
