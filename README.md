# Ptx

Ptx is a local AI development workspace for managing work across projects and reviewing results before accepting them. It runs on macOS, Linux, and Windows, with [Pi](https://pi.dev/) and [OMP](https://github.com/can1357/oh-my-pi) handling execution, models, logins, and saved sessions. Bring your own model account.

The new **Tasks** page is a free local preview: define goals and acceptance requirements, reuse templates, choose a project folder or worktree, and review actual session tools and current Git changes. Execution ending only makes a task ready for human review. See the [task workflow guide](docs/task-workflow.md) and [commercial validation playbook](docs/business/validation-playbook.md). No paid checkout is live; existing features remain free and the repository retains its MIT license.

<img width="2234" height="1332" alt="Ptx desktop workspace" src="https://github.com/user-attachments/assets/864ff0e1-71cc-49da-955f-f226710ef890" />

## Two harnesses, one workspace

Use the switcher in the top-left corner to move between Pi Work and OMP Work. Ptx detects the harnesses installed on your computer and shows the ones that are ready. You can refresh detection or set a custom executable path in Settings.

Each harness keeps its own projects, sessions, model list, provider visibility, and running work. Switching harnesses changes the workspace without stopping work already running in another one.

You only need one harness to get started:

- [Pi](https://pi.dev/) is the base coding-agent harness in the Pi family.
- [OMP](https://github.com/can1357/oh-my-pi) adds its own plugins, commands, and approval controls.

## What you can do

### Work with agents

- Stream conversations with Markdown, reasoning summaries, tool activity, retries, and context compaction.
- Choose a model, reasoning level, and Fast mode when the selected model supports it.
- Queue a follow-up or steer an agent while it is working.
- Paste or drop PNG, JPEG, GIF, and WebP images into a prompt when the model supports vision.
- Resume, rename, search, and archive persistent sessions.
- See running, finished, failed, and waiting-for-input work in one Activity view, then clear items you have handled.

### Keep projects organized

- Add local folders and reopen sessions grouped by project.
- Search projects, chats, and branches from the sidebar.
- Switch between linked Git worktrees from the composer.
- Create a branch worktree and open it as a new Ptx workspace.
- Mention another top-level session with `@session`, copy its UUID, or let agents create and message model-selected sessions for parallel work.

### Use the built-in coding workspace

- Review Git status and diffs, stage or unstage files, restore changes with confirmation, and commit without leaving the app.
- Browse project files and reveal them in your system file manager.
- Open multiple terminal tabs for a session. Highlight terminal output to attach it to the next prompt.
- Open the right-hand Summary, Changes, Browser, or Files panel whenever you need it.

### Browse with shared context

- Use an isolated in-app browser with an address bar, navigation history, downloads, and an external-browser handoff.
- Point at page elements and add notes. Ptx attaches those annotations to your next message.
- Enable browser control so an agent can open and operate its own tabs. You can watch its cursor and work in the same tabs when you want to take over.

### Automate repeat work

- Create one-time or recurring schedules for the active harness.
- Pick the project or existing session, model, reasoning level, timezone, and Fast mode.
- Run a schedule immediately, pause or resume it, and inspect the result and run history.
- On macOS, opt in under **Settings → General** to keep scheduled work running from the menu bar after closing the window, and optionally launch Ptx in the background at login. The packaged app also accepts `--background` to start without opening its window.

### Add capabilities

The Capabilities page brings together packages, plugins, extensions, skills, prompts, and MCP servers. Ptx can manage local stdio MCP definitions for OMP and adapter-enabled Pi. Network MCP and authentication stay under the selected harness's direct control; those entries are visible but read-only in Ptx, with bounded definition-only removal available for cleanup. MCP discovery has an independent 2,500-definition-per-settings-file limit and reports an explicit warning when that limit is exceeded, so unrelated capabilities cannot hide supported MCP rows.

Ptx does not keep its own MCP configuration. It reads and writes the definition files each harness already owns:

| Harness | Global definitions | Project definitions |
|---|---|---|
| OMP | `~/.omp/agent/mcp.json` | `<project>/.omp/mcp.json` |
| Pi | `~/.pi/agent/mcp.json` | `<project>/.pi/mcp.json` |

Pi has no native MCP support. Its definitions load through the third-party `pi-mcp-adapter` extension, so enable that adapter from the Capabilities page (or run `pi install npm:pi-mcp-adapter`) before a stdio entry will take effect. Definitions are read when a session starts, so open a new session after changing them.

A stdio definition uses the standard schema, and the `command`/`args` must point at an executable that exists on your machine:

```json
{
  "mcpServers": {
    "example": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/server.mjs"]
    }
  }
}
```

Ptx manages local stdio entries only. HTTP and SSE definitions stay with the harness, and Ptx never reads or writes MCP credentials or authorization state.

Ptx also ships optional capabilities for:

- Let an agent ask you a small set of questions in a native dialog.
- Give agents controlled access to the in-app browser.
- Use TryCUA computer control when the separate CUA Driver is installed.

Ask User and computer control are off by default. You can enable, disable, or remove capabilities from the app.

### Talk instead of type

- Dictate prompts with OpenAI, Groq, Deepgram, or a local `whisper.cpp` installation.
- Open the realtime voice companion to search, discuss work, and start a task in the currently selected harness.
- Choose an animated desktop pet that reacts while an agent works and carries the realtime voice controls. Ptx includes the Orb and Ptx pets and can discover compatible Codex pets.

### Make it comfortable

- Choose a light, dark, or system theme and adjust the interface text size.
- Reduce motion, resize the workspace panels, or let them become overlays in a narrow window.
- Use keyboard navigation and the command palette for common actions.

## Get started

1. Install Pi, OMP, Prime Agent, or any combination of the three.
2. Sign in or configure a model provider through each harness's own CLI.
3. Download Ptx from [GitHub Releases](https://github.com/clawuv/PTX/releases), or run it from source.
4. Add a project folder and start a session.

Ptx checks common install locations automatically. If a harness is missing, open **Settings → Harness** to refresh detection or choose its executable.

GitHub Releases provides a DMG and ZIP for macOS, common Linux package formats plus AppImage, and a Windows installer and ZIP.

Harness provider credentials stay with the harness. Optional voice keys are encrypted with the operating system's secure storage, and local `whisper.cpp` dictation needs no API key.

## Star History

<a href="https://www.star-history.com/?repos=clawuv%2FPTX&type=date&legend=top-left">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=clawuv/PTX&type=date&theme=dark&legend=top-left" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=clawuv/PTX&type=date&legend=top-left" />
    <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=clawuv/PTX&type=date&legend=top-left" />
  </picture>
</a>

## Run from source

You will need Node.js 24.15.0 or newer and npm 12.0.2 or newer. The repository pins Node.js 24.15.0 in `.nvmrc` and both tool versions in `package.json` (`engines`, `packageManager`), so installs made with a different toolchain fail rather than producing a subtly different build; with [nvm](https://github.com/nvm-sh/nvm), you can select it with:

```bash
nvm install && nvm use
npm run toolchain:bootstrap
```

The bootstrap command verifies the exact size and SHA-512 of the checked-in npm archive, then installs it offline with install-time lifecycle scripts disabled into the invoked npm's configured global prefix, verifies the installed CLI and both tool versions against `package.json` and `.nvmrc`, and makes its shim available to subsequent GitHub Actions steps before dependencies are installed.

```bash
npm install
npm run dev
```

If `node_modules/electron/dist` is missing after installation, fetch Electron's platform binary before starting the app:

```bash
node node_modules/electron/install.js
npm run dev
```

`npm install --ignore-scripts` skips both Electron's platform download and the native dependency rebuild, so it is not enough on its own for running Ptx from source. If you used it, the recovery sequence below runs those two steps explicitly.

`node-pty` is a native dependency. If Electron cannot rebuild it with your default Python environment, point npm at a Python installation with the required build tools:

```bash
export npm_config_python=/path/to/python3
npm install --ignore-scripts
node node_modules/electron/install.js
npx electron-builder install-app-deps
```

## Keyboard shortcuts

Use `⌘` on macOS and `Ctrl` on Linux or Windows.

| Shortcut | Action |
|---|---|
| `⌘/Ctrl+N` | New session |
| `⌘/Ctrl+K` | Command palette |
| `⌘/Ctrl+B` | Toggle the project sidebar |
| `⌘/Ctrl+Shift+B` | Open the browser |
| `⌘/Ctrl+J` | Toggle the terminal |
| `⌘/Ctrl+,` | Open Settings |
| `Enter` | Queue a message while the agent is working |
| `⌘/Ctrl+Enter` | Steer the current turn while the agent is working |
| `Shift+Enter` | Add a new line |
| `Esc` | Close the active menu, dialog, or overlay |

The Queue and Steer shortcuts can be swapped in **Settings → Harness → Message shortcuts**.

## Local data and safety

Ptx is built around local projects and local harness sessions. It does not rewrite session history or take ownership of Pi, OMP, or Prime Agent credentials.

Remote pages open in a separate browser profile with Node access disabled. Project paths and desktop actions are checked in the main process, and third-party capabilities still run with your operating-system permissions. Review packages, commands, MCP servers, and projects before allowing them to act.

For suspected vulnerabilities, follow the [security policy](.github/SECURITY.md) and do not post sensitive details publicly. See [docs/security.md](docs/security.md) for the full technical security model.

## Development checks

Run these before submitting a code change:

```bash
npm run typecheck
npm run check
npm test
npm run test:e2e
npm run build
```

See the [validation guide](docs/validation.md) for the source-of-truth checks and reproducible commands.

To make an installable local QA build, run the command for your operating system:

```bash
npm run package:mac:local-qa
npm run package:linux:local-qa
npm run package:win:local-qa
```

Build packages on their target operating system so native dependencies match the release.

## License

Ptx is released under the permissive [MIT License](LICENSE). See the [license text](LICENSE) for details.
