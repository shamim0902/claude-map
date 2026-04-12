# Claude Map

A visual inspection and connection-mapping tool for Claude Code project configurations. Reads `~/.claude/` (global) and per-project `.claude/` directories, then presents everything in a web dashboard with a visual connection map.

## Tech Stack

- **Backend:** Node.js 18+, Express 4, chokidar (file watching), gray-matter (YAML frontmatter)
- **Frontend:** Vanilla JavaScript SPA — no framework, no build step, no bundler
- **CDN libs:** marked (markdown), highlight.js (syntax highlighting for JS, JSON, Bash, PHP, Markdown)
- **Styling:** CSS custom properties with dual theme via `html[data-theme="dark"|"light"]`

**Constraints:** Keep it vanilla JS. No TypeScript, no React/Vue/Svelte, no bundler. External libs via CDN only. All rendering uses string-template innerHTML via `renderApp()` pipeline.

## Project Structure

```
claude-inspector/
├── server.js           # Express backend — API routes, file watchers, cache (~780 lines)
├── package.json        # "claude-map" v2.0.0
└── public/
    ├── index.html      # HTML shell — sidebar, tab container, directory browser modal
    ├── app.js          # Frontend SPA — state management, all tab renderers (~1580 lines)
    └── style.css       # Dual-theme CSS with map/status classes (~550 lines)
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
| GET | `/api/scan` | Deep scan of `~/.claude/` config. Optional `?project=<path>` for project-specific data |
| GET | `/api/analyze` | Full project analysis with connection map data. Requires `?project=<path>` |
| GET | `/api/project-status` | Fast status check (full/partial/none/missing). Requires `?path=<path>` |
| GET | `/api/file` | Read a single file. Requires `?path=<file>&project=<path>` |
| GET | `/api/export` | Download scan result as JSON. Optional `?project=<path>` |
| GET | `/api/events` | SSE stream — `connected`, `cache-invalidated` events |
| GET | `/api/pinned-projects` | List user-pinned projects |
| POST | `/api/pinned-projects` | Add a pinned project `{ path }` |
| DELETE | `/api/pinned-projects` | Remove a pinned project `{ path }` |
| GET | `/api/browse` | Directory browser. `?path=<dir>&hidden=0\|1` |
| GET | `/api/browse/bookmarks` | Quick filesystem bookmarks (Home, Desktop, Volumes, etc.) |

## Frontend Architecture

### State-driven rendering
All UI flows through a single `State` object. Any mutation calls `renderApp()` which re-renders the tab bar and active tab content via innerHTML.

### Key patterns
- **`selectGlobal()`** — switches to global view, loads `~/.claude/` config
- **`selectProject(path)`** — switches to project view, fires `Promise.allSettled([API.analyze, API.scan])` in parallel, navigates to Map tab
- **`renderProjectList()`** — unified sidebar with Global Config + Pinned + Known sections, status icons per project
- **`fetchAllProjectStatuses()`** — batch calls to `/api/project-status` (5 at a time) for sidebar status icons

### Tab system
- Global tabs: `overview`, `commands`, `skills`, `plans`, `settings`, `mcp`, `stats`, `raw`
- Project tabs: `map` + all global tabs
- Each tab has a `render<TabName>()` function returning an HTML string

### Connection Map (Map tab)
Three-layer SVG diagram showing how a project connects to global Claude config:
- **Top layer:** Global nodes (CLAUDE.md, Commands, Skills, Hooks, Plugins, Permissions)
- **Center:** Project node with status badge and session count
- **Bottom layer:** Local nodes (CLAUDE.md, settings.local, .mcp.json, Commands, Registration)
- SVG cubic bezier lines drawn post-render via `drawMapSvgLines()` using `getBoundingClientRect()`
- `ResizeObserver` redraws lines on container resize
- Clicking a node shows a detail panel below the diagram

### Theme system
- `initTheme()` reads from `localStorage('claude-map-theme')`
- `applyTheme(t)` sets `data-theme` attribute, toggles hljs stylesheets
- Two `<link>` tags for highlight.js (github-dark + github-light), toggled via `.disabled`

## Backend Architecture

### Cache
In-memory cache with 5-second TTL. Invalidated by chokidar file watchers on `~/.claude/` files.

### SSE (Server-Sent Events)
- Heartbeat every 30 seconds
- `cache-invalidated` event fired when watched files change (300ms debounce)
- Frontend auto-refreshes after 800ms debounce on receiving invalidation

### File watchers (chokidar)
Monitors: `settings.json`, `CLAUDE.md`, `commands/`, `skills/`, `plans/`, `stats-cache.json`, `plugins/installed_plugins.json`

### Pinned projects
Stored in `~/.claude/inspector-projects.json` (backward-compatible filename from v1).

## Coding Conventions

- Always use `escapeHtml()` / `escapeAttr()` for any user-facing string in innerHTML
- CSS colors are CSS custom properties — never hardcode colors, use `var(--name)`
- Frontend functions are global (no module system) — all attached to window scope
- `renderExpandableCard()` is the shared component for command/skill/plan cards
- Expandable cards use `data-raw` attribute + lazy markdown rendering on first open
- File tree uses recursive `renderTreeNode()` with `State.fileTreeExpanded` Set
- Stats chart is a hand-drawn canvas chart (no chart library)
