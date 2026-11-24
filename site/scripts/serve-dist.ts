// serves out/ for the browser checks, on one port, with clean addresses and the 404 page. it exists because the
// framework's preview server refuses to start while another preview of any project is running on this machine.
// usage: node scripts/serve-dist.ts 23190
import { createReadStream, existsSync, realpathSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";

const port = Number(process.argv[2] ?? 23190);
if (!(port > 23000 && port < 65536)) {
  console.error("choose a port above 23000");
  process.exit(2);
}
// the real path of out/, so a symbolic link inside it cannot point the server at a file elsewhere
const root = realpathSync(resolve(process.cwd(), "out"));
const notFound = join(root, "404.html");
const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".xml": "application/xml", ".txt": "text/plain; charset=utf-8", ".json": "application/json" };

// the file a request names, null when there is none. the address is resolved against out/ and must stay inside
// it both before and after symbolic links are followed, so "..", an encoded "%2e%2e" or an absolute path cannot leave
function locate(url: string | undefined): string | null {
  let path: string;
  try {
    path = decodeURIComponent(new URL(url ?? "/", "http://localhost").pathname);
  } catch {
    return null;
  }
  if (path.includes("\0")) return null;
  if (path.endsWith("/")) path += "index.html";
  let file = resolve(root, `.${path}`);
  if (!file.startsWith(root + sep)) return null;
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!existsSync(file) || !statSync(file).isFile()) return null;
  const real = realpathSync(file);
  return real.startsWith(root + sep) ? real : null;
}

createServer((req, res) => {
  const file = locate(req.url);
  const found = file !== null;
  const target = file ?? notFound;
  res.writeHead(found ? 200 : 404, { "Content-Type": types[extname(target)] ?? "application/octet-stream" });
  createReadStream(target).pipe(res);
}).listen(port, "127.0.0.1", () => console.log(`serving dist on http://127.0.0.1:${port}/`));
