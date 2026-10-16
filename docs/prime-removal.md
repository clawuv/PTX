# Prime removal

Ptx supports Pi and OMP. Prime's runtime, adapter, model/authentication service,
daemon, heartbeat controls, bundled extensions and npm archives have been removed.
The dependency graph no longer includes `prime-agent`, `prime-agent-ai` or
`zeromq`. Pi and OMP credentials remain owned by their respective CLIs.

The renderer bridge is `window.ptx`; extension capability variables use `PTX_*`.
Shared browser and schedule skills now live under `assets/skills/ptx-*`.

## Existing installations

Before removing retired Prime settings, projects or schedules, the state store
writes an exact backup beside the source file with a `.removed-prime-<UUID>`
suffix. It persists the cleaned state so subsequent launches do not repeat the
migration. Prime and unscoped legacy project grants are not assigned to Pi or
OMP. Existing Pi/OMP records and archived session identifiers are retained.
Harness session JSONL files and credentials are not rewritten or deleted.

Some `prime-work` storage filenames, browser partitions and persisted browser
keys remain compatibility identifiers. Changing these would disconnect existing
user data; they do not load Prime code. The Pi/OMP integration documents retain
explicitly marked historical design comparisons.
The ask-user marker and historical session-mention parser also retain their old
spelling so saved transcripts remain readable.

## Verification

Dependency-removal guards live in `tests/release-scripts.test.ts`. State backup,
cleanup and repeat-launch behavior are covered by
`tests/backend/retired-harness-migration.test.ts`. Run the standard commands in
[validation.md](validation.md), plus these focused tests when changing migration
or packaging behavior.

The removal was checked with all five TypeScript projects, a production build,
Biome, focused backend/frontend tests and real Electron startup. The full test
suite was also attempted on Windows and still has failures, including process
launcher, symlink and platform-path assumptions; it is not reported as passing.
