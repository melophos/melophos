// the personal bests of the rhythm game, for each song and each difficulty, kept in this browser. a best set with an earlier
// version of the scoring engine is kept and shown apart, never compared with a new one
import { useMemo, type ReactNode } from "react";
import { ENGINE_VERSION } from "../../engine";
import { groupBests, type Best } from "../../game";
import { useBests } from "../runtime";
import { ButtonLink, EmptyState, Link } from "../ui";
import { BestsTable } from "./GameResult";

export function BestsFor({ bests }: { bests: readonly Best[] }): ReactNode {
  const { current, earlier } = groupBests(bests, ENGINE_VERSION);
  const sorted = (l: Best[]): Best[] => [...l].sort((a, b) => a.difficulty.speedPct - b.difficulty.speedPct || a.difficulty.hand.localeCompare(b.difficulty.hand));
  return (
    <>
      {current.length > 0 ? <BestsTable bests={sorted(current)} caption="Personal bests, one for each setting" /> : null}
      {earlier.length > 0 ? (
        <details>
          <summary>Earlier results ({earlier.length})</summary>
          <p>These were set with an earlier version of the scoring engine. They are kept and they are not compared with new results, because the way the engine judges has changed since.</p>
          <BestsTable bests={sorted(earlier)} caption="Results from an earlier version of the scoring engine" />
        </details>
      ) : null}
    </>
  );
}

export function Bests(): ReactNode {
  const { bests, loading } = useBests();
  const songs = useMemo(() => {
    const map = new Map<string, { title: string; list: Best[] }>();
    for (const b of bests) map.set(b.songId, { title: b.songTitle, list: [...(map.get(b.songId)?.list ?? []), b] });
    return [...map.entries()].sort((a, b) => a[1].title.localeCompare(b[1].title, "en-GB"));
  }, [bests]);
  return (
    <>
      <h1>Personal bests</h1>
      <p>
        Your best result in the rhythm game for each song, set at each speed and hand. Playing at a slower speed or with one hand never replaces a best set at full speed with both. These are only what the scoring engine thinks and they stay in this browser. There is nobody to compare with.
      </p>
      {loading ? (
        <p className="muted">Loading your bests.</p>
      ) : songs.length === 0 ? (
        <EmptyState title="No bests yet" action={<ButtonLink to={["library"]} primary>Choose a piece for the rhythm game</ButtonLink>}>
          Play the rhythm game on any piece and your first result is kept as your best.
        </EmptyState>
      ) : (
        songs.map(([id, s]) => (
          <section key={id} className="stack" aria-labelledby={`b-${id}`}>
            <h2 id={`b-${id}`}>{s.title}</h2>
            <BestsFor bests={s.list} />
            <p>
              <Link to={["game", id]}>Play the rhythm game on this piece</Link>
            </p>
          </section>
        ))
      )}
    </>
  );
}
