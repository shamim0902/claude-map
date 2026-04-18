# Changelog

All notable changes to **Claude Map** are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.2.2] — 2026-04-18

### Fixed
- **Cost calculation accuracy** — corrected token pricing multipliers for `claude-opus-4`, `claude-sonnet-4-5`, `claude-sonnet-4-6`, and `haiku-4-5`; costs were being over-counted when cache read tokens were present.
- **Usage stats double-counting** — total message and tool-call counts on the Dashboard were incorrectly summing both input and output token fields, leading to inflated numbers. Now counts are derived from the correct per-turn fields.
- **Daily cost chart off-by-one** — the last day bucket in the 30-day activity chart was being excluded due to a boundary condition in the date bucketing loop (`<` vs `<=`).
- **Model usage breakdown missing entries** — sessions using model aliases (e.g. `claude-3-5-sonnet-20241022`) were not being matched to the pricing table, showing `$0.00` cost and being omitted from the model breakdown chart; alias normalisation now maps these to canonical model keys.
- **Cache savings calculation** — the "Cache savings" metric was computing `cacheWriteTokens × inputPrice` instead of the correct `(cacheReadTokens × inputPrice) - (cacheReadTokens × cacheReadPrice)` delta.

---

## [1.2.1] — 2026-04-18

### Added
- **Permission Settings Manager** — full interactive permission editor accessible from a new top-level **Permissions** tab in the main navigation (🔐).
  - **Dangerous Mode toggle** — animated ON/OFF switch that sets `defaultMode: bypassPermissions` in the target settings file. Shows a pulsing red warning banner when active.
  - **Allow / Deny / Ask lists** — interactive tables for all three permission lists. Inline add-row with tool-type selector (Bash, Read, Write, Edit, WebSearch, mcp__, Custom raw) and argument field; hover any row to reveal the × delete button.
  - **Additional Directories** — add or remove extra filesystem paths Claude Code can access beyond the project root.
  - **Stacked project/global view** — when a project is selected the page shows **Project-local** permissions first (`.claude/settings.local.json`) followed by a "Global defaults" divider and the global section (`~/.claude/settings.json`), both fully editable on one page.
  - **Safe file writes** — all saves use a new `POST /api/permissions` endpoint that merges only the `permissions` block into the target file, leaving hooks, model config, and other fields untouched.
  - **Optimistic UI** — local state patches immediately on save so the UI reflects changes before the SSE refresh fires.
- **`GET /api/permissions`** — read the raw permissions block from a settings file (supports `?scope=global|project&project=<path>`).
- **`POST /api/permissions`** — safely merge-write a permissions block into a settings file.
- **Extended settings parsing** — `readSettingsJson()` now parses `deny`, `ask`, and `defaultMode` fields in addition to `allow`.

### Changed
- **Sessions → Run in Terminal** — new `▶ Run` button next to the Copy button on every session card. Clicking it navigates to the Editor tab, opens a terminal (spawning one automatically if none exists), pastes `claude --resume <id>`, and executes it immediately.
- **Git tab** — full Git management panel per project: branch switcher, staged/unstaged file list, inline diff viewer, commit form, pull/push, branch checkout, and worktree management.
- **Monaco Editor tab** — file tree browser with Monaco Editor (v0.52) for editing any project file in-browser, with syntax highlighting, resizable terminal tray, and `Ctrl+\`` / `Cmd+\`` toggle shortcut.
- **Cost report on Sessions tab** — token usage grouped by day and model with client-side pricing engine.
- **Import / Export for commands and skills** — per-card export to `.md`, bulk ZIP export, and bundle import modal.
- **PWA support** — Web App Manifest and service worker scaffolding.

### Fixed
- **Bypass Mode padding** — "Dangerous Mode" toggle now renders inside a proper `perm-section-header` + `perm-section-body` card, eliminating the large empty gap that appeared between the section label and the toggle.
- **Markdown not rendering in card bodies** — downgraded CDN reference to `marked@4.3.0` (proper UMD build) and added a built-in `renderMarkdown()` fallback.
- **CLAUDE.md not rendering in map detail panel** — updated to use `renderMarkdown()`.
- **Project CLAUDE.md expand toggle reading wrong source** — now reads from the correct source based on `State.mode`.

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
