// correcting the split into hands. the split is only ever called a first guess. the player can move notes one at a time
// or by a split point, every change is kept with the piece, one step can be undone and "back to the first guess" takes
// them all away.
import { useMemo, useRef, useState, type ReactNode } from "react";
import { History, correctedCount, effectiveHands, splitPointChanges, withChange } from "../../hands";
import { explanationFor, guessOf } from "../../imports";
import { noteLabel } from "../../notes";
import type { Hand } from "../../songs";
import type { StoredPiece } from "../store";
import { savePiece } from "../runtime";
import { useSettings } from "../settings";
import { Icon } from "../ui";

const WINDOW_BARS = 4;

export function HandEditor({ piece }: { piece: StoredPiece }): ReactNode {
  const settings = useSettings();
  const names = { naming: settings.naming, octave: settings.octave, accidental: settings.accidental };
  const history = useRef(new History(piece.corrections));
  const [, force] = useState(0);
  const [bar, setBar] = useState(1);
  const [point, setPoint] = useState(60);
  const [scopeAll, setScopeAll] = useState(true);
  const guess = useMemo(() => guessOf(piece), [piece]);
  const hands = effectiveHands(guess, piece.corrections);
  const corrected = correctedCount(guess, piece.corrections);
  const perBar = piece.beatsPerBar;
  const perMs = piece.tempo / 60_000;
  const rowsAll = useMemo(
    () =>
      piece.notes.map(([t, , note], idx) => {
        const beat = t * perMs;
        return { idx, note, bar: Math.floor(beat / perBar) + 1, beat: Math.floor(beat % perBar) + 1 };
      }),
    [piece, perBar, perMs],
  );
  const bars = Math.max(1, ...rowsAll.map((r) => r.bar));
  const last = Math.min(bars, bar + WINDOW_BARS - 1);
  const rows = rowsAll.filter((r) => r.bar >= bar && r.bar <= last);

  const commit = async (next: StoredPiece["corrections"]): Promise<void> => {
    history.current.apply(next);
    await savePiece({ ...piece, corrections: history.current.value });
    force((n) => n + 1);
  };
  const set = (idx: number, hand: Hand): Promise<void> => commit(withChange(guess, piece.corrections, [{ idx, hand }]));

  return (
    <section className="stack" aria-labelledby="hands-title" data-testid="hand-editor">
      <h2 id="hands-title">Hands: a first guess</h2>
      <p className="note">
        {explanationFor(piece.method)} This is a guess made from the file, not a fact about the music. {corrected === 0 ? "You have not corrected it." : `You have corrected ${corrected} ${corrected === 1 ? "note" : "notes"}.`}
      </p>

      <div className="panel">
        <h3>Correct by a split point</h3>
        <p>Every note below the key you pick goes to the left hand and every other note goes to the right.</p>
        <div className="actions">
          <label>
            <span className="field-label">Split at</span>
            <select value={point} onChange={(e) => setPoint(Number(e.target.value))} data-testid="split-point">
              {Array.from({ length: 49 }, (_, i) => 36 + i).map((n) => (
                <option key={n} value={n}>
                  {noteLabel(n, names)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <input type="checkbox" checked={scopeAll} onChange={(e) => setScopeAll(e.target.checked)} />
            Whole piece
          </label>
        </div>
        <p className="muted">{scopeAll ? "It changes every note." : `It changes only the bars shown below, ${bar} to ${last}.`}</p>
        <button
          type="button"
          data-testid="apply-split"
          onClick={() => {
            const from = scopeAll ? 0 : rowsAll.findIndex((r) => r.bar >= bar);
            const to = scopeAll ? piece.notes.length - 1 : rowsAll.map((r) => r.bar).lastIndexOf(last);
            void commit(withChange(guess, piece.corrections, splitPointChanges(piece.notes.map(([, , n]) => ({ note: n })), point, from, to)));
          }}
        >
          Apply the split point
        </button>
      </div>

      <div className="actions">
        <button type="button" disabled={!history.current.canUndo} onClick={() => void commit(history.current.undo()).then(() => undefined)} data-testid="undo">
          <Icon name="restart" />
          Undo the last change
        </button>
        <button type="button" disabled={corrected === 0} onClick={() => void commit({})} data-testid="reset-guess">
          Back to the first guess
        </button>
      </div>

      <h3>Correct note by note</h3>
      <div className="actions">
        <button type="button" disabled={bar <= 1} onClick={() => setBar(Math.max(1, bar - WINDOW_BARS))}>
          <Icon name="back" />
          Earlier bars
        </button>
        <p className="muted" aria-live="polite">
          {bars === 1 ? "Bar 1 of 1" : `Bars ${bar} to ${last} of ${bars}`}
        </p>
        <button type="button" disabled={last >= bars} onClick={() => setBar(bar + WINDOW_BARS)}>
          Later bars
          <Icon name="next" />
        </button>
      </div>
      <div className="table-frame">
        <table>
          <caption className="visually-hidden">Notes in bars {bar} to {last} and the hand each is given</caption>
          <thead>
            <tr>
              <th scope="col">Bar and beat</th>
              <th scope="col">Key</th>
              <th scope="col">Hand</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const hand = hands[r.idx] ?? "right";
              const other: Hand = hand === "right" ? "left" : "right";
              const changed = hand !== guess[r.idx];
              return (
                <tr key={r.idx}>
                  <th scope="row">
                    Bar {r.bar}, beat {r.beat}
                  </th>
                  <td>{noteLabel(r.note, names)}</td>
                  <td>
                    <button type="button" onClick={() => void set(r.idx, other)} aria-label={`${noteLabel(r.note, names)} in bar ${r.bar}, beat ${r.beat}, ${hand} hand${changed ? ", corrected by you" : ", first guess"}. Move to the ${other} hand`}>
                      {hand === "right" ? "Right" : "Left"}
                      {changed ? " (corrected)" : ""}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
