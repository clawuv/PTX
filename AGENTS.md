# Repository engineering guidance

## Overview

Ptx (`package.json` name `ptx`) is an Electron desktop app that gives the Pi, OMP, and Prime Agent coding-agent harnesses one shared GUI on macOS, Linux, and Windows.

- `electron/main/` — privileged main process: IPC trust gate, per-harness adapters, session JSONL catalog, agent RPC, terminal (`node-pty`), in-app browser, git, schedules, voice, pets, plugins, persistence.
- `electron/preload/index.ts` — the single narrow preload API bridge.
- `src/` — sandboxed React renderer: `app/` workspace state, `components/` (incl. `transcript/`, `inspector/`), `pages/` (incl. `settings/`), `hooks/`, `lib/`, `types/`.
- `tests/` — `backend/` (main process), `frontend/`, `unit/`, `e2e/` (Playwright Electron), plus `fixtures/` and `helpers/`.
- `scripts/release/` — release, packaging, verification, and audit scripts; `biome.json` lives here too.
- `vendor/` — pinned npm archive and Prime Agent tarballs; security-sensitive, see below.
- `docs/` — design docs; read the matching one before changing that area.

## Commands

[`docs/validation.md`](docs/validation.md) is the source of truth for validation; `package.json` scripts are the authoritative definitions.

- `npm run typecheck` — all five tsconfig projects (node, web, tests, scripts, extensions).
- `npm run check` — Biome lint + format check (config at `scripts/release/biome.json`).
- `npm test` — Vitest; coverage thresholds are enforced per test family (`scripts/release/coverage-inventory.ts`).
- `npx vitest run tests/backend/foo.test.ts` — run one focused test file while developing.
- `npm run test:e2e` — build + hermetic Playwright Electron suite.
- `npm run build` — typecheck + production bundle; bundle-size budgets are enforced by release verification.

## Architecture boundaries

- Three-layer split: sandboxed React renderer (no Node integration, context-isolated) → frozen narrow preload API → privileged main process. Renderer code in `src/` must not import Node or main-process modules; everything crosses IPC.
- Renderer imports use the `@/*` alias for `src/*` (wired in the web/tests tsconfigs, electron-vite, and Vitest).
- Per-harness adapter pattern: transport, event, and UI machinery is shared; each harness (Prime, OMP, Pi) gets a thin adapter for protocol differences. Read [`docs/omp-integration.md`](docs/omp-integration.md) and [`docs/pi-integration.md`](docs/pi-integration.md) before touching harness integration; their protocol facts are verified against pinned CLI versions.
- Session JSONL transcripts are sensitive and read-only: never rewrite them.
- Project folders are explicit grants validated in the main process. Git/package/MCP mutations use fixed executables and argv arrays, never shell interpolation.
- Harness credentials belong to the harness; Ptx never reads or writes them (e.g. `~/.pi/agent/auth.json`).
- Native dependencies (`node-pty`, `zeromq`) and packaging are platform-specific: run packaging commands on the matching OS, and don't treat a simulated `platform: 'win32'` as a substitute for the real Windows state-migration CI job.

## Code style

Biome (`scripts/release/biome.json`): 2-space indent, single quotes, no semicolons, trailing commas, 200-char line width. TypeScript strict mode throughout.

## File size

Keep handwritten production files at or below 750 lines when practical. Treat 750 lines as a review threshold, not a reason to create arbitrary wrapper modules or split cohesive logic.

When changing an existing production file above the threshold, avoid increasing its size unless the change cannot be separated without weakening cohesion. Prefer extracting a complete responsibility with a narrow interface, and explain any intentional exception in the pull request.

This threshold does not apply to tests, generated files, vendored code, lockfiles, fixtures, or data assets. Correctness, security boundaries, and maintainable ownership take precedence over line count.

## Security-sensitive changes

Read [`docs/security.md`](docs/security.md) before touching IPC trust, path/grant validation, browser guests, voice, MCP admission, or persistence. Changes to `vendor/`, the `prime-agent` lockfile entries, `scripts/release/dependency-pins.json`, or `scripts/release/audit-exceptions.json` are security-sensitive upgrades: the tarballs, `package.json`/`package-lock.json`, and the pin file must change together in one reviewed commit.

## Cloud Agent environment

Cloud Agents provision this repo with [`.cursor/environment.json`](.cursor/environment.json),
whose `install` step runs [`.cursor/install.sh`](.cursor/install.sh) on Cursor's
default Ubuntu image. That script pins Node via `.nvmrc` (24.15.0) with `nvm`,
installs the Electron/xvfb system libraries, bootstraps the repo-pinned npm, and
runs `npm ci`. Canonical toolchain and check commands live in
[`docs/validation.md`](docs/validation.md); do not restate versions here.

`node`/`npm` come from `nvm`. A harness shell can be shadowed by another `node`
on `PATH`, so select the pinned toolchain before running `node`/`npm` if `node
-v` is not `v24.15.0`:

```
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use >/dev/null
```

Ptx is a GUI Electron app with no background services, so there is nothing to
auto-start. To run the app or the Playwright Electron e2e suite headlessly, wrap
the command with a virtual display:

```
xvfb-run -a npm run dev              # launch the desktop app
xvfb-run -a npm run test:e2e:hermetic # build + hermetic Electron e2e
```

Some xterm/PTY-driven e2e cases in `tests/e2e/app.spec.ts` are timing-sensitive
under headless `xvfb` and can fail where they pass on the macOS CI runner that
owns the `hermetic-e2e` gate.

## pstack

This repository vendors [pstack](https://github.com/cursor/plugins/tree/main/pstack) under `.agents/skills/pstack/` so Cloud Agents can run `/poteto-mode` and the rest of the skill set. Subagents live in `.cursor/agents/`. Per-role model overrides live in `.cursor/rules/pstack-models.mdc`.

pstack skills read `~/.cursor/rules/pstack-models.mdc`. Cloud Agents do not inherit that user-level path. If it is missing, copy the workspace rule before running a pstack skill:

```
mkdir -p ~/.cursor/rules
cp .cursor/rules/pstack-models.mdc ~/.cursor/rules/pstack-models.mdc
```

Re-run `/setup-pstack` to change role models. Only write Task `model` slugs that are available in the current session.
