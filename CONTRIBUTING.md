# Contributing to Claude Map

Thank you for your interest in contributing! Claude Map is a vanilla-JS, no-bundler project — keeping it lightweight is a core design goal. Please read this guide before opening a PR.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Development Setup](#development-setup)
3. [Project Structure](#project-structure)
4. [Making Changes](#making-changes)
5. [Submitting a Pull Request](#submitting-a-pull-request)
6. [Coding Conventions](#coding-conventions)
7. [Reporting Bugs](#reporting-bugs)
8. [Requesting Features](#requesting-features)

---

## Getting Started

### Prerequisites

- **Node.js 18+**
- **git** on your PATH
- A working [Claude Code](https://claude.ai/code) installation (so there is `~/.claude/` data to inspect)

### Fork and clone

1. Click **Fork** on the [GitHub repository](https://github.com/shamim0902/claude-map).
2. Clone your fork locally:
   ```bash
   git clone https://github.com/<your-username>/claude-map.git
   cd claude-map
   ```
3. Add the upstream remote so you can pull future changes:
   ```bash
   git remote add upstream https://github.com/shamim0902/claude-map.git
   ```

---

## Development Setup

```bash
npm install
npm run dev       # starts server with --watch (auto-restarts on server.js changes)
```

Open `http://localhost:3131` in your browser.

> **Tip:** Frontend changes (`public/app.js`, `public/style.css`, `public/index.html`) take effect on browser refresh — no build step needed.

### Keeping your fork up to date

```bash
git fetch upstream
git checkout main
git merge upstream/main
```

---

## Project Structure

```
├── server.js           # Express backend — API routes, git helper, file watchers
├── bin/cli.js          # CLI entry point
└── public/
    ├── index.html      # HTML shell + CDN script tags
    ├── app.js          # Frontend SPA — all state, renderers, event handlers
    └── style.css       # Dual-theme CSS (dark/light via data-theme attribute)
```

Key constraints:

- **No framework, no bundler.** Everything is plain JS loaded directly in the browser.
- **No TypeScript.** Keep it `.js`.
- **External libs via CDN only** (marked, highlight.js, Monaco, xterm.js).
- CSS colours must use `var(--css-custom-property)` — never hardcode hex values.
- All user-facing strings rendered via `innerHTML` must go through `escapeHtml()` / `escapeAttr()`.

---

## Making Changes

### Branch naming

Create a feature branch off `main` using one of these prefixes:

| Prefix | When to use |
|--------|-------------|
| `feat/` | New feature or capability |
| `fix/` | Bug fix |
| `chore/` | Maintenance (deps, config, CI) |
| `docs/` | Documentation only |
| `refactor/` | Code change with no behaviour change |

Examples:
```bash
git checkout -b feat/session-filter
git checkout -b fix/git-diff-encoding
```

### Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>: <short summary in imperative mood>

[optional body — explain WHY, not WHAT]
```

Examples:
```
feat: add branch filter to git tab
fix: prevent stale git state when switching projects
docs: document renderMarkdown fallback behaviour
```

Keep the subject line under **72 characters**.

### Cache-busting `app.js`

`index.html` loads `app.js` with a `?v=N` query string. Whenever you change `app.js`, increment that version number so browsers pick up the update:

```html
<!-- before -->
<script src="/app.js?v=7"></script>

<!-- after your change -->
<script src="/app.js?v=8"></script>
```

---

## Submitting a Pull Request

1. **Make sure your branch is up to date** with upstream `main`:
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Test locally** — open the app and manually verify your change works and does not break unrelated tabs.

3. **Push** to your fork:
   ```bash
   git push origin feat/your-feature-name
   ```

4. **Open a Pull Request** on GitHub against `shamim0902/claude-map:main`.

5. Fill in the PR description with:
   - **What** changed and **why**
   - Steps to reproduce or test the change
   - Screenshots / GIFs for any UI change

6. A maintainer will review, leave feedback, and merge when everything looks good. Please respond to review comments promptly and push fixup commits to the same branch.

> PRs that touch `public/app.js` or `public/style.css` should include a screenshot.

---

## Coding Conventions

| Area | Convention |
|------|-----------|
| State mutation | Always mutate `State.*`, then call `renderApp()` |
| New tabs | Add a `render<TabName>()` function returning an HTML string |
| DOM reads after render | Use `requestAnimationFrame` or `setTimeout(..., 0)` — never read layout synchronously inside a render path |
| Markdown rendering | Use `renderMarkdown(text)` (not `marked.parse` directly) — it has a built-in fallback |
| Git operations | Use the `git()` helper in `server.js` — never shell out directly in route handlers |
| Secrets / paths | Never log or expose full filesystem paths beyond what the user's own `~/.claude/` already contains |

---

## Reporting Bugs

Open an issue at [github.com/shamim0902/claude-map/issues](https://github.com/shamim0902/claude-map/issues) and include:

- Claude Map version (`npm list -g claude-map` or the version in `package.json`)
- Node.js version (`node -v`)
- OS and browser
- Steps to reproduce
- What you expected vs what happened
- Any browser console errors (open DevTools → Console)

---

## Requesting Features

Open an issue with the label **enhancement** and describe:

- The problem you are trying to solve
- Your proposed solution (or leave it open for discussion)
- Any alternatives you considered

Feature requests that align with the project's no-framework, no-bundler philosophy are most likely to be accepted.

---

## License

By contributing you agree that your changes will be released under the project's [MIT License](LICENSE).
