# imap-demo

Static browser demo of `@dyanet/imap`'s MIME header parsing, deployed to
Cloudflare Workers: **https://imap-demo.dyanet.workers.dev**

Paste raw email headers and watch RFC 2822 unfolding, RFC 2047 encoded-word
decoding, and Content-Type parsing happen client-side.

## What it demonstrates, and what it deliberately doesn't

Only `src/mime` and `src/encoding` are bundled — not the package root.

The root pulls in the IMAP client itself, which opens TCP connections via
`net`/`tls`. That has no meaning in a browser, and pretending otherwise
would make the page a lie. The MIME and encoding modules are pure
string/byte manipulation, and they're the part of this library a static
page can honestly show working.

So this is **not** a browser port of the IMAP client, and it isn't the
`gmail-viewer` example either — that one is a real Express server with
OAuth and filesystem-backed sessions, and it deploys separately.

## Build

```bash
npm install
npm run build     # -> dist/ (mime.js + index.html)
```

`build.mjs` bundles `../../src/mime/index.ts` with esbuild, straight from
TypeScript. A bundler is needed here (unlike a pure-ESM package) because
`@dyanet/imap` compiles to CommonJS, which browsers can't load from a
`<script type="module">`.

### The Buffer shim

The MIME and encoding modules use Node's `Buffer` global — five operations
in total (`Buffer.from` with `base64`/`utf-8`/bytes, and `toString` with
`base64`/an encoding label). `buffer-shim.js` satisfies exactly those over
`atob`/`btoa` and `TextDecoder`, and esbuild injects it at build time.

It's about twenty lines. A full Buffer polyfill would have been an order of
magnitude larger than the library being demonstrated, which rather defeats
the point. The shim is demo scaffolding — it is not part of
`@dyanet/imap` and is not a general-purpose `Buffer`.

## Deploy

Automatic on push to `main` via
[`.github/workflows/deploy-imap-demo.yml`](../../.github/workflows/deploy-imap-demo.yml),
which runs the package's test suite first — the demo bundles library
source, so a change that breaks the parsers should stop the deploy.

Requires `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repo secrets;
without them the workflow builds and then skips the deploy with a notice
rather than failing.

By hand:

```bash
npm run deploy
```

## Why Workers and not Pages

Cloudflare publishes a one-way [migrate from Pages to Workers][migrate]
guide and has deprecated Workers Sites in favour of Workers Assets, so a
new Pages project would be starting on the wrong side of a migration.
`wrangler.jsonc` has no `main` field — assets-only, so requests are served
straight from the asset store with no Worker script and no per-request
compute.

[migrate]: https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/
