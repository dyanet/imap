# CLAUDE.md: @dyanet/imap notes for agents and maintainers

Zero-dependency TypeScript IMAP client (drop-in for imap-simple / imap). Node ≥22.

## Releasing

Releases are cut by **merging a version bump**, never by hand-publishing.

1. In a PR, bump `version` in `package.json` and update the changelog/README if user-facing.
2. Merge to `main` (or to a `release/**` maintenance branch). The release job in `.github/workflows/ci.yml` then:
   - skips if this version has already been released (the git tag `v<version>` exists);
   - publishes to **GitHub Packages** with the same dist-tag;
   - **stages** the version on **npmjs** with `npm stage publish --provenance`, authenticated by **npm Trusted Publishing (OIDC)**. No `NPM_TOKEN` is used.
   - pushes the tag `v<version>` (this is what stops a re-stage on later pushes).
3. A maintainer **approves** the staged version on npmjs.com → **Staged Packages** → Approve (2FA), or `npm stage approve <stage-id>` (IDs: `npm stage list`, or the job log). Nothing is live on npm until then.

Details:
- **Trusted publisher** (npmjs.com → package → Settings → Trusted publishing → GitHub Actions): org `dyanet`, repo `imap`, workflow `ci.yml`, environment blank. It allows **staging only**. A plain `npm publish` from CI fails with `403 OIDC permission denied for this action`, so keep `npm stage publish`.
- **dist-tags:** `latest` only when the version is newer than npmjs's current `latest`; an older line (e.g. a 2.x fix after 3.0.0) is staged as `v<major>`, so approving it can't move `latest` backwards. To fix a tag by hand: `npm dist-tag add <pkg>@<version> latest`.
- `npm stage` needs a current npm, so the job runs `npm install -g npm@latest`. `npm stage list` needs a logged-in user, so CI can't use it; the git tag is the only "already staged" marker.
- Automated sessions (Claude Code on the web) **cannot push tags or create GitHub releases** (403). That is why releasing is merge-driven. Branches can be pushed.
- The npmjs.com package page caches dist-tags; check with `npm view <pkg> dist-tags`.

## Monthly security pass

- **Find advisories with `npm audit`** (plus `npm audit --omit=dev` for what ships). The Claude GitHub App cannot read the Dependabot alerts API (403).
- **Update to the latest compatible version**: `npm update` within ranges first, then raise ranges where needed. Dev tooling may move majors only if `engines.node` still holds (check the tool's own `engines`). Runtime dependencies stay within the declared `engines` and peer ranges unless a breaking release is intended.
- Supersede open Dependabot PRs with one PR, and close them with a comment naming the replacing PR.
- **Majors are deliberate.** `.github/dependabot.yml` ignores `semver-major` version updates (security updates still arrive). Evaluate majors during this pass.
- Run build, lint and tests, and **add tests** for the least-covered code. Prefer tests that exercise real integration points (packed tarballs, real sockets, the real base class) over pure mocks; that is how this pass found real bugs. Confirm a regression test fails on the old code.
- Bump the version, merge, and let the release job stage it (see Releasing).
- Record the pass in the "Monthly sec updates" project notes.

## CI conventions

- The Node matrix covers every line allowed by `engines.node` (up to Current), with `fail-fast: false`.
- `npm audit --omit=dev --audit-level=high` gates CI on one matrix leg.
- `concurrency` cancels superseded CI runs. Publishing never runs concurrently and is never cancelled.
- Action versions: `actions/checkout@v7`, `actions/setup-node@v7`.

## Repo notes

- **Parser shapes:** `parseUntaggedResponse` returns `{ number, extra }` for `* N EXISTS|EXPUNGE|RECENT` and `{ seqno, attributes: { UID, FLAGS, … } }` for FETCH. Anything consuming untagged responses (e.g. `parseIdleNotification`) must use those shapes. A mismatch once made every IDLE count `NaN`.
- `tests/unit/client-e2e.test.ts` drives the real client over a loopback socket against a scripted IMAP server. Extend it for protocol-level changes rather than only feeding strings to parsers. The client sends atoms unquoted, so match commands with optional quotes.
- **fast-check stays on 3.x**: 4.x removes `stringOf` and other APIs used across `tests/property/`.
- Examples (`examples/gmail-viewer`, `examples/imap-demo`) have their own lockfiles; audit and update them too. `ci.yml` ignores `examples/**`; the demo deploys via `deploy-imap-demo.yml`.
- Coverage badge: `npm run coverage:badge`, committed by hand.

## Working-copy gotchas

- Some files are committed with **CRLF** line endings. Preserve each file's existing endings when editing (Python `open()` silently converts CRLF to LF; use `newline=''`).
- The maintainer's local checkouts are on Windows (`C:\work\dyanet\…`) and show whole-file CRLF/LF diffs. Don't run git inside the linked-folder mount from a remote session: it can't delete lock files and leaves `.git/index.lock` behind.
- Shallow single-branch clones need `git config remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*'` before other branches can be fetched or tracked.
