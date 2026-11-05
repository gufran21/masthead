# Contributing to Masthead

Thanks for helping. Bug reports, agent adapters, UI work and docs are all welcome.

## Set up

Follow **Build from source** in the [README](README.md), then:

```bash
pnpm install
pnpm dev
```

Before opening a pull request, run:

```bash
cargo fmt --all
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
pnpm typecheck
```

CI runs the same checks.

## Adding an agent

Each agent is a module in `crates/masthead-core/src/adapters/` with two functions:

- `discover(root) -> Vec<PathBuf>` finds the agent's session files.
- `parse_file(path) -> Session` summarises one file into the shared `Session` model.

Then:

1. Register the agent in `Agent` (`model.rs`) and in `SessionStore::refresh` (`store.rs`).
2. Add a small fixture under `crates/masthead-core/tests/fixtures/<agent>/` and tests in
   `tests/adapters.rs`.
3. Add the agent's name in `apps/desktop/src/lib/format.ts`.

Rules for adapters:

- **Read only.** Never write to, lock or move an agent's files.
- **Lenient.** Agent log formats change without notice. Skip lines you don't
  understand; never fail a whole file because of one line.
- **Scrub fixtures.** Fixtures must not contain real prompts, paths, keys or names.
  Write them by hand or redact them fully.

## Pull requests

- Keep each PR focused on one change, with a clear description of what and why.
- Include tests for parsing changes.
- For UI changes, add a screenshot.

## Reporting bugs

Open an issue with your Windows version, the agent and its version, what you
expected and what happened. Don't paste session logs: they can contain private code
and prompts.
