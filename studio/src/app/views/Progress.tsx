// the practice record. counts first, plain facts, charts with their units and a table behind each one.
// there is no streak counter: a record of the days practised says the same thing without a chain to keep unbroken.
import { useMemo, useState, type ReactNode } from "react";
import { useLibrary } from "../../pieces";
import type { ServerSession } from "../api-source";
import { DaysGrid, HeatKeyboard, HeatTable, LineChart, SeriesTable } from "../charts";
import { ENOUGH_FOR_A_LINE, daysPractised, mergeMissed, practisedPieces, recordSentence, seriesFor } from "../progress";
import { useSessions } from "../runtime";
import { useSettings } from "../settings";
import { ButtonLink, Confirm, EmptyState, Link, formatDate } from "../ui";
import { deleteSession } from "../server";
import { useLink } from "../serverLink";
import { serverStore, useServerSessions } from "./serverStore";

export function Progress({ pieceId }: { pieceId: string | null }): ReactNode {
  const { records, loading } = useSessions();
  const settings = useSettings();
  const server = useServerSessions();
  const names = { naming: settings.naming, octave: settings.octave, accidental: settings.accidental };
  if (loading) {
    return (
      <>
        <h1>Progress</h1>
        <div className="panel-space" role="status">
          Loading your record.
        </div>
      </>
    );
  }
  return pieceId ? <PieceProgress pieceId={pieceId} records={records} names={names} /> : <Overview records={records} names={names} server={server} />;
}

type Names = { naming: "english" | "german" | "solfege"; octave: "c4" | "c3"; accidental: "sharp" | "flat" };
type Records = ReturnType<typeof useSessions>["records"];

function Overview({ records, names, server }: { records: Records; names: Names; server: ServerSession[] }): ReactNode {
  const days = useMemo(() => daysPractised(records, new Date()), [records]);
  const pieces = useMemo(() => practisedPieces(records), [records]);
  const missed = useMemo(() => mergeMissed(records), [records]);
  return (
    <>
      <h1>Progress</h1>
      {records.length === 0 && server.length === 0 ? (
        <EmptyState title="Nothing to show yet" action={<ButtonLink to={["library"]} primary>Choose a piece to practise</ButtonLink>}>
          Your record starts with your first finished run in Melody or Rhythm mode. A run played by the simulator is never counted.
        </EmptyState>
      ) : (
        <>
          <section aria-labelledby="days" className="stack">
            <h2 id="days">Days practised</h2>
            <p data-testid="days-sentence">{recordSentence(days)}</p>
            <DaysGrid days={days} />
            <details>
              <summary>Show the days as a table</summary>
              <div className="table-frame">
                <table>
                  <caption className="visually-hidden">Days with practice in the last 28 days</caption>
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Sessions</th>
                      <th scope="col">Minutes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {days.filter((d) => d.practised).map((d) => (
                      <tr key={d.date}>
                        <th scope="row">{formatDate(`${d.date}T12:00:00`)}</th>
                        <td>{d.sessions}</td>
                        <td>{d.minutes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </section>

          <section aria-labelledby="pieces" className="stack">
            <h2 id="pieces">Pieces</h2>
            {pieces.length === 0 ? (
              <p>No piece has a finished run in Melody or Rhythm mode yet.</p>
            ) : (
              <ul className="rows">
                {pieces.map((p) => (
                  <li key={p.pieceId}>
                    <Link to={["progress", p.pieceId]} className="row">
                      <span className="row-main">
                        <span className="row-title">{p.title}</span>
                        <span className="muted">
                          {p.sessions} {p.sessions === 1 ? "session" : "sessions"}, last on {formatDate(p.last)}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="keys" className="stack">
            <h2 id="keys">Keys that went wrong</h2>
            {missed.size === 0 ? (
              <p>No key has gone wrong in your saved runs. This view fills in as you practise.</p>
            ) : (
              <>
                <p>Each key shows how many times it was the one you needed and you missed it, over every saved run. Darker or brighter steps mean more. The number is on the key.</p>
                <HeatKeyboard counts={missed} names={names} title="Keys missed over every saved run, with the number of times on each key" />
                <details>
                  <summary>Show the keys as a table</summary>
                  <HeatTable counts={missed} names={names} />
                </details>
              </>
            )}
          </section>
        </>
      )}
      {server.length > 0 ? <ServerSection sessions={server} /> : null}
    </>
  );
}

function PieceProgress({ pieceId, records, names }: { pieceId: string; records: Records; names: Names }): ReactNode {
  const song = useLibrary().songs.find((s) => s.id === pieceId);
  const points = useMemo(() => seriesFor(records, pieceId), [records, pieceId]);
  const missed = useMemo(() => mergeMissed(records, pieceId), [records, pieceId]);
  const [showTable, setShowTable] = useState(false);
  const title = song?.title ?? "This piece";
  if (points.length === 0) {
    return (
      <>
        <p>
          <Link to={["progress"]}>All progress</Link>
        </p>
        <h1>{title}</h1>
        <EmptyState title="No sessions of this piece yet" action={song ? <ButtonLink to={["practise", song.id]} primary>Practise it</ButtonLink> : undefined}>
          Finish a run in Melody or Rhythm mode and it will appear here.
        </EmptyState>
      </>
    );
  }
  const enough = points.length >= ENOUGH_FOR_A_LINE;
  const last = points.at(-1);
  return (
    <>
      <p>
        <Link to={["progress"]}>All progress</Link>
      </p>
      <h1>{title}</h1>
      <p data-testid="piece-sentence">
        {points.length} {points.length === 1 ? "session" : "sessions"}. The latest had {last?.firstTime} of {last?.total} notes right first time.
      </p>
      {enough ? (
        <>
          <section aria-labelledby="c1" className="stack">
            <h2 id="c1">Notes right first time</h2>
            <LineChart
              title={`Notes right first time in each session of ${title}, in per cent`}
              yLabel="Notes right first time (per cent)"
              xLabel="Session, oldest to newest"
              points={points.map((p) => ({ x: p.session, y: p.firstTimePct, label: String(p.session) }))}
              yMax={100}
              yTicks={[0, 25, 50, 75, 100]}
              unit="%"
              seriesName="Latest"
            />
          </section>
          <section aria-labelledby="c2" className="stack">
            <h2 id="c2">Tempo</h2>
            <LineChart
              title={`Tempo reached in each session of ${title}, in per cent of the written speed`}
              yLabel="Tempo (per cent of written speed)"
              xLabel="Session, oldest to newest"
              points={points.map((p) => ({ x: p.session, y: p.speedPct, label: String(p.session) }))}
              yMax={125}
              yTicks={[0, 25, 50, 75, 100, 125]}
              unit="%"
              seriesName="Latest"
            />
          </section>
        </>
      ) : (
        <p className="note" data-testid="too-little">
          There is one session so far. A line needs at least two to show a change, so the charts appear after your next run. The figures are in the table.
        </p>
      )}
      <section aria-labelledby="t1" className="stack">
        <h2 id="t1">Every session</h2>
        <button type="button" aria-expanded={showTable || !enough} onClick={() => setShowTable((v) => !v)} hidden={!enough}>
          {showTable ? "Hide the table" : "Show the charts' figures as a table"}
        </button>
        {showTable || !enough ? <SeriesTable points={points} /> : null}
      </section>
      <section aria-labelledby="k1" className="stack">
        <h2 id="k1">Keys that went wrong in this piece</h2>
        {missed.size === 0 ? (
          <p>No key has gone wrong in the saved runs of this piece.</p>
        ) : (
          <>
            <HeatKeyboard counts={missed} names={names} title={`Keys missed in ${title}, with the number of times on each key`} />
            <details>
              <summary>Show the keys as a table</summary>
              <HeatTable counts={missed} names={names} />
            </details>
          </>
        )}
      </section>
    </>
  );
}

const STATE_WORD = { none: "not scored", pending: "score pending", scored: "not recorded", failed: "scoring failed" } as const;

// sessions read from the player's own server: accuracy and tempo over time for each song, with a table behind each chart
function ServerSection({ sessions }: { sessions: ServerSession[] }): ReactNode {
  const link = useLink();
  const [note, setNote] = useState("");
  const groups = useMemo(() => {
    const map = new Map<string, ServerSession[]>();
    for (const s of [...sessions].sort((a, b) => a.startedAt.localeCompare(b.startedAt))) {
      const key = s.songId ?? "free";
      map.set(key, [...(map.get(key) ?? []), s]);
    }
    return [...map.entries()].slice(0, 6);
  }, [sessions]);
  return (
    <section aria-labelledby="srv" className="stack" data-testid="server-progress">
      <h2 id="srv">From your own server</h2>
      <p>{sessions.length} sessions were read from your server for this visit. Accuracy and tempo appear only where the server has scored the session.</p>
      <p>
        <Link to={["settings", "server"]}>Delete data on your server or sign out everywhere</Link>
      </p>
      <p role="status">{note}</p>
      {groups.map(([song, list]) => {
        const scored = list.filter((s) => s.accuracy !== null);
        return (
          <div key={song} className="stack">
            <h3>{song === "free" ? "Free play" : `Song ${song.slice(0, 8)}`}</h3>
            {scored.length >= ENOUGH_FOR_A_LINE ? (
              <>
                <LineChart
                  title="Accuracy in each scored session, in per cent"
                  yLabel="Accuracy (per cent)"
                  xLabel="Scored session, oldest to newest"
                  points={scored.map((s, i) => ({ x: i + 1, y: Math.round((s.accuracy ?? 0) * 1000) / 10, label: String(i + 1) }))}
                  yMax={100}
                  yTicks={[0, 25, 50, 75, 100]}
                  unit="%"
                  seriesName="Latest"
                />
                <LineChart
                  title="Tempo reached in each scored session, in per cent of the written speed"
                  yLabel="Tempo (per cent of written speed)"
                  xLabel="Scored session, oldest to newest"
                  points={scored.map((s, i) => ({ x: i + 1, y: s.speedPct, label: String(i + 1) }))}
                  yMax={125}
                  yTicks={[0, 25, 50, 75, 100, 125]}
                  unit="%"
                  seriesName="Latest"
                />
              </>
            ) : (
              <p className="note">Fewer than two scored sessions, so there is no line to draw. The table has what the server holds.</p>
            )}
            <details>
              <summary>Show these sessions as a table</summary>
              <div className="table-frame">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Mode</th>
                      <th scope="col">Notes played</th>
                      <th scope="col">Accuracy</th>
                      <th scope="col">Tempo</th>
                      <th scope="col">Delete</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((s) => (
                      <tr key={s.id}>
                        <th scope="row">{formatDate(s.startedAt)}</th>
                        <td>{s.mode ?? "free"}</td>
                        <td>{s.notesPlayed}</td>
                        <td>{s.accuracy === null ? STATE_WORD[s.scoreState] : `${Math.round(s.accuracy * 1000) / 10}%`}</td>
                        <td>{s.speedPct === null ? STATE_WORD[s.scoreState] : `${s.speedPct}%`}</td>
                        <td>
                          {link?.token ? (
                            <Confirm
                              trigger="Delete"
                              confirm="Yes, delete this session"
                              what={`This deletes the session of ${formatDate(s.startedAt)} and all its note events from your server.`}
                              onConfirm={async () => {
                                const r = await deleteSession(link, s.id);
                                if (r.ok) {
                                  serverStore.remove(s.id);
                                  setNote("Deleted the session from your server.");
                                } else setNote(r.reason);
                              }}
                            />
                          ) : (
                            "Sign in to delete"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </div>
        );
      })}
    </section>
  );
}
