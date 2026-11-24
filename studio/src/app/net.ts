// the rules for every call to a server the player typed in. that server is not trusted: an answer can be enormous or
// never finish, so every answer is read as a stream with a size cap, every call has a time limit and every list is cut.
export const limits = {
  // the whole call, including reading the answer
  timeoutMs: 10_000,
  // the largest answer the Studio will read
  maxBodyBytes: 2 * 1024 * 1024,
  // the most rows of a list of hubs or sessions that is read. a page of notes has its own, larger bound
  maxRows: 200,
};

export type Body<T> = { ok: true; value: T } | { ok: false; reason: string };

export const TIMED_OUT = "The server did not answer within 10 seconds.";

export function isTimeout(error: unknown): boolean {
  return error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError");
}

// reads and parses an answer without ever holding more than the cap
export async function readJson<T>(response: Response): Promise<Body<T>> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limits.maxBodyBytes) {
    void response.body?.cancel().catch(() => undefined);
    return { ok: false, reason: "The server's answer is far bigger than the Studio will read, so it was left unread." };
  }
  const reader = response.body?.getReader();
  if (!reader) return { ok: false, reason: "The server answered with something that is not JSON." };
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limits.maxBodyBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: "The server's answer is far bigger than the Studio will read, so it was left unread." };
      }
      chunks.push(value);
    }
  } catch (error) {
    return { ok: false, reason: isTimeout(error) ? TIMED_OUT : "The answer from the server was cut off." };
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(all)) as T };
  } catch {
    return { ok: false, reason: "The server answered with something that is not JSON." };
  }
}
