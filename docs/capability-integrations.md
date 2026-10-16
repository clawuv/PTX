# Packages, extensions, skills, and MCP

Ptx presents one capability directory for OMP and Pi, but it
must not pretend that the two harnesses install or authenticate capabilities
the same way. This document defines the product contract for that surface.

## Shared vocabulary

- A **package** is a distribution container. Pi packages can
  contain extensions, skills, prompts, and themes.
- An **extension** is executable JavaScript or TypeScript loaded into the agent
  host. Installing an extension means installing its package or placing its
  file in a harness-native extension directory.
- A **skill** is model-facing guidance.
- An **MCP server** is a connection definition. It is not itself a package,
  extension, or skill, although a package may provide one or more of those
  resources and may declare MCP servers.
- An OMP **plugin** is an OMP-native bundle that can provide skills, commands,
  agents, hooks, tools, MCP servers, LSP servers, and extension modules.

## Harness contracts

| Harness | Installable bundle | Standalone extension | MCP runtime | MCP actions available in Ptx | Network MCP and authentication |
| --- | --- | --- | --- | --- | --- |
| OMP | `omp plugin install <target> --json` | Copy one local module into user `~/.omp/agent/extensions/` or project `.omp/extensions/` | Native | Create, enable, disable, or remove local stdio definitions in user `~/.omp/agent/mcp.json` or project `.omp/mcp.json` | Configure HTTP/SSE and authenticate directly in OMP, outside Ptx |
| Pi | `pi install <source>` | Local file through `pi install`; `-l` for project scope | `pi-mcp-adapter` extension package | With the adapter enabled, create/enable/disable local stdio definitions; bounded definition removal remains available for cleanup | Configure HTTP/SSE and authenticate through the adapter outside Ptx |

The app labels this surface **Capabilities** for every harness. Its Add button
first opens a capability-type chooser, then a type-specific form: **Add MCP**,
**Add Plugin** (OMP) or **Add Package** (Pi), and **Add Extension**. Pi's
MCP choice remains visible but disabled for Pi until
its **Pi MCP Adapter** toggle is enabled. OMP and adapter-enabled Pi offer only
local stdio input fields. The initial Add chooser warns that third-party code may use CLI-only
APIs and links directly to Ptx's GitHub issue form for failures; the base
Capabilities screen and the follow-up forms do not repeat that notice.

## Product behavior

### OMP

OMP has native MCP support. Ptx writes only local stdio entries to
OMP-native MCP files and installs plugins only through `omp plugin`. It rejects
HTTP, SSE, and any URL-bearing definition, including loopback URLs, and never
forwards `/mcp reauth` from a Ptx prompt. Network configuration and
authentication must be run directly in OMP outside the app. Externally configured network entries remain visible but are
read-only in Ptx; bounded definition-only removal remains available for cleanup.
Local definitions whose exact harness key cannot pass Ptx's bounded state
API remain visible but have no Enable or Disable control; their state must be
managed directly in OMP. Bounded exact-definition removal remains available.

OMP marketplace targets use `name@marketplace`. Repository and local targets
remain accepted where the OMP CLI accepts them.

### Pi

Pi core has no MCP client. Ptx shows **Pi MCP Adapter** as a real
toggle whose state is derived from Pi's installed packages. Enabling it runs
`pi install npm:pi-mcp-adapter`; disabling preserves the installed package and
records its Pi package filters as disabled. Disabling does not delete MCP definitions or credentials, so a
later re-enable restores the connections without silently losing user data.

Only while the adapter is enabled may Ptx create or change local stdio
entries in its supported `mcp.json` schema; definition-only removal remains
available while disabled. It rejects HTTP, SSE, and any URL-bearing
definition, including loopback URLs, and never launches `/mcp-auth`. Network
configuration and authentication must be run through the adapter outside
Ptx; Ptx does not forward `/mcp-auth` prompts.
Externally configured network entries remain visible but are read-only in the
app; bounded definition-only removal remains available for cleanup.
Only the canonical `npm:pi-mcp-adapter` source (optionally followed by an exact
semantic version) satisfies this prerequisite. Scoped, Git, local-path, and
same-name package sources do not authorize MCP writes.
Adapter-enabled local definitions with keys outside Ptx's bounded state
API remain visible but non-actionable, with direct-harness management detail.

## Security boundaries

- Every install/remove command uses the detected fixed harness executable and
  an argv array; no shell interpolation is permitted.
- Package, plugin, server, command, and argument inputs are bounded and
  validated in the main process.
- Standalone extensions must be absolute local JavaScript or TypeScript files.
  Project installs are re-authorized and their destination directories remain
  pinned against symlink replacement; existing OMP extension files are never
  overwritten.
- Network MCP definitions fail closed at the service admission and settings
  writer boundaries. State mutation also rejects externally configured network
  entries. The local stdio settings path uses Ptx's cooperative lock,
  fingerprint-based conflict retries, project-directory pinning, atomic
  replacement, and rollback protections; definition removal re-verifies the
  project directory immediately before and after reading each update snapshot.
  This is not a filesystem compare-and-swap: a same-user writer that ignores the
  lock can replace the file after the final fingerprint check and race Ptx's
  rename, so that writer's update may be overwritten.
- The main-process RPC manager rejects harness authentication commands for
  prompt, steer, follow-up, and heartbeat delivery, including every resume
  request regardless of the heartbeat status observed. Scheduled prompts are
  checked at create, update, resume, and run-now admission before project
  validation or queuing; startup blocks forbidden persisted active schedules
  before missed-run recovery and timer arming, while paused records remain
  available for cleanup and are checked if resumed. The executor repeats the
  check as defense in depth. Session-daemon follow-up, voice task launch,
  collaboration creation, and peer delivery preflight the same shared policy
  before queuing, wake-up, delivery, or runtime start.
- MCP rows use an independent 2,500-definition-per-settings-file discovery
  budget. Unrelated catalog records cannot consume it, and exceeding it emits
  an explicit scope-and-path warning.
- Pi adapter transitions and non-removal MCP writes share an agent-level
  admission lock across service instances. Adapter state is re-checked while
  that lock is held, immediately before the settings mutation.
- Ptx never requests or mutates credentials in Pi auth storage or OMP's `agent.db`. Definition removal does not inspect or change authorization.
- Ptx does not claim to prevent a harness from loading network MCP entries
  configured outside the app. Its guarantee is narrower: Ptx does not
  create, enable, disable, mutate, or authenticate those entries.
