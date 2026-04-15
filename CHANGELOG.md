# Changelog

All notable changes to **Claude Map** are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased] — v1.2.0

### Added
- **Sessions → Run in Terminal** — new `▶ Run` button next to the Copy button on every session card. Clicking it navigates to the Editor tab, opens a terminal (spawning one automatically if none exists), pastes `claude --resume <id>`, and executes it immediately.
- **Git tab** — full Git management panel per project: branch switcher, staged/unstaged file list, inline diff viewer, commit form, pull/push, branch checkout, and worktree management.
- **Monaco Editor tab** — file tree browser with Monaco Editor (v0.52) for editing any project file in-browser, with syntax highlighting, resizable terminal tray, and `Ctrl+\`` / `Cmd+\`` toggle shortcut.
- **Cost report on Sessions tab** — token usage grouped by day and model with client-side pricing engine (`MODEL_PRICING`, `calculateCost`, `formatCost`).
- **Import / Export for commands and skills** — per-card export to `.md`, bulk ZIP export, and bundle import modal.
- **PWA support** — Web App Manifest and service worker scaffolding so the dashboard can be installed as a progressive web app.

### Fixed
- **Markdown not rendering in card bodies** — `marked@9` ships ES-modules only and does not set `window.marked` when loaded via jsDelivr script tag. Downgraded CDN reference to `marked@4.3.0` (proper UMD build) and added a built-in `renderMarkdown()` fallback so cards render even if the CDN is unreachable.
- **CLAUDE.md not rendering in map detail panel** — `global-claude-md` and `local-claude-md` node detail views were calling `marked.parse()` directly; updated to use `renderMarkdown()`.
- **Project CLAUDE.md expand toggle reading wrong source** — `toggleClaudeMdFull()` always read `State.scan.global.claudeMd.raw`; now reads from the correct source based on `State.mode`.

### Changed
- UI design refresh — updated card styles, badges, spacing, and color palette across all tabs.

---

## [1.1.2] — 2026-04-12

### Added
- URL routing — tab state is now reflected in the URL so deep links and browser back/forward work correctly.

### Fixed
- Pinned folders command list not showing (PR [#2](https://github.com/shamim0902/claude-map/pull/2)).

---

## [1.1.1] — 2026-04-12

### Added
- **Session resume copy** — `Copy` button on session cards writes `claude --resume <id>` to the clipboard.

### Changed
- **Project tab isolation** — switching projects now resets all per-project state (git, editor, share mode) so stale data from the previous project never leaks into the new one.
- **Context-aware overview** — global and project overview tabs now render distinct content rather than sharing a single template.

---

## [1.1.0] — 2026-04-12

### Added
- Responsive layout — sidebar collapses to a mobile drawer on narrow viewports.
- Paste path shortcut in the project browser.

### Fixed
- Hourly cost grid rendering off-by-one error in the Stats tab.

---

## [1.0.0] — 2026-04-12

Initial npm release of **Claude Map** as the `claude-map` CLI package.

### Added
- `claude-map` CLI (`npx claude-map` / `claude-map --port 3131`).
- Visual connection map (SVG three-layer diagram) showing global ↔ project config relationships.
- Sessions browser — lists JSONL session files, shows conversation timeline, and displays per-session metadata (tokens, cost, duration, git branch).
- Enhanced skills viewer — frontmatter metadata badges (`user-invocable`, `agent`, `allowed-tools`), word count, export, and delete.
- Analytics — tool usage frequency chart (canvas, no library) and daily token/cost report.
- Team sharing — copy skills, commands, rules, and agents between projects via the Share panel.
- Import / export bundle (ZIP) for skills and commands.
- Dual theme (dark / light) with `localStorage` persistence.
- SSE live-reload — file watchers on `~/.claude/` trigger `cache-invalidated` events so the UI refreshes without a full page reload.
- Pinned projects list stored in `~/.claude/inspector-projects.json`.

---

*Older internal iterations (v2.0.0, v3.0.0, v3.0.1) pre-date the npm package and are not tracked here.*
