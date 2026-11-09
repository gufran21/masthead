# Changelog

All notable changes to Masthead are listed here. Versions follow
[Semantic Versioning](https://semver.org/).

## 0.1.0

The first release.

### Sessions

- One list of Claude Code, Codex and Antigravity sessions, read from the logs
  each agent keeps on your machine. Masthead only reads them and never uploads
  anything.
- For each session: title, project, branch, model, state, tokens and how full
  the context window is, with live updates while agents work.
- Active means the agent is working on a turn; Idle means it is waiting for you.
- Filter by agent, project and period, and sort by activity, start, duration or
  tokens.

### Notch

- A small island at the top of the screen. Push the cursor against the top edge
  to reveal it, and hover it to see live sessions.
- Pops open when an agent finishes its turn and marks which one, until you have
  seen it.
- Approve or deny Claude Code permission requests from the notch (opt-in, in
  Settings). With no answer, Claude Code asks in the terminal as usual.

### App

- Liquid-glass interface with one flat theme colour: seven colours, or Black,
  Grey, White and Warm white with a light theme.
- Settings for the glass, the notch, starting with Windows and keeping
  Masthead in the tray when the window is closed.
- Windows installers (`.exe` and `.msi`). They are not code-signed yet.
