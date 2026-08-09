#!/usr/bin/env node
/**
 * Assembles the Cloudflare-deployed demo into `dist/`.
 *
 * Unlike a pure-ESM package, @dyanet/imap compiles to CommonJS, which a
 * browser cannot load from a <script type="module">. So this bundles the
 * library's MIME entry point straight from TypeScript source with esbuild.
 *
 * Only `src/mime/index.ts` is bundled -- deliberately, not the package
 * root. The root pulls in the IMAP client, which opens TCP sockets via
 * `net`/`tls` and has no meaning in a browser. The MIME and encoding
 * modules are pure string/byte manipulation and are the part of this
 * library that a static page can honestly demonstrate.
 */

import { build } from "esbuild";
import { cp, rm, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const out = path.join(here, "dist");

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const result = await build({
  entryPoints: [path.join(repoRoot, "src", "mime", "index.ts")],
  outfile: path.join(out, "mime.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  // `Buffer` is a Node global the MIME/encoding modules reach for. Inject
  // a small platform-API-backed stand-in rather than a full polyfill.
  inject: [path.join(here, "buffer-shim.js")],
  define: { "process.env.NODE_ENV": '"production"' },
  metafile: true,
  logLevel: "info",
});

await cp(path.join(here, "index.html"), path.join(out, "index.html"));

const bytes = Object.values(result.metafile.outputs)[0]?.bytes ?? 0;
console.log(`built dist/ (mime.js ~${(bytes / 1024).toFixed(1)} kB, plus index.html)`);
