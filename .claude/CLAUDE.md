# Claude Map

A visual inspection and connection-mapping tool for Claude Code project configurations. Reads `~/.claude/` (global) and per-project `.claude/` directories, then presents everything in a web dashboard with a visual connection map, file editor, integrated terminal, and git management.

## Tech Stack

- **Backend:** Node.js 18+, Express 4, chokidar (file watching), gray-matter (YAML frontmatter), ws (WebSocket), node-pty (terminal PTY)
- **Git:** native `git` binary via `child_process.execFile` — no extra packages
- **Frontend:** Vanilla JavaScript SPA — no framework, no build step, no bundler
- **CDN libs:** marked (markdown), highlight.js (syntax highlighting), Monaco Editor 0.52 (code editor), xterm.js 5.5 + addon-fit + addon-web-links (terminal)
- **Styling:** CSS custom properties with dual theme via `html[data-theme="dark"|"light"]`

**Constraints:** Keep it vanilla JS. No TypeScript, no React/Vue/Svelte, no bundler. External libs via CDN only. All rendering uses string-template innerHTML via `renderApp()` pipeline.

## Project Structure

```
├── server.js           # Express backend — API routes, git helper, file watchers, cache
├── bin/cli.js          # CLI entry point — parses --port/-p, invokes server.js
├── package.json        # "claude-map" — bin: claude-map → bin/cli.js
└── public/
    ├── index.html      # HTML shell — sidebar, tab container, modals, CDN script tags
    ├── app.js          # Frontend SPA — state management, all tab renderers, event handlers
    └── style.css       # Dual-theme CSS with map/status/git/terminal classes
```

## Running the App

```bash
npm install
npm run dev    # node --watch server.js (auto-restart on changes)
npm start      # node server.js
```

Default port: **3131** (override with `PORT` env var).

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/scan` | Deep scan of `~/.claude/` config. Optional `?project=<path>` for project data. Returns `localSkills`, `localCommands`, `localRules`, `localAgents`, `claudeIgnore` on project. |
| GET | `/api/analyze` | Full project analysis with connection map data. Requires `?project=<path>` |
| GET | `/api/project-status` | Fast status check (full/partial/none/missing). Requires `?path=<path>` |
| GET | `/api/sessions` | List session JSONL files for a project. `?project=<path>&limit=50&offset=0` |
| GET | `/api/sessions/:id` | Full conversation timeline for a session. `?project=<path>` |
| GET | `/api/history` | Command history from `~/.claude/history.jsonl`. Optional `?project=<path>&limit=200` |
| GET | `/api/stats/tools` | Tool usage frequency by scanning session JSONL files. `?project=<path>&days=30` |
| GET | `/api/stats/costs` | Token usage grouped by day and model for cost estimation. `?project=<path>` |
| GET | `/api/skills/export` | Download a single skill as `.md`. `?name=<name>&scope=global\|project&project=<path>` |
| POST | `/api/skills/import` | Import a skill. Body: `{ name, content, scope, projectPath }` |
| DELETE | `/api/skills` | Delete a skill. Body: `{ name, scope, projectPath }` |
| DELETE | `/api/rules` | Delete a rule. Body: `{ name, scope, projectPath }` |
| DELETE | `/api/agents` | Delete an agent. Body: `{ name, scope, projectPath }` |
| POST | `/api/share` | Copy skills/commands/rules/agents to another project. Body: `{ items, targetProject }` |
| POST | `/api/export/bundle` | Export bundle of skills+commands+CLAUDE.md. Body: `{ items, scope, projectPath }` |
| POST | `/api/import/bundle` | Import bundle. Body: `{ bundle, target, projectPath, overwrite }` |
| GET | `/api/file` | Read a single file. Requires `?path=<file>&project=<path>` |
| POST | `/api/file` | Save a file. Body: `{ path, content, project }` |
| GET | `/api/export` | Download scan result as JSON. Optional `?project=<path>` |
| GET | `/api/events` | SSE stream — `connected`, `cache-invalidated` events |
| GET | `/api/pinned-projects` | List user-pinned projects |
| POST | `/api/pinned-projects` | Add a pinned project `{ path }` |
| DELETE | `/api/pinned-projects` | Remove a pinned project `{ path }` |
| GET | `/api/browse` | Directory browser. `?path=<dir>&hidden=0\|1` |
| GET | `/api/browse/bookmarks` | Quick filesystem bookmarks (Home, Desktop, Volumes, etc.) |
| GET | `/api/git/is-repo` | Check if folder is a git repo. `?project=<path>` |
| GET | `/api/git/status` | Branch, ahead/behind, changed files. `?project=<path>` |
| GET | `/api/git/diff` | File diff. `?project=<path>&file=<f>&staged=0\|1` |
| GET | `/api/git/log` | Last 30 commits. `?project=<path>` |
| GET | `/api/git/branches` | All local + remote branches. `?project=<path>` |
| GET | `/api/git/remotes` | Remote URLs. `?project=<path>` |
| GET | `/api/git/worktrees` | All worktrees. `?project=<path>` |
| POST | `/api/git/stage` | Stage files. `{ project, files[] }` |
| POST | `/api/git/unstage` | Unstage files. `{ project, files[] }` |
| POST | `/api/git/discard` | Discard changes. `{ project, file }` |
| POST | `/api/git/commit` | Commit. `{ project, summary, body? }` |
| POST | `/api/git/pull` | Pull. `{ project }` |
| POST | `/api/git/push` | Push. `{ project }` |
| POST | `/api/git/checkout` | Switch branch. `{ project, branch }` |
| POST | `/api/git/worktree/add` | Add worktree. `{ project, path, branch, existing }` |
| DELETE | `/api/git/worktree` | Remove worktree. `{ project, path }` |

## Frontend Architecture

### State-driven rendering
All UI flows through a single `State` object. Any mutation calls `renderApp()` which re-renders the tab bar and active tab content via innerHTML.

### Key patterns
- **`selectGlobal()`** — switches to global view, resets git/editor/share state, loads `~/.claude/` config
- **`selectProject(path)`** — switches to project view, fires `Promise.allSettled([API.analyze, API.scan])` in parallel, resets all per-project state (including git state), navigates to Map tab
- **`doSilentRefresh()`** — re-fetches scan/analysis without resetting `currentTab` (used after file edits and deletes so the current tab stays open)
- **`renderProjectList()`** — unified sidebar with Global Config + Pinned + Known sections, status icons per project
- **`fetchAllProjectStatuses()`** — batch calls to `/api/project-status` (5 at a time) for sidebar status icons

### Tab system
- Global tabs: `overview`, `commands`, `skills`, `rules`, `hooks`, `agents`, `plans`, `sessions`, `settings`, `mcp`, `stats`, `raw`, `editor`
- Project tabs: `map`, `overview`, `skills`, `commands`, `rules`, `hooks`, `agents`, `sessions`, `git`, `settings`, `mcp`, `raw`, `editor`
- Each tab has a `render<TabName>()` function returning an HTML string
- `loadGitTab()` is triggered from `renderTabContent()` when switching to the git tab (not from inside `renderGit()` — that caused an infinite spinner)

### Git Tab
- State fields prefixed `git*` all reset in `selectProject()` and `selectGlobal()`
- `loadGitTab()` fetches status + log + worktrees + remotes + branches in parallel via `Promise.allSettled`
- `renderGitHeader()` renders a `<select>` branch dropdown — local branches in first optgroup, remote in second
- `gitCheckoutBranch(branch)` handles checkout with uncommitted-changes warning and full tab reload after switch
- Diff rendering: lines split and each wrapped in `<span class="git-diff-add|del|hunk|meta">`

### Connection Map (Map tab)
Three-layer SVG diagram showing how a project connects to global Claude config:
- **Top layer:** Global nodes (CLAUDE.md, Commands, Skills, Hooks, Plugins, Permissions)
- **Center:** Project node with status badge and session count
- **Bottom layer:** Local nodes (CLAUDE.md, settings.local, .mcp.json, Commands, Registration)
- SVG cubic bezier lines drawn post-render via `drawMapSvgLines()` using `getBoundingClientRect()`
- `ResizeObserver` redraws lines on container resize

### Editor + Terminal
- Monaco Editor loaded via AMD CDN loader, initialized in `initMonaco()`
- Terminal tray is `position: absolute` at bottom of `.content-with-terminal`, only visible when `.main-area.editor-active`
- Terminal panel sits above the tray, resizable via drag handle (height persisted in `localStorage`)
- `_leaveEditorTab()` collapses terminal and removes `editor-active` — called in `selectProject()` and `selectGlobal()`
- `Ctrl+\`` / `Cmd+\`` toggles terminal from anywhere while on Editor tab

### Share system
- `State.shareMode` + `State.shareItems` (Map of key → `{name, type, scope, sourceProject}`) — reset on tab navigate
- Types: `skill`, `command`, `rule`, `agent`
- `shareItemDirect(name, type, scope)` — per-card single-item share without entering share mode
- Server `/api/share` handles all types: rules use flat `.md` copy preserving subdirs, others use `resolveSourceFile()`

### Theme system
- `initTheme()` reads from `localStorage('claude-map-theme')`
- `applyTheme(t)` sets `data-theme` attribute, toggles hljs stylesheets

## Backend Architecture

### Cache
In-memory cache with 5-second TTL. Invalidated by chokidar file watchers on `~/.claude/` files.

### SSE (Server-Sent Events)
- Heartbeat every 30 seconds
- `cache-invalidated` event fires when watched files change (300ms debounce)
- Frontend calls `doSilentRefresh()` (not `doRefresh()`) on invalidation — preserves current tab

### File watchers (chokidar)
Global: `settings.json`, `CLAUDE.md`, `commands/`, `skills/`, `plans/`, `stats-cache.json`, `plugins/installed_plugins.json`
Project: dynamically added via `watchProjectPath(projectPath)` when editor tree loads

### Git helper
`git(args, cwd)` — wraps `child_process.execFile('git', ...)` with 10MB buffer. All git endpoints use this. No npm packages — requires `git` on PATH.

### Pinned projects
Stored in `~/.claude/inspector-projects.json` (backward-compatible filename from v1).

### Scan data shape (project)
`readProjectConfig()` returns: `localSkills`, `localCommands`, `localRules`, `localAgents`, `claudeIgnore`, `settingsLocal`, `settings` (includes `hooksRaw` — raw hooks object from settings.json for the Hooks tab), `mcpJson`, `claudeMd`.

## Coding Conventions

- Always use `escapeHtml()` / `escapeAttr()` for any user-facing string in innerHTML
- CSS colors are CSS custom properties — never hardcode colors, use `var(--name)`
- Frontend functions are global (no module system) — all attached to window scope
- `renderExpandableCard()` is the shared component for command/plan/rule/agent cards
- `renderSkillCard()` is the enhanced skill card component with metadata badges, allowed-tools, export button
- `renderRules()` / `renderHooks()` / `renderAgents()` — new tabs matching Claude Code's full config surface
- `renderGit()` + sub-renderers (`renderGitHeader`, `renderGitFileList`, `renderGitCommitForm`, `renderGitDiff`, `renderGitHistory`, `renderGitWorktrees`) — Git tab
- `renderSessions()` / `renderSessionDetail()` / `renderCommandHistory()` / `renderCostReport()` — Sessions tab
- `MODEL_PRICING` constant + `calculateCost(tokens, model)` + `formatCost(n)` — client-side pricing engine
- Import/export modals: `openImportModal()`, `confirmImport()`, `openBundleModal()`, `confirmBundleExport()`
- Stats chart is a hand-drawn canvas chart (no chart library)
