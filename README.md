# Claude Map

A visual dashboard for inspecting and mapping Claude Code project configurations. See your global settings, commands, skills, hooks, permissions, and MCP servers at a glance — and visualize how any project connects to your global Claude config.

## Features

- **Connection Map** — interactive 3-layer diagram showing how a project relates to global Claude settings
- **Global Config overview** — commands, skills, plans, permissions, hooks, plugins, stats
- **Project analysis** — status detection (full/partial/none/missing), warnings, session counts
- **Dark / Light theme** — toggle with one click, persisted across sessions
- **Live updates** — file changes in `~/.claude/` auto-refresh the dashboard via SSE
- **Directory browser** — add projects by browsing your filesystem
- **Raw file viewer** — browse and read any file in the `.claude/` tree with syntax highlighting
- **Usage stats** — daily activity chart with message counts, tool calls, and sessions
- **JSON export** — download the full scan result for any project

## Quick Start

**Prerequisites:** Node.js 18 or later.

```bash
git clone <repo-url> claude-map
cd claude-map
npm install
npm start
```

Open **http://localhost:3131** in your browser.

For development with auto-restart on file changes:

```bash
npm run dev
```

## Usage Guide

### Global Config

When the app loads, it automatically scans your `~/.claude/` directory and displays the global configuration. Click **Global Config** in the sidebar to return to this view at any time.

The **Overview** tab shows metric cards for commands, skills, plans, permissions, plugins, and known projects. Below that you'll find your `CLAUDE.md` content, model/effort settings, hooks, and additional directories.

### Adding Projects

Click the **+** button in the sidebar to open the directory browser. Navigate to any project folder and click **Select This Folder**. The project is added to your **Pinned** list in the sidebar.

Projects auto-detected from `~/.claude/projects/` appear under the **Known** section.

Each project shows a status icon:
| Icon | Color | Meaning |
|------|-------|---------|
| **◈** | Green | Full — has `.claude/`, `CLAUDE.md`, and `settings.local.json` |
| **◈** | Yellow | Partial — has `.claude/` but missing some files |
| **○** | Orange | None — directory exists but no `.claude/` directory |
| **✗** | Red | Missing — path does not exist on disk |

### Project Map

Selecting a project opens the **Map** tab — a visual connection diagram with three layers:

```
┌─────────────────────────────────────────────┐
│         Global Config Nodes (top)           │
│  CLAUDE.md  Commands  Skills  Hooks  ...    │
│                    │                        │
│            ── SVG lines ──                  │
│                    │                        │
│          ◈ Project Name (center)            │
│            status · sessions                │
│                    │                        │
│            ── SVG lines ──                  │
│                    │                        │
│         Local Config Nodes (bottom)         │
│  CLAUDE.md  settings.local  .mcp.json  ...  │
└─────────────────────────────────────────────┘
```

- **Solid teal lines** = inherited from global config
- **Dashed blue lines** = project-specific configuration
- **Dashed gray lines** = absent (node not configured)
- Click any node to expand a **detail panel** showing the full content (permissions table, command cards, CLAUDE.md rendered as markdown, MCP server list, etc.)

Warnings appear below the diagram if the project is missing `.claude/`, not registered in `additionalDirectories`, etc.

### Theme Toggle

Click the **◑** button in the sidebar header to switch between dark and light modes. Your preference is saved in `localStorage` and persists across sessions.

### Tabs

| Tab | Description |
|-----|-------------|
| **Map** | Visual connection diagram (project view only) |
| **Overview** | Metric cards, CLAUDE.md preview, config summary, known projects |
| **Commands** | All slash commands from `~/.claude/commands/` with search filter |
| **Skills** | Skills from `~/.claude/skills/` with frontmatter metadata |
| **Plans** | Plan files from `~/.claude/plans/` |
| **Settings** | Model, effort, permissions allow-list (filterable by type), hooks |
| **MCP & Plugins** | Installed plugins, MCP servers from `.mcp.json`, extra marketplaces |
| **Stats** | Daily activity chart and table from `stats-cache.json` |
| **Raw** | File tree browser with syntax-highlighted viewer |

### Live Updates

The app maintains a Server-Sent Events connection to the backend. When any watched file in `~/.claude/` changes, the dashboard auto-refreshes within ~1 second. The connection status is shown in the sidebar footer:
- **Green dot + "Live"** = connected
- **Gray dot + "Disconnected"** = SSE connection lost

### Export

Click the **↓** button in the sidebar footer to download the current scan as a JSON file.

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/scan` | Full scan of `~/.claude/`. Add `?project=<path>` for project-specific data |
| `GET` | `/api/analyze?project=<path>` | Project analysis with connection map data |
| `GET` | `/api/project-status?path=<path>` | Fast status check: `full`, `partial`, `none`, or `missing` |
| `GET` | `/api/file?path=<file>` | Read a file. Add `&project=<path>` for project context |
| `GET` | `/api/export` | Download scan result as JSON. Add `?project=<path>` for project export |
| `GET` | `/api/events` | SSE stream (events: `connected`, `cache-invalidated`) |
| `GET` | `/api/pinned-projects` | List pinned projects |
| `POST` | `/api/pinned-projects` | Add pinned project. Body: `{ "path": "/abs/path" }` |
| `DELETE` | `/api/pinned-projects` | Remove pinned project. Body: `{ "path": "/abs/path" }` |
| `GET` | `/api/browse?path=<dir>` | Browse directory. Add `&hidden=1` to show hidden files |
| `GET` | `/api/browse/bookmarks` | Filesystem quick-nav bookmarks |

## Project Structure

```
claude-map/
├── server.js              # Express backend — API, file watchers, cache
├── package.json           # Dependencies and scripts
├── package-lock.json      # Lockfile
├── .gitignore
├── .claude/
│   └── CLAUDE.md          # Project context for Claude Code
└── public/
    ├── index.html         # HTML shell — sidebar, tabs, directory browser modal
    ├── app.js             # Frontend SPA — state, rendering, all tab views
    └── style.css          # Dual-theme CSS (dark/light)
```

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `PORT` | `3131` | Server port (set via environment variable) |

Pinned projects are stored in `~/.claude/inspector-projects.json`.

## Tech Stack

- **Runtime:** Node.js 18+
- **Server:** Express 4
- **File watching:** chokidar 3
- **Frontmatter parsing:** gray-matter 4
- **Markdown rendering:** marked 9 (CDN)
- **Syntax highlighting:** highlight.js 11 (CDN)
- **Frontend:** Vanilla JavaScript, CSS custom properties, no build step
