<p align="center">
  <img src="brand/icon/masthead-icon-256.png" width="128" height="128" alt="Masthead icon">
</p>

<h1 align="center">Masthead</h1>

<p align="center">Your AI coding agents, at a glance.</p>

Masthead is a fast, local desktop app for Windows that watches your AI coding agent
sessions (Claude Code, Codex and more), so you always know which agent is working,
what it costs and where it's running. It has a liquid-glass interface and a small
notch that stays at the top of your screen.

> **Status: early development.** The session monitor works today; the notch, system
> tools and more agents are on the way. Expect breaking changes.

## Features

| | Status |
|---|---|
| Unified list of Claude Code and Codex sessions: title, project, model, state, tokens, context use | Available |
| Live updates while agents work; close-to-tray | Available |
| Liquid-glass UI rendered with WebGL, orange accent | Available |
| Pinned notch with a peek card and approve/deny for agent prompts | Planned |
| Cursor, Gemini CLI and other agents | Planned |
| System tools: processes, ports, dev servers, cleanup, health checks | Planned |

## Privacy

Masthead only **reads** the log files agents already keep on your machine
(`~/.claude/projects`, `~/.codex/sessions`). It never writes to them, never uploads
anything and has no telemetry or account.

## Supported agents

| Agent | Where Masthead reads | Notes |
|---|---|---|
| Claude Code | `~/.claude/projects/<project>/<session>.jsonl` | CLI and IDE extensions |
| Codex | `~/.codex/sessions/**/rollout-*.jsonl[.zst]` | Titles from `~/.codex/session_index.jsonl` |

## Build from source

Prerequisites (Windows 10 or 11):

- [Rust](https://rustup.rs) (stable)
- [Node.js](https://nodejs.org) 22 or newer and [pnpm](https://pnpm.io)
- Visual Studio Build Tools with **Desktop development with C++**
- Microsoft Edge WebView2 (preinstalled on Windows 11)

```bash
pnpm install
pnpm dev          # run the desktop app with hot reload
pnpm build        # produce an installer in target/release/bundle
```

Other useful commands:

```bash
pnpm dev:web                               # UI only, in a browser, with sample data
cargo test -p masthead-core                # adapter tests
cargo run -p masthead-core --example list  # print the sessions found on this machine
```

## Project layout

```
apps/desktop/         Tauri app: React + TypeScript UI (src/) and Rust shell (src-tauri/)
crates/masthead-core/ Session model and agent adapters, independent of the UI
brand/                App icon renders and the script that generates them
```

## Contributing

Contributions are welcome, especially adapters for more agents. See
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)

Agent logos come from [Lobe Icons](https://github.com/lobehub/lobe-icons) (MIT). Claude,
Claude Code, Codex and other product names and logos are trademarks of their owners and are
used only to identify which agent a session belongs to.
