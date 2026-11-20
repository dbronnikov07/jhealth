import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// Content-Security-Policy: the browser may only run scripts and load models, fonts, media and data from our own
// origin. 'unsafe-inline' scripts are needed by Next.js's streaming without nonces; React escapes all text and no
// page renders raw HTML, so the remaining risk is small. 'wasm-unsafe-eval' lets MediaPipe compile its WebAssembly.
// Development adds 'unsafe-eval' and websockets for hot reload.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob:",
  // http://127.0.0.1:8799 is the optional fast voice helper on the demo laptop (npm run voice:fast); browsers treat
  // the loopback address as trustworthy, and nothing else on the machine is reachable from the page.
  // https://*.trycloudflare.com is the same helper reached through its tunnel, so phones can use it too; the page
  // only ever gets that address from our own server (api/voice-helper), and the helper only answers signed requests.
  `connect-src 'self' http://127.0.0.1:8799 https://*.trycloudflare.com${isDev ? " ws: wss:" : ""}`,
  "worker-src 'self' blob:",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },                       // older browsers: never inside another site
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), browsing-topics=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
];

const nextConfig: NextConfig = {
  // PGlite (local Postgres) and the Postgres driver run as plain Node packages, not bundled.
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],
  // This folder is the project root (there is an unrelated package-lock.json in the home folder).
  turbopack: { root: __dirname },
  poweredByHeader: false,                                            // do not advertise the framework
  // Development only: the voice functions (api/tts.py, api/stt.py) are Python and run on Vercel. Locally,
  // `npm run voice:dev` serves them on port 8799 and these two addresses are passed through to it.
  async rewrites() {
    return isDev
      ? [
          { source: "/api/tts", destination: "http://127.0.0.1:8799/api/tts" },
          { source: "/api/stt", destination: "http://127.0.0.1:8799/api/stt" },
        ]
      : [];
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // The patient's link is the key to their page: never send it to another site, never let search engines in.
      { source: "/s/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "X-Robots-Tag", value: "noindex, nofollow" }] },
      { source: "/doctor/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
    ];
  },
};

export default nextConfig;
