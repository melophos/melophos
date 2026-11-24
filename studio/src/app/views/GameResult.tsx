// the result of a rhythm game run, in plain words. every number on it is a field of the scoring engine's summary. nothing is
// added: no points, no stars, no level. the page says what the engine counted and that this is only what the engine thinks
import type { ReactNode } from "react";
import { describeDifficulty, percent, type Best, type Difficulty, type GameResult, type Outcome } from "../../game";
import { Icon } from "../ui";

export interface Finished {
  result: GameResult | null;
  outcome: Outcome | null;
  difficulty: Difficulty;
  // false when the best could not be kept
  kept: boolean;
}

// the one sentence about the best, for the page and for a screen reader
export function bestSentence(f: Finished): string {
  if (!f.result) return "The scoring module did not load, so there is no result to keep.";
  if (!f.outcome) return "";
  switch (f.outcome.kind) {
    case "first":
      return `This is your first result for this song with these settings, so it is your best so far: ${percent(f.result.accuracy)}.`;
    case "new-best":
      return `A new best for this song with these settings: ${percent(f.result.accuracy)}, up from ${percent(f.outcome.previous.accuracy)}.`;
    case "not-best":
      return `Your best for this song with these settings is still ${percent(f.outcome.best.accuracy)}.`;
  }
}

export function announcement(f: Finished): string {
  if (!f.result) return `Finished. ${bestSentence(f)}`;
  const isBest = f.outcome?.kind === "first" || f.outcome?.kind === "new-best";
  return `Finished. ${percent(f.result.accuracy)} accuracy. ${f.result.hits} of ${f.result.expected} notes hit. ${isBest ? "New best." : ""}`.trim();
}

export function GameResultPanel({ finished, title }: { finished: Finished; title: string }): ReactNode {
  const { result, outcome, difficulty } = finished;
  const isBest = outcome?.kind === "first" || outcome?.kind === "new-best";
  return (
    <section className="panel summary" aria-labelledby="game-result" data-testid="game-result">
      <h2 id="game-result" tabIndex={-1}>
        Your result
      </h2>
      <p className="muted">
        {title}, {describeDifficulty(difficulty)}.
      </p>
      {result ? (
        <>
          {isBest ? (
            <p className="best-mark" data-testid="new-best">
              <Icon name="trophy" />
              <strong>{outcome?.kind === "first" ? "First result, kept as your best" : "New best"}</strong>
            </p>
          ) : null}
          <p data-testid="best-sentence">{bestSentence(finished)}</p>
          <dl className="facts">
            <div>
              <dt>Accuracy</dt>
              <dd>{percent(result.accuracy)}</dd>
            </div>
            <div>
              <dt>Notes hit</dt>
              <dd>
                {result.hits} of {result.expected}
              </dd>
            </div>
            <div>
              <dt>Notes hit late</dt>
              <dd>{result.late}</dd>
            </div>
            <div>
              <dt>Notes missed</dt>
              <dd>{result.misses}</dd>
            </div>
            <div>
              <dt>Wrong keys pressed</dt>
              <dd>{result.wrong}</dd>
            </div>
            <div data-testid="not-judged">
              <dt>Keys not judged</dt>
              <dd>
                {result.notJudged}
                <span className="muted"> The scoring engine was not sure about these. They count neither for you nor against you and they do not change your best.</span>
              </dd>
            </div>
          </dl>
          <p className="muted">These numbers come from the scoring engine, a program that listens to the keys you pressed. It is only what the engine thinks. It does not know how hard you tried or how much you improved. Accuracy is the notes hit out of the notes in the piece plus the wrong keys pressed. Keys not judged are left out of it.</p>
        </>
      ) : (
        <p className="note">{bestSentence(finished)}</p>
      )}
      {result && !finished.kept ? <p className="note">This best could not be saved in the browser. It will not be there next time.</p> : null}
    </section>
  );
}

// the bests of one song, each with the settings it was set with
export function BestsTable({ bests, caption }: { bests: readonly Best[]; caption: string }): ReactNode {
  return (
    <div className="table-frame">
      <table>
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Settings</th>
            <th scope="col">Best accuracy</th>
            <th scope="col">Notes hit</th>
            <th scope="col">Set on</th>
          </tr>
        </thead>
        <tbody>
          {bests.map((b) => (
            <tr key={b.id}>
              <th scope="row">{describeDifficulty(b.difficulty)}</th>
              <td>{percent(b.accuracy)}</td>
              <td>
                {b.hits} of {b.expected}
              </td>
              <td>{new Date(b.achievedAt).toLocaleDateString("en-GB")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
