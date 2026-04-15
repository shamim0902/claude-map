
<img width="1509" height="860" alt="image" src="https://github.com/user-attachments/assets/1b5372d5-3911-421d-9588-fccf3432379c" />


<p align="center">
  <img width="200" height="345" alt="logo-claude-map" src="https://github.com/user-attachments/assets/d4f4cb74-df2f-411a-9655-65a9fee8025e" />
</p>

<p align="center">
  Visual dashboard for inspecting and mapping Claude Code project configurations.
  <br>
  See your global settings, commands, skills, hooks, permissions, MCP servers, rules, and agents at a glance — visualize how any project connects to your global Claude config, edit files, run a terminal, and manage git — all in one place.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/claude-map"><img src="https://img.shields.io/npm/v/claude-map.svg" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/claude-map"><img src="https://img.shields.io/npm/dm/claude-map.svg" alt="npm downloads"></a>
  <a href="https://github.com/shamim0902/claude-map/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/claude-map.svg" alt="license"></a>
</p>

---

## Install

```bash
npm install -g claude-map
```

Or run without installing:

```bash
npx claude-map
```

Then open **http://localhost:3131** in your browser.

> **Note:** `node-pty` requires a native build. If the terminal doesn't work after install, run:
> ```bash
> cd $(npm root -g)/claude-map && npm run postinstall
> ```

### CLI Options

```bash
claude-map                # Start on default port 3131
claude-map -p 8080        # Start on custom port
claude-map --help         # Show help
claude-map --version      # Show version
```

## Features

- **Connection Map** — interactive 3-layer diagram showing how a project relates to global Claude settings
- **Git Tab** — GitHub Desktop-style interface: file changes, staging, diffs, commit, pull/push, branch switching, PR links, and git worktree management
- **Rules** — view and share path-scoped rules from `.claude/rules/` across projects
- **Hooks** — full view of all configured hooks (command/http/prompt/agent types) from global and project settings, with copy-JSON sharing
- **Agents** — view and share custom agent definitions from `.claude/agents/`
- **Enhanced Skills** — allowed-tools, argument-hint, agent delegation; compare global vs project skills; share between projects
- **Team Sharing** — share skills, commands, rules, and agents from any project to any other with checkbox selection or per-card button
- **Built-in Editor** — Monaco-powered file editor with a file tree for any project folder
- **Integrated Terminal** — xterm.js terminal in a resizable bottom tray, scoped to the Editor tab
- **Session History** — browse past conversations with tool call timelines, conversation replay, and per-session cost estimates
- **Cost Report** — estimated API spend per session and over time, broken down by model with daily chart and cache savings
- **Command History** — every prompt you've typed, grouped by day
- **Analytics** — model usage breakdown, hourly activity heatmap, tool frequency chart
- **Dark / Light theme** — toggle with one click, persisted across sessions
- **Live updates** — file changes in `~/.claude/` auto-refresh the dashboard via SSE
- **Directory browser** — add projects by browsing your filesystem or pasting a path
- **Raw file viewer** — browse and read any file in the `.claude/` tree with syntax highlighting
- **JSON export** — download the full scan result for any project

## Usage Guide

### Global Config

When the app loads, it automatically scans your `~/.claude/` directory. Click the logo or **Global Config** in the sidebar to return to this view at any time.

### Adding Projects

Click **+** in the sidebar to open the directory browser, or paste a path directly into the path input. Each project shows a status icon:

| Icon | Color | Meaning |
|------|-------|---------|
| **◈** | Green | Full — has `.claude/`, `CLAUDE.md`, and `settings.local.json` |
| **◈** | Yellow | Partial — has `.claude/` but missing some files |
| **○** | Orange | None — directory exists but no `.claude/` directory |
| **✗** | Red | Missing — path does not exist on disk |

### Project Map

Selecting a project opens the **Map** tab — a visual connection diagram:

- **Solid teal lines** = inherited from global config
- **Dashed blue lines** = project-specific configuration
- **Dashed gray lines** = absent (node not configured)
- Click any node to expand a detail panel

### Git Tab

Available on project views only. Shows the current branch, ahead/behind counts, and all file changes:

- **Branch dropdown** — switch branches directly; warns if you have uncommitted changes
- **Unstaged / Staged sections** — checkbox to stage or unstage each file; click a filename to view its diff on the right
- **Discard** — hover a file row to reveal the ✕ button (with confirmation)
- **Commit form** — summary input + Commit button (enabled only when files are staged)
- **Pull / Push** — inline result shown below the header
- **Open PR ↗** — opens the GitHub/GitLab compare URL for the current branch
- **History** — collapsible list of the last 30 commits
- **Worktrees** — list all worktrees; Open (loads it as a project), Remove, or Add a new one with a branch name and path. Check **existing** to check out a pre-existing branch instead of creating a new one.

### Skills & Commands

The Skills tab shows YAML frontmatter metadata:
- **allowed-tools** — which tools the skill can use
- **argument-hint** — expected arguments when invoking the skill
- **agent** — if the skill delegates to a separate agent
- **Global vs Project comparison** — see which skills exist where

Use **Share mode** (⇥ button) to select multiple skills/commands and copy them to another project. Each card also has a per-card share (⇥) and delete (✕) button.

### Rules

Shows `.claude/rules/**/*.md` files — path-scoped instructions that Claude applies only when working in matching file paths. Path patterns from frontmatter are shown as badges. Shareable across projects the same way as skills.

### Hooks

Shows all hooks defined in `settings.json` (global and project), grouped by source. Displays event type, matcher, command/URL, timeout, and hook type (command / http / prompt / agent) with color coding. Each hook has a **⧉ Copy JSON** button to copy the hook definition for pasting into another project's `settings.json`.

### Agents

Shows `.claude/agents/` custom agent definitions. Same view and share/delete UX as Skills.

### Sessions

Browse all past Claude Code conversations per project. Three sub-views toggled by a pill:

- **Sessions** — list with title, git branch, model, message count, duration, and estimated cost badge. Click to view full conversation timeline with tool call badges, a 5-card cost summary, and a per-model cost breakdown table.
- **Command History** — every prompt grouped by day
- **Cost Report** — total spend summary cards, daily cost chart, per-model cost bar chart, and top 10 most expensive sessions. Costs are estimates based on public Anthropic pricing computed client-side.

### Editor

Monaco-powered editor with a collapsible file tree on the left. The **terminal tray** at the bottom shows all open terminal sessions as chips — click a chip to expand the terminal panel, drag the resize handle to adjust height. Press **Ctrl+`** / **Cmd+`** to toggle the terminal from anywhere. New terminals open in the project directory.

### Team Sharing

- **Share mode** (Skills, Commands, Rules, Agents tabs) — enable with the ⇥ button to multi-select items, then pick a target project in the share modal
- **Per-card share** — hover any card and click ⇥ to share that single item immediately
- **Export Bundle** — download Skills + Commands + CLAUDE.md as JSON
- **Import Bundle** — paste or drag-drop a `.json` bundle
- **Single Skill/Rule export** — download as `.md` from the card

### Stats

- **Model usage breakdown** — token counts per model
- **Hourly activity heatmap** — when you're most active
- **Tool frequency chart** — most-used tools across all sessions
- Daily activity chart and detail table

## Tabs Reference

| Tab | Views | Description |
|-----|-------|-------------|
| **Map** | Project only | Visual connection diagram |
| **Overview** | Both | Metric cards, CLAUDE.md preview, config summary |
| **Skills** | Both | Skills with metadata, global/project comparison, share/delete |
| **Commands** | Both | Global + project-local commands, share/delete |
| **Rules** | Both | Path-scoped rules from `.claude/rules/`, share/delete |
| **Hooks** | Both | Hooks from settings.json, color-coded by type, copy JSON |
| **Agents** | Both | Custom agents from `.claude/agents/`, share/delete |
| **Plans** | Global only | Plan files from `~/.claude/plans/` |
| **Sessions** | Both | Conversations · Command History · Cost Report |
| **Git** | Project only | Staging, diff, commit, branch switch, pull/push, worktrees |
| **Settings** | Both | Permissions, hooks summary, model config, `.claudeignore` |
| **MCP** | Both | Installed plugins, MCP servers, marketplaces |
| **Stats** | Global only | Activity charts, model usage, tool frequency |
| **Raw** | Both | File tree browser with syntax-highlighted viewer |
| **Editor** | Both | Monaco file editor with file tree and integrated terminal |

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/scan` | Full scan of `~/.claude/`. Add `?project=<path>` for project data including `localSkills`, `localCommands`, `localRules`, `localAgents` |
| `GET` | `/api/analyze?project=<path>` | Project analysis with connection map data |
| `GET` | `/api/project-status?path=<path>` | Fast status check (full/partial/none/missing) |
| `GET` | `/api/sessions?project=<path>` | List session history |
| `GET` | `/api/sessions/:id?project=<path>` | Full conversation timeline |
| `GET` | `/api/history` | Command history. Add `?project=<path>` to filter |
| `GET` | `/api/stats/tools` | Tool usage frequency |
| `GET` | `/api/stats/costs` | Token usage by day and model |
| `GET` | `/api/pinned-projects` | List pinned projects |
| `POST` | `/api/pinned-projects` | Add pinned project `{ path }` |
| `DELETE` | `/api/pinned-projects` | Remove pinned project `{ path }` |
| `GET` | `/api/browse` | Directory browser `?path=<dir>&hidden=0\|1` |
| `GET` | `/api/browse/bookmarks` | Filesystem bookmarks |
| `GET` | `/api/skills/export` | Download skill as `.md` `?name=<name>&scope=global\|project&project=<path>` |
| `POST` | `/api/skills/import` | Import a skill `{ name, content, scope, projectPath }` |
| `DELETE` | `/api/skills` | Delete a skill `{ name, scope, projectPath }` |
| `DELETE` | `/api/rules` | Delete a rule `{ name, scope, projectPath }` |
| `DELETE` | `/api/agents` | Delete an agent `{ name, scope, projectPath }` |
| `POST` | `/api/share` | Copy skills/commands/rules/agents to another project `{ items, targetProject }` |
| `POST` | `/api/export/bundle` | Export bundle `{ items, scope, projectPath }` |
| `POST` | `/api/import/bundle` | Import bundle `{ bundle, target, projectPath, overwrite }` |
| `GET` | `/api/file` | Read a file `?path=<file>&project=<path>` |
| `POST` | `/api/file` | Save a file `{ path, content, project }` |
| `GET` | `/api/export` | Download full scan as JSON |
| `GET` | `/api/events` | SSE stream for live updates |
| `GET` | `/api/git/is-repo?project=<path>` | Check if folder is a git repo |
| `GET` | `/api/git/status?project=<path>` | Branch, ahead/behind, changed files |
| `GET` | `/api/git/diff?project=<path>&file=<f>&staged=0\|1` | File diff |
| `GET` | `/api/git/log?project=<path>` | Last 30 commits |
| `GET` | `/api/git/branches?project=<path>` | All local + remote branches |
| `GET` | `/api/git/remotes?project=<path>` | Remote URLs |
| `GET` | `/api/git/worktrees?project=<path>` | All worktrees |
| `POST` | `/api/git/stage` | Stage files `{ project, files[] }` |
| `POST` | `/api/git/unstage` | Unstage files `{ project, files[] }` |
| `POST` | `/api/git/discard` | Discard changes `{ project, file }` |
| `POST` | `/api/git/commit` | Commit `{ project, summary, body? }` |
| `POST` | `/api/git/pull` | Pull `{ project }` |
| `POST` | `/api/git/push` | Push `{ project }` |
| `POST` | `/api/git/checkout` | Switch branch `{ project, branch }` |
| `POST` | `/api/git/worktree/add` | Add worktree `{ project, path, branch, existing }` |
| `DELETE` | `/api/git/worktree` | Remove worktree `{ project, path }` |

## Project Structure

```
claude-map/
├── bin/
│   └── cli.js             # CLI entry point (npx claude-map)
├── public/
│   ├── index.html          # HTML shell — sidebar, modals, xterm/Monaco CDN scripts
│   ├── app.js              # Frontend SPA — all state, renderers, event handlers
│   ├── style.css           # Dual-theme CSS
│   └── logo.png
├── server.js               # Express backend — all API routes, git helper, file watchers
├── package.json
└── LICENSE
```

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `PORT` | `3131` | Server port (env variable or `-p` flag) |

Pinned projects are stored in `~/.claude/inspector-projects.json`.

## Tech Stack

- **Runtime:** Node.js 18+
- **Server:** Express 4, ws (WebSocket for terminal), node-pty (terminal PTY)
- **Git:** native `git` binary via `child_process.execFile` — no extra packages
- **File watching:** chokidar 3
- **Frontmatter parsing:** gray-matter 4
- **Markdown rendering:** marked 9 (CDN)
- **Syntax highlighting:** highlight.js 11 (CDN)
- **Code editor:** Monaco Editor 0.52 (CDN)
- **Terminal:** xterm.js 5.5 + addon-fit + addon-web-links (CDN)
- **Frontend:** Vanilla JavaScript, CSS custom properties, no build step

## Release Workflow

This project uses a GitHub Actions workflow that automatically publishes to npm when a commit message starts with `release:`.

```bash
npm version patch   # or minor / major
git add -A
git commit -m "release: v1.2.0"
git push
```

**Setup required:** Add `NPM_TOKEN` as a repository secret in GitHub Settings > Secrets.

## License

[MIT](LICENSE)
