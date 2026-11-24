// the imported piece on the player's own server: send it, check how far the server has got and send the corrected split.
// it only appears when a server is linked in Settings. the server's split is the same first guess the Studio made, so
// only the player's corrections need to travel. nothing here has run against a real server.
import { useState, type ReactNode } from "react";
import { effectiveHands } from "../../hands";
import { guessOf } from "../../imports";
import { Link } from "../ui";
import { diffHands, getSong, putHands, resetHands, songNotes, uploadSong, type ServerSong } from "../server";
import type { StoredPiece } from "../store";
import { savePiece } from "../runtime";
import { signedIn, useLink } from "../serverLink";

const STATE_WORD: Record<ServerSong["importState"], string> = {
  queued: "The server has the file and has not started reading it.",
  running: "The server is reading the file.",
  ready: "The server has read the file.",
  failed: "The server could not read the file.",
};

export function ServerPiece({ piece }: { piece: StoredPiece }): ReactNode {
  const link = useLink();
  const [song, setSong] = useState<ServerSong | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  if (!link) return null;

  const run = async (work: () => Promise<void>): Promise<void> => {
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  };

  const send = (): Promise<void> =>
    run(async () => {
      if (!piece.file) {
        setMessage("The original file is no longer kept with this piece, so it cannot be sent.");
        return;
      }
      const r = await uploadSong(link, piece.title, piece.file);
      if (!r.ok) return setMessage(r.reason);
      await savePiece({ ...piece, serverId: r.value.id });
      setSong(r.value);
      setMessage("Sent. The server reads the file in the background, so check on it in a moment.");
    });

  const refresh = (): Promise<void> =>
    run(async () => {
      if (!piece.serverId) return;
      const r = await getSong(link, piece.serverId);
      if (!r.ok) return setMessage(r.reason);
      setSong(r.value);
      setMessage("");
    });

  const sendCorrections = (): Promise<void> =>
    run(async () => {
      if (!piece.serverId) return;
      const notes = await songNotes(link, piece.serverId);
      if (!notes.ok) return setMessage(notes.reason);
      const hands = effectiveHands(guessOf(piece), piece.corrections);
      const diff = diffHands(notes.value, piece.notes.map(([, , note], i) => ({ note, hand: hands[i] ?? "right" })));
      if (!diff.ok) return setMessage(diff.reason);
      if (diff.changes.length === 0) return setMessage("The server's hands already match yours. There was nothing to send.");
      const r = await putHands(link, piece.serverId, diff.changes);
      if (!r.ok) return setMessage(r.reason);
      setSong(r.value);
      setMessage(`Sent ${diff.changes.length} ${diff.changes.length === 1 ? "change" : "changes"}. The server's split is now marked as corrected by you.`);
    });

  const reset = (): Promise<void> =>
    run(async () => {
      if (!piece.serverId) return;
      const r = await resetHands(link, piece.serverId);
      if (!r.ok) return setMessage(r.reason);
      setSong(r.value);
      setMessage("The server's split is back to its first guess. Your corrections here are unchanged.");
    });

  return (
    <section className="panel" aria-labelledby="server-piece" data-testid="server-piece">
      <h2 id="server-piece">On your own server</h2>
      {!signedIn(link) ? (
        <p>
          You need to be signed in to send this piece. <Link to={["settings", "server"]}>Sign in to your server</Link>
        </p>
      ) : piece.serverId ? (
        <>
          <p>This piece is on your server{song ? `. ${STATE_WORD[song.importState]}${song.importError ? ` ${song.importError}` : ""}` : "."}</p>
          {song ? (
            <p className="muted">
              {song.noteCount === null ? "" : `${song.noteCount} notes. `}
              The server&apos;s split {song.handsEdited ? "has your corrections" : "is its own first guess"}.
            </p>
          ) : null}
          <div className="actions">
            <button type="button" onClick={() => void refresh()} disabled={busy}>
              Check on the server
            </button>
            <button type="button" onClick={() => void sendCorrections()} disabled={busy || song?.importState !== "ready"}>
              Send my corrected hands
            </button>
            <button type="button" onClick={() => void reset()} disabled={busy || song?.importState !== "ready"}>
              Put the server&apos;s hands back to its guess
            </button>
          </div>
        </>
      ) : (
        <>
          <p>Send the original file to your server. It is uploaded to the address you set in Settings and nowhere else.</p>
          <button type="button" onClick={() => void send()} disabled={busy}>
            Send this piece to my server
          </button>
        </>
      )}
      <p role="status" data-testid="server-piece-message">
        {message}
      </p>
    </section>
  );
}
