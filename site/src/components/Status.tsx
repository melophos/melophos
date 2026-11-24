import { STATUS_WORD, type Status as StatusKind } from "../data/status.ts";

// a status word with its own shape, so the status never rests on colour alone
export function Status({ status }: { status: StatusKind }) {
  return (
    <span className="status">
      <svg className="status-mark" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        {status === "built" && <circle className="fill line" cx="10" cy="10" r="8" />}
        {status === "host" && <rect className="fill line" x="3" y="3" width="14" height="14" />}
        {(status === "partly" || status === "progress") && (
          <>
            <path className="fill" d="M10 2a8 8 0 0 0 0 16z" />
            <circle className="line hollow" cx="10" cy="10" r="8" />
          </>
        )}
        {status === "design" && <rect className="line hollow dash" x="3" y="3" width="14" height="14" />}
        {status === "planned" && <circle className="line hollow" cx="10" cy="10" r="8" />}
        {status === "unchecked" && (
          <>
            <circle className="line hollow dash" cx="10" cy="10" r="8" />
            <circle className="fill" cx="10" cy="10" r="3" />
          </>
        )}
      </svg>
      <span>{STATUS_WORD[status]}</span>
    </span>
  );
}
