import { useMemo, type ReactNode } from "react";
import { describePiece, handsLabel } from "../../pieces";
import { useLibrary } from "../../pieces";
import { navigate, type Route } from "../router";
import { useSessions } from "../runtime";
import { EmptyState, Icon, Link, formatDate } from "../ui";
import { ImportPanel } from "./Import";

type Sort = "title" | "composer" | "length";

export function Library({ route }: { route: Route }): ReactNode {
  const q = route.query.get("q") ?? "";
  const sort = (["title", "composer", "length"] as const).find((s) => s === route.query.get("sort")) ?? "title";
  const { records } = useSessions();
  const lib = useLibrary();
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = lib.songs.map(describePiece).filter((p) => !needle || `${p.song.title} ${p.song.composer}`.toLowerCase().includes(needle));
    list.sort((a, b) => (sort === "length" ? a.bars - b.bars : (sort === "composer" ? a.song.composer : a.song.title).localeCompare(sort === "composer" ? b.song.composer : b.song.title, "en-GB")));
    return list;
  }, [q, sort, lib.songs]);
  const set = (next: { q?: string; sort?: Sort }): void => navigate(["library"], { q: next.q ?? q, sort: (next.sort ?? sort) === "title" ? null : (next.sort ?? sort) }, true);
  return (
    <>
      <h1>Library</h1>
      <form className="filters" role="search" onSubmit={(e) => e.preventDefault()}>
        <label>
          <span className="field-label field-with-icon">
            <Icon name="search" />
            Search
          </span>
          <input type="search" value={q} onChange={(e) => set({ q: e.target.value })} placeholder="Title or composer" autoComplete="off" />
        </label>
        <label>
          <span className="field-label">Sort by</span>
          <select value={sort} onChange={(e) => set({ sort: e.target.value as Sort })}>
            <option value="title">Title</option>
            <option value="composer">Composer</option>
            <option value="length">Length</option>
          </select>
        </label>
      </form>
      <p className="muted" role="status">
        {rows.length} {rows.length === 1 ? "piece" : "pieces"}
        {q ? ` match "${q}"` : ""}.
      </p>
      {rows.length === 0 ? (
        <EmptyState title="No pieces match" action={<button type="button" onClick={() => set({ q: "" })}>Clear the search</button>}>
          Try a shorter word or clear the search to see every piece.
        </EmptyState>
      ) : (
        <ul className="rows">
          {rows.map((p) => {
            const last = records.filter((r) => r.pieceId === p.song.id).at(-1);
            return (
              <li key={p.song.id}>
                <Link to={["piece", p.song.id]} className="row">
                  <span className="row-main">
                    <span className="row-title">{p.song.title}</span>
                    <span className="muted">
                      {p.song.composer}, {p.bars} {p.bars === 1 ? "bar" : "bars"}, {handsLabel(p.hands).toLowerCase()}, {p.song.tempo} beats a minute
                    </span>
                    <span className="muted">
                      {p.source}{p.song.imported ? ", hands are a first guess" : ""}. {last ? `Last practised ${formatDate(last.startedAt)}.` : "Not practised yet."}
                    </span>
                  </span>
                  <Icon name="back" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <ImportPanel />
    </>
  );
}
