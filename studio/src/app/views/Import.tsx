// importing a MIDI file. the file is read here in the browser and nothing is uploaded. the player sees what was found, the
// split into hands is called a first guess and the file is only added once they choose to.
import { useRef, useState, type ReactNode } from "react";
import { cleanTitle, explanationFor, readImportFile, storedFromImport, titleFromFileName, type ImportResult } from "../../imports";
import { navigate } from "../router";
import { savePiece } from "../runtime";
import { Icon, formatDuration } from "../ui";

interface Found {
  bytes: Uint8Array;
  fileName: string;
  result: ImportResult;
}

export function ImportPanel(): ReactNode {
  const [state, setState] = useState<"idle" | "reading" | "rejected" | "found">("idle");
  const [reason, setReason] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const [title, setTitle] = useState("");
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const read = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setState("reading");
    setFound(null);
    const r = await readImportFile(file);
    if (!r.ok) {
      setReason(r.reason);
      setState("rejected");
      return;
    }
    setFound({ bytes: r.bytes, fileName: file.name, result: r.result });
    setTitle(titleFromFileName(file.name));
    setState("found");
  };

  const clean = cleanTitle(title);
  const add = async (): Promise<void> => {
    if (!found || !clean) return;
    const id = `import-${crypto.randomUUID()}`;
    await savePiece(storedFromImport(id, clean, found.fileName, found.bytes, found.result));
    navigate(["piece", id]);
  };

  const song = found?.result.song;
  const left = found?.result.guess.filter((h) => h === "left").length ?? 0;

  return (
    <section className="panel" aria-labelledby="import-title" data-testid="import">
      <h2 id="import-title">Import a MIDI file</h2>
      <p>Choose a MIDI file from your device. It is read here in your browser and nothing is uploaded. Only import music you have the right to use.</p>
      <div
        className="dropzone"
        data-over={over ? "true" : "false"}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void read(e.dataTransfer.files[0]);
        }}
      >
        <button type="button" onClick={() => input.current?.click()}>
          <Icon name="upload" />
          Choose a MIDI file
        </button>
        <span className="muted">or drop one here</span>
        <input ref={input} type="file" accept=".mid,.midi,.kar,audio/midi,audio/x-midi" hidden tabIndex={-1} data-testid="import-input" onChange={(e) => void read(e.target.files?.[0])} />
      </div>
      <div role="status" data-testid="import-status">
        {state === "reading" ? <p>Reading the file.</p> : null}
        {state === "rejected" ? (
          <p className="note" data-testid="import-rejected">
            <Icon name="warning" /> {reason}
          </p>
        ) : null}
      </div>
      {state === "found" && found && song ? (
        <div className="stack" data-testid="import-found">
          <h3>What was found</h3>
          <dl className="facts">
            <div>
              <dt>File</dt>
              <dd>{found.fileName}</dd>
            </div>
            <div>
              <dt>Notes</dt>
              <dd>{song.notes.length}</dd>
            </div>
            <div>
              <dt>Length</dt>
              <dd>{formatDuration(song.lengthMs)}</dd>
            </div>
            <div>
              <dt>Tempo at the start</dt>
              <dd>
                {song.startTempo} beats a minute{song.tempoChanges > 0 ? `, then ${song.tempoChanges} changes` : ""}
              </dd>
            </div>
            <div>
              <dt>Beats in a bar</dt>
              <dd>{song.beatsPerBar}</dd>
            </div>
            <div>
              <dt>Tracks</dt>
              <dd>{song.tracks.filter((t) => t.notes > 0).map((t) => `${t.name || `Track ${t.index + 1}`} (${t.notes} notes)`).join(", ")}</dd>
            </div>
            {song.skippedPercussion > 0 ? (
              <div>
                <dt>Left out</dt>
                <dd>{song.skippedPercussion} drum notes</dd>
              </div>
            ) : null}
          </dl>
          <div className="note">
            <p>
              <strong>The split into hands is a first guess.</strong> {explanationFor(found.result.method)} It put {left} notes in the left hand and {song.notes.length - left} in the right. Where the hands share the middle of the keyboard the guess is often wrong, so check it on the piece page before you rely on it. You can correct it there.
            </p>
          </div>
          <label className="stack-label">
            <span className="field-label">Name in your library</span>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} aria-invalid={clean === null} aria-describedby="title-help" />
            <span id="title-help" className={clean ? "muted" : "problem-text"}>
              {clean ? "Up to 120 characters." : "Give it a name of 1 to 120 characters."}
            </span>
          </label>
          <div className="actions">
            <button type="button" className="button-primary" disabled={!clean} onClick={() => void add()}>
              Add to my library
            </button>
            <button
              type="button"
              onClick={() => {
                setFound(null);
                setState("idle");
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
