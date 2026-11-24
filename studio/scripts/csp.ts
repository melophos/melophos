// the content security policies, written once. the built page carries the policy in a meta tag and dist/_headers carries
// the same as a real header with the one directive a meta tag cannot set, frame-ancestors and a policy for the service
// worker file, which a meta tag never governs.
const common = ["default-src 'self'", "img-src 'self' data:", "font-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'none'"];

// the app: scripts from itself and the WebAssembly scoring module (wasm-unsafe-eval), its own worker and manifest, one style
// hash for what React Aria injects, style attributes for the slider thumb and connections to itself, to https servers and
// to a server on this machine, because a player's own server can be any of those
export const APP_POLICY = [
  ...common,
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "style-src 'self' 'sha256-38RhXrc7EdReTKsOm23ZPOCUgniTUUcjky8QOOrQx6o='",
  "style-src-attr 'unsafe-inline'",
  "connect-src 'self' https: http://localhost:* http://127.0.0.1:*",
].join("; ");

// the specimen page is only ever read, so it may connect to nothing
export const SPECIMEN_POLICY = [...common, "script-src 'self'", "style-src 'self'", "style-src-attr 'unsafe-inline'", "connect-src 'self'"].join("; ");

// the worker file only ever reads files from its own origin
export const WORKER_POLICY = ["default-src 'none'", "connect-src 'self'", "frame-ancestors 'none'"].join("; ");

export function headersFile(): string {
  return `# headers for the host. Cloudflare Pages and Netlify read this file as it is. any other host must send the same headers.
/*
  Content-Security-Policy: ${APP_POLICY}; frame-ancestors 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: midi=(self), camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()

/sw.js
  Content-Security-Policy: ${WORKER_POLICY}
  Cache-Control: no-cache
  Service-Worker-Allowed: /

/assets/*
  Cache-Control: public, max-age=31536000, immutable
`;
}
