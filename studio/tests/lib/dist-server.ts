// a small static server for the built app, whose worker file can change to stand in for a new build and which can serve
// a second origin that counts the requests it gets
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join } from "node:path";

const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };

export async function serveDist(): Promise<{ url: string; newBuild: () => void; close: () => Promise<void> }> {
  let next = false;
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    const file = join("dist", path === "/" ? "index.html" : path);
    if (!existsSync(file)) {
      res.statusCode = 404;
      res.end();
      return;
    }
    let body: Buffer | string = readFileSync(file);
    if (path === "/sw.js" && next) body = `${body.toString()}\n// next build`;
    res.setHeader("Content-Type", types[extname(file)] ?? "application/octet-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.end(body);
  });
  await listen(server);
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, newBuild: () => (next = true), close: () => stop(server) };
}

// another origin, with open CORS, that answers every request with a small JSON body and counts them
export async function serveOther(): Promise<{ url: string; hits: () => string[]; close: () => Promise<void> }> {
  const seen: string[] = [];
  const server = createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }
    seen.push(`${req.method} ${req.url} auth=${req.headers.authorization ?? "none"}`);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ items: [], next_cursor: null }));
  });
  await listen(server);
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, hits: () => seen, close: () => stop(server) };
}

const listen = (s: Server): Promise<void> => new Promise((r) => s.listen(0, "127.0.0.1", r));
const stop = (s: Server): Promise<void> => new Promise((r) => s.close(() => r()));
