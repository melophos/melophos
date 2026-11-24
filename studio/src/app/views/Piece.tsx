import type { ReactNode } from "react";
import { noteLabel } from "../../notes";
import { describePiece, handsLabel, storedPiece, useLibrary } from "../../pieces";
import { useSettings } from "../settings";
import { useSessions } from "../runtime";
import { ButtonLink, EmptyState, Icon, Link, formatDateTime, formatDuration } from "../ui";
import { MODES } from "../types";
import { HandEditor } from "./HandEditor";
import { ServerPiece } from "./ServerPiece";
import { BestsFor } from "./Bests";
import { useBests } from "../runtime";
import { removePiece } from "../runtime";
import { navigate } from "../router";

export function Piece({ id }: { id: string }): ReactNode {
  const lib = useLibrary();
  // hooks come before any early return, so their order never changes
  const { bests } = useBests();
  const song = lib.songs.find((s) => s.id === id);
  const { records } = useSessions();
  const settings = useSettings();
  if (!song) {
    return !lib.ready ? (
      <p className="muted">Loading the library.</p>
    ) : (
      <EmptyState title="That piece is not in the library" action={<ButtonLink to={["library"]}>Back to the library</ButtonLink>}>
        The address names a piece this Studio does not have.
      </EmptyState>
    );
  }
  const info = describePiece(song);
  const names = { naming: settings.naming, octave: settings.octave, accidental: settings.accidental, key: song.key };
  const stored = storedPiece(id);
  const mine = bests.filter((b) => b.songId === id);
  const past = records.filter((r) => r.pieceId === id).reverse();
  return (
    <>
      <p>
        <Link to={["library"]} className="back">
          <Icon name="back" />
          Library
        </Link>
      </p>
      <h1>{song.title}</h1>
      <dl className="facts">
        <div>
          <dt>Composer</dt>
          <dd>{song.composer}</dd>
        </div>
        <div>
          <dt>Written tempo</dt>
          <dd>{song.tempo} beats a minute</dd>
        </div>
        <div>
          <dt>Length</dt>
          <dd>
            {info.bars} {info.bars === 1 ? "bar" : "bars"}, {info.notes} {info.notes === 1 ? "note" : "notes"}
          </dd>
        </div>
        <div>
          <dt>Hands</dt>
          <dd>{handsLabel(info.hands)}</dd>
        </div>
        <div>
          <dt>Keys used</dt>
          <dd>
            {noteLabel(info.lowest, names)} to {noteLabel(info.highest, names)}
          </dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{info.source}</dd>
        </div>
      </dl>
      <section className="panel" aria-labelledby="practise">
        <h2 id="practise">Practise</h2>
        <div className="actions">
          {MODES.map((m, i) => (
            <ButtonLink key={m.value} to={["practise", id]} query={{ mode: m.value }} primary={i === 0}>
              {m.label} mode
            </ButtonLink>
          ))}
        </div>
        <p className="muted">Melody waits for you. Rhythm holds the tempo. Listen plays the piece with the lights. Hand, speed and bars are set on the next screen.</p>
      </section>
      <section className="panel" aria-labelledby="game" data-testid="game-panel">
        <h2 id="game">Rhythm game</h2>
        <p>Play the piece once through with the notes falling to the keys. The scoring engine counts what you play and your best for this song is kept for each speed and hand. Nothing starts until you press Start and you can pause whenever you like.</p>
        <div className="actions">
          <ButtonLink to={["game", id]} primary>
            <Icon name="play" />
            Play the rhythm game
          </ButtonLink>
        </div>
        {mine.length > 0 ? (
          <>
            <h3>Your bests for this piece</h3>
            <BestsFor bests={mine} />
          </>
        ) : (
          <p className="muted">No best yet for this piece.</p>
        )}
      </section>
      {stored ? <HandEditor key={stored.id} piece={stored} /> : null}
      {stored ? <ServerPiece piece={stored} /> : null}
      {stored ? (
        <section className="panel" data-kind="danger" aria-labelledby="remove">
          <h2 id="remove">Remove this piece</h2>
          <p>This removes the piece and the corrections you made from this browser. Your practice record for it stays.</p>
          <button type="button" className="button-destructive" onClick={() => void removePiece(stored.id).then(() => navigate(["library"]))}>
            Remove {song.title}
          </button>
        </section>
      ) : null}
      <section aria-labelledby="past">
        <h2 id="past">Past sessions</h2>
        {past.length === 0 ? (
          <p>No sessions yet. Your practice on this piece will be listed here.</p>
        ) : (
          <ul className="rows">
            {past.map((r) => (
              <li key={r.id}>
                <div className="row">
                  <span className="row-main">
                    <span className="row-title">{formatDateTime(r.startedAt)}</span>
                    <span className="muted">
                      {MODES.find((m) => m.value === r.mode)?.label} mode, {r.firstTime} of {r.total} notes right first time, {r.speedPct}% speed, {formatDuration(r.durationMs)}
                    </span>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
