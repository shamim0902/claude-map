// ═══════════════════════════════════════════════════════════════
//  Claude Map — Frontend Application  v3.0
// ═══════════════════════════════════════════════════════════════

// ─── State ────────────────────────────────────────────────────
const State = {
  // Navigation
  mode: 'global',        // 'global' | 'project'
  projectPath: '',
  currentTab: 'overview',
  currentGroup: 'dashboard',  // active top-level tab group id
  theme: 'dark',

  // Data
  scan: null,
  analysis: null,
  loading: false,
  analysisLoading: false,
  error: null,

  // Map tab
  activeNodeId: null,
  _mapConnectionDefs: [],

  // Sidebar
  pinnedProjects: [],
  sidebarProjectStatuses: {},  // { [path]: 'full'|'partial'|'none'|'missing'|'loading' }

  // Tab filters
  commandFilter: '',
  skillFilter: '',
  permFilter: 'all',

  // Raw tab
  rawSelectedPath: null,
  rawFileContent: null,
  rawFileLoading: false,
  fileTreeExpanded: new Set(),

  // Skills
  skillScope: 'all',              // 'all' | 'global' | 'project'

  // Sessions
  sessionsList: null,
  sessionsLoading: false,
  sessionsOffset: 0,
  sessionsFilter: '',
  sessionDetail: null,
  sessionDetailLoading: false,
  sessionViewMode: 'list',
  activeSessionId: null,
  historyEntries: null,
  historyMode: false,
  costReport: null,
  costReportLoading: false,
  costReportMode: false,

  // Editor
  editorPath: null,
  editorDirty: false,
  editorFileTree: null,
  editorFileTreeLoading: false,

  // Stats
  statsToolData: null,
  statsToolLoading: false,
  statsChartSeries: 'messages',

  // Import/Export
  importModalOpen: false,
  importScope: 'project',
  importPreview: null,

  // Share
  shareMode: false,           // share mode active on skills/commands tab
  shareItems: new Map(),      // filePath-key → {name, type, scope, sourceProject}

  // Misc
  sseConnected: false,
  refreshTimer: null,
  statsSort: 'date-desc',

  // Terminal
  terminalPanelOpen: false,
  terminalHeight: 280,

  // Git tab
  gitStatus:            null,
  gitStatusLoading:     false,
  gitDiff:              null,
  gitDiffLoading:       false,
  gitSelectedFile:      null,
  gitCommitSummary:     '',
  gitCommitBody:        '',
  gitLog:               null,
  gitWorktrees:         null,
  gitBranches:          null,
  gitRemotes:           null,
  gitIsRepo:            null,
  gitLogExpanded:       false,
  gitWorktreesExpanded: false,
};

// ─── Model Pricing (per million tokens, USD) ──────────────────
const MODEL_PRICING = [
  { match: 'opus-4',     input: 15,   output: 75,   cacheWrite: 3.75, cacheRead: 1.50 },
  { match: 'sonnet-4',   input: 3,    output: 15,   cacheWrite: 3.75, cacheRead: 0.30 },
  { match: 'haiku-4',    input: 0.80, output: 4,    cacheWrite: 1.00, cacheRead: 0.08 },
  { match: 'sonnet-3-5', input: 3,    output: 15,   cacheWrite: 3.75, cacheRead: 0.30 },
  { match: 'opus-3',     input: 15,   output: 75,   cacheWrite: 3.75, cacheRead: 1.50 },
  { match: 'haiku-3',    input: 0.25, output: 1.25, cacheWrite: 0.30, cacheRead: 0.03 },
];
const MODEL_PRICING_DEFAULT = { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.30 };

function getPricing(model) {
  const m = (model || '').toLowerCase();
  return MODEL_PRICING.find(r => m.includes(r.match)) || MODEL_PRICING_DEFAULT;
}

function calculateCost(t, model) {
  if (!t) return 0;
  const p = getPricing(model);
  return ((t.input || 0) * p.input + (t.output || 0) * p.output +
          (t.cacheWrite || 0) * p.cacheWrite + (t.cacheRead || 0) * p.cacheRead) / 1_000_000;
}

function formatCost(n) {
  if (!n || n <= 0) return '$0.00';
  if (n < 0.001) return '<$0.001';
  if (n < 0.01)  return '$' + n.toFixed(4);
  if (n < 1)     return '$' + n.toFixed(3);
  return '$' + n.toFixed(2);
}

// ─── Tab Definitions ──────────────────────────────────────────
const TAB_GROUPS_GLOBAL = [
  { id: 'dashboard', label: 'Dashboard', icon: '⊞', tabs: ['overview'] },
  { id: 'config',    label: 'Config',    icon: '⚙', tabs: ['skills', 'commands', 'rules', 'hooks', 'agents', 'settings', 'mcp', 'raw'] },
  { id: 'activity',  label: 'Activity',  icon: '◷', tabs: ['sessions', 'plans'] },
  { id: 'editor',    label: 'Code Editor', icon: '✎', tabs: ['editor'] },
];

const TAB_GROUPS_PROJECT = [
  { id: 'dashboard', label: 'Dashboard', icon: '◈', tabs: ['map'] },
  { id: 'config',    label: 'Config',    icon: '⚙', tabs: ['skills', 'commands', 'rules', 'hooks', 'agents', 'settings', 'mcp', 'raw'] },
  { id: 'activity',  label: 'Activity',  icon: '◷', tabs: ['sessions', 'git'] },
  { id: 'editor',    label: 'Code Editor', icon: '✎', tabs: ['editor'] },
];

// Flat arrays derived for backward compat (URL routing, popstate, etc.)
const TABS_GLOBAL  = TAB_GROUPS_GLOBAL.flatMap(g => g.tabs);
const TABS_PROJECT = TAB_GROUPS_PROJECT.flatMap(g => g.tabs);

const TAB_META = {
  map:      { label: 'Map',     icon: '◈' },
  overview: { label: 'Overview', icon: '⊞' },
  sessions: { label: 'Sessions', icon: '◷' },
  commands: { label: 'Commands', icon: '/' },
  skills:   { label: 'Skills',   icon: '★' },
  plans:    { label: 'Plans',    icon: '☰' },
  settings: { label: 'Settings', icon: '⚙' },
  mcp:      { label: 'MCP',      icon: '⚡' },
  stats:    { label: 'Stats',    icon: '▤' },
  raw:      { label: 'Raw',      icon: '{ }' },
  git:      { label: 'Git',      icon: '⎇' },
  editor:   { label: 'Code Editor', icon: '✎' },
  rules:    { label: 'Rules',   icon: '⊘' },
  hooks:    { label: 'Hooks',   icon: '⚓' },
  agents:   { label: 'Agents',  icon: '◎' },
};

function getCurrentTabs() {
  return State.mode === 'project' ? TABS_PROJECT : TABS_GLOBAL;
}

function getTabGroups() {
  return State.mode === 'project' ? TAB_GROUPS_PROJECT : TAB_GROUPS_GLOBAL;
}

function syncGroupFromTab(tab) {
  const groups = getTabGroups();
  const g = groups.find(gr => gr.tabs.includes(tab));
  if (g) State.currentGroup = g.id;
}

function navigateGroup(groupId) {
  const groups = getTabGroups();
  const g = groups.find(gr => gr.id === groupId);
  if (!g) return;
  State.currentGroup = groupId;
  if (!g.tabs.includes(State.currentTab)) {
    State.currentTab = g.tabs[0];
    State.shareMode  = false;
    State.shareItems = new Map();
  }
  State.activeNodeId = null;
  updateUrl();
  renderApp();
}

// ─── API Client ───────────────────────────────────────────────
const API = {
  async get(path) {
    const res = await fetch(path);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `HTTP ${res.status}`);
    }
    return res.json();
  },
  scan(projectPath) {
    const qs = projectPath ? `?project=${encodeURIComponent(projectPath)}` : '';
    return this.get(`/api/scan${qs}`);
  },
  analyze(projectPath) {
    return this.get(`/api/analyze?project=${encodeURIComponent(projectPath)}`);
  },
  projectStatus(projectPath) {
    return this.get(`/api/project-status?path=${encodeURIComponent(projectPath)}`);
  },
  file(filePath, projectPath) {
    const qs = projectPath ? `&project=${encodeURIComponent(projectPath)}` : '';
    return this.get(`/api/file?path=${encodeURIComponent(filePath)}${qs}`);
  },
  sessions(projectPath, limit = 50, offset = 0) {
    return this.get(`/api/sessions?project=${encodeURIComponent(projectPath)}&limit=${limit}&offset=${offset}`);
  },
  sessionDetail(id, projectPath) {
    return this.get(`/api/sessions/${id}?project=${encodeURIComponent(projectPath)}`);
  },
  history(projectPath, limit = 200) {
    const qs = projectPath ? `?project=${encodeURIComponent(projectPath)}&limit=${limit}` : `?limit=${limit}`;
    return this.get(`/api/history${qs}`);
  },
  toolStats(projectPath, days = 30) {
    const qs = projectPath ? `?project=${encodeURIComponent(projectPath)}&days=${days}` : `?days=${days}`;
    return this.get(`/api/stats/tools${qs}`);
  },
  costStats(projectPath) {
    const qs = projectPath ? `?project=${encodeURIComponent(projectPath)}` : '';
    return this.get(`/api/stats/costs${qs}`);
  },
  fileTree(dirPath, projectPath) {
    const qs = projectPath ? `&project=${encodeURIComponent(projectPath)}` : '';
    return this.get(`/api/file-tree?path=${encodeURIComponent(dirPath)}${qs}`);
  },
  saveFile(filePath, content, projectPath) {
    return fetch('/api/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath, content, project: projectPath || null }),
    }).then(r => r.json());
  },
  share(items, targetProject) {
    return fetch('/api/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, targetProject }),
    }).then(r => r.json());
  },
  deleteSkill(name, scope, projectPath) {
    return fetch('/api/skills', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, scope, projectPath: projectPath || null }),
    }).then(r => r.json());
  },
  deleteRule(name, scope, projectPath) {
    return fetch('/api/rules', { method: 'DELETE', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ name, scope, projectPath: projectPath || null }) }).then(r=>r.json());
  },
  deleteAgent(name, scope, projectPath) {
    return fetch('/api/agents', { method: 'DELETE', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ name, scope, projectPath: projectPath || null }) }).then(r=>r.json());
  },

  // ── Git ──────────────────────────────────────────────────────
  gitIsRepo(p)                 { return this.get(`/api/git/is-repo?project=${encodeURIComponent(p)}`); },
  gitStatus(p)                 { return this.get(`/api/git/status?project=${encodeURIComponent(p)}`); },
  gitDiff(p, file, staged)     { return this.get(`/api/git/diff?project=${encodeURIComponent(p)}&file=${encodeURIComponent(file)}&staged=${staged ? 1 : 0}`); },
  gitLog(p)                    { return this.get(`/api/git/log?project=${encodeURIComponent(p)}`); },
  gitRemotes(p)                { return this.get(`/api/git/remotes?project=${encodeURIComponent(p)}`); },
  gitBranches(p)               { return this.get(`/api/git/branches?project=${encodeURIComponent(p)}`); },
  gitWorktrees(p)              { return this.get(`/api/git/worktrees?project=${encodeURIComponent(p)}`); },
  gitStage(p, files)           { return fetch('/api/git/stage',   { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ project: p, files }) }).then(r=>r.json()); },
  gitUnstage(p, files)         { return fetch('/api/git/unstage', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ project: p, files }) }).then(r=>r.json()); },
  gitDiscard(p, file)          { return fetch('/api/git/discard', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ project: p, file  }) }).then(r=>r.json()); },
  gitCommit(p, summary, body)  { return fetch('/api/git/commit',  { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ project: p, summary, body }) }).then(r=>r.json()); },
  gitPull(p)                   { return fetch('/api/git/pull',    { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ project: p }) }).then(r=>r.json()); },
  gitPush(p)                   { return fetch('/api/git/push',    { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ project: p }) }).then(r=>r.json()); },
  gitCheckout(p, branch)               { return fetch('/api/git/checkout', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ project: p, branch }) }).then(r=>r.json()); },
  gitWorktreeAdd(p, wtPath, br, existing){ return fetch('/api/git/worktree/add', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ project: p, path: wtPath, branch: br, existing: !!existing }) }).then(r=>r.json()); },
  gitWorktreeRemove(p, wtPath) { return fetch('/api/git/worktree', { method:'DELETE', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ project: p, path: wtPath }) }).then(r=>r.json()); },
};

// ─── Utils ────────────────────────────────────────────────────
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(str) { return escapeHtml(str || ''); }

function stripWrappingQuotes(str) {
  const s = String(str || '').trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith('\'') && s.endsWith('\''))) {
    return s.slice(1, -1).trim();
  }
  return s;
}

function utf8ToBase64(str) {
  try {
    const bytes = new TextEncoder().encode(String(str || ''));
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  } catch {
    return '';
  }
}

function base64ToUtf8(str) {
  try {
    const binary = atob(String(str || ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  } catch {
    return '';
  }
}

function readMarkdownPayload(el) {
  if (!el) return '';
  if (el.dataset?.rawB64) {
    const decoded = base64ToUtf8(el.dataset.rawB64);
    if (decoded) return decoded;
  }
  return el.dataset?.raw || '';
}

function renderMarkdown(text) {
  if (typeof marked !== 'undefined' && typeof marked.parse === 'function') {
    return marked.parse(text);
  }
  // Built-in fallback when CDN fails to load marked
  const t = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return t
    .replace(/^#{3} (.+)$/gm, '<h3>$1</h3>')
    .replace(/^#{2} (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]+?<\/li>)(?!\s*<li>)/g, '<ul>$1</ul>')
    .replace(/\n\n+/g, '</p><p>')
    .replace(/^(?!<[hulo])(.+)$/gm, (_, l) => l ? l : '')
    .replace(/^(<p>)?([^<\n].*)$/gm, (m, p, l) => p ? m : `<p>${l}</p>`);
}

function extractImportedSkillName(mdText) {
  const text = String(mdText || '');

  // Try frontmatter first (`name: ...`).
  const frontmatterBlock = text.match(/^\uFEFF?\s*---\s*[\r\n]+([\s\S]*?)^[ \t]*---\s*(?:[\r\n]|$)/m);
  if (frontmatterBlock?.[1]) {
    const frontmatterName = frontmatterBlock[1].match(/^\s*name\s*:\s*(.+?)\s*$/mi);
    if (frontmatterName?.[1]) {
      const clean = stripWrappingQuotes(frontmatterName[1]);
      if (clean) return clean;
    }
  }

  // Fallback to first markdown H1 heading.
  const headingName = text.match(/^\s*#\s+(.+?)\s*$/m);
  if (headingName?.[1]) {
    const clean = stripWrappingQuotes(headingName[1]);
    if (clean) return clean;
  }

  return 'imported-skill';
}

function formatNum(n) {
  if (n == null) return '—';
  return Number(n).toLocaleString();
}

function formatDate(str) {
  if (!str) return '—';
  return str.slice(0, 10);
}

function formatBytes(n) {
  if (n == null) return '';
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

function timeSince(isoStr) {
  if (!isoStr) return '';
  const d = Date.now() - new Date(isoStr).getTime();
  const s = Math.floor(d / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function typeBadge(type) {
  return `<span class="type-badge ${type}">${escapeHtml(type)}</span>`;
}

function projectName(p) {
  return p ? (p.split('/').pop() || p) : '';
}

function projectAbbrev(name) {
  if (!name) return '??';
  const parts = name.split(/[-_ .]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

// ─── Theme ────────────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem('claude-map-theme') || 'dark';
  applyTheme(saved);
}

function applyTheme(t) {
  State.theme = t;
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('claude-map-theme', t);
  const darkLink  = document.getElementById('hljs-dark');
  const lightLink = document.getElementById('hljs-light');
  if (darkLink)  darkLink.disabled  = (t === 'light');
  if (lightLink) lightLink.disabled = (t === 'dark');
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.title = t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  // Keep PWA theme-color in sync with current theme
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.content = t === 'dark' ? '#141418' : '#fafafa';
}

function toggleTheme() {
  applyTheme(State.theme === 'dark' ? 'light' : 'dark');
}

// ─── Collapsible Sidebar ──────────────────────────────────────
function toggleSidebarCollapse() {
  const shell = document.querySelector('.app-shell');
  if (!shell) return;
  shell.classList.toggle('sidebar-collapsed');
  const collapsed = shell.classList.contains('sidebar-collapsed');
  const btn = document.querySelector('.sidebar-collapse-btn');
  if (btn) btn.textContent = collapsed ? '»' : '«';
  try { localStorage.setItem('claude-map-sidebar-collapsed', collapsed ? '1' : ''); } catch {}
}

function restoreSidebarState() {
  try {
    if (localStorage.getItem('claude-map-sidebar-collapsed') === '1') {
      document.querySelector('.app-shell')?.classList.add('sidebar-collapsed');
      const btn = document.querySelector('.sidebar-collapse-btn');
      if (btn) btn.textContent = '»';
    }
  } catch {}
}

// ─── Mobile Sidebar ───────────────────────────────────────────
function toggleMobileSidebar() {
  document.querySelector('.sidebar')?.classList.toggle('open');
  document.getElementById('sidebar-backdrop')?.classList.toggle('visible');
}

function closeMobileSidebar() {
  document.querySelector('.sidebar')?.classList.remove('open');
  document.getElementById('sidebar-backdrop')?.classList.remove('visible');
}

// ─── Navigation ───────────────────────────────────────────────
function selectGlobal() {
  State.mode        = 'global';
  State.projectPath = '';
  State.currentTab  = 'overview';
  State.currentGroup = 'dashboard';
  State.analysis    = null;
  State.activeNodeId = null;
  State.editorFileTree = null;
  State.editorFileTreeLoading = false;
  State.gitStatus = null;
  State.gitStatusLoading = false;
  State.gitIsRepo = null;
  _leaveEditorTab();

  closeMobileSidebar();
  updateUrl();
  if (!State.scan) {
    loadGlobal();
  } else {
    renderApp();
  }
  renderProjectList();
}

async function loadGlobal() {
  State.loading = true;
  State.error   = null;
  State.scan    = null;
  renderApp();
  try {
    State.scan = await API.scan(null);
    document.getElementById('scan-meta').textContent =
      `${State.scan.meta?.scanDurationMs || 0}ms`;
  } catch (e) {
    State.error = e;
  }
  State.loading = false;
  renderApp();
  fetchAllProjectStatuses();
}

async function selectProject(path) {
  closeMobileSidebar();
  State.mode        = 'project';
  State.projectPath = path;
  State.currentTab  = 'map';
  State.currentGroup = 'dashboard';
  State.activeNodeId = null;
  State.analysis    = null;
  State.analysisLoading = true;
  // Reset session state for new project
  State.sessionsList = null;
  State.sessionDetail = null;
  State.sessionViewMode = 'list';
  State.activeSessionId = null;
  State.historyEntries = null;
  State.historyMode = false;
  State.statsToolData = null;
  State.editorFileTree = null;
  State.editorFileTreeLoading = false;
  // Reset git state
  State.gitStatus = null;
  State.gitStatusLoading = false;
  State.gitDiff = null;
  State.gitDiffLoading = false;
  State.gitSelectedFile = null;
  State.gitCommitSummary = '';
  State.gitCommitBody = '';
  State.gitLog = null;
  State.gitWorktrees = null;
  State.gitRemotes = null;
  State.gitIsRepo = null;
  State.gitLogExpanded = false;
  State.gitWorktreesExpanded = false;
  _leaveEditorTab();
  renderApp();
  renderProjectList();

  const [ar, sr] = await Promise.allSettled([
    API.analyze(path),
    API.scan(path)
  ]);
  if (ar.status === 'fulfilled') State.analysis = ar.value;
  if (sr.status === 'fulfilled') State.scan     = sr.value;
  State.analysisLoading = false;
  renderApp();
  fetchAllProjectStatuses();
}

function navigate(tab) {
  if (tab !== State.currentTab) {
    State.shareMode  = false;
    State.shareItems = new Map();
  }
  State.currentTab = tab;
  syncGroupFromTab(tab);
  State.activeNodeId = null;
  updateUrl();
  renderApp();
}

// ─── URL Routing ──────────────────────────────────────────────
let _suppressUrlUpdate = false;

// Slug helpers — store slug→fullPath in localStorage so short names survive page reload
function getProjectSlug(fullPath) {
  return fullPath.split('/').filter(Boolean).pop() || 'project';
}

function saveProjectSlug(fullPath) {
  try {
    const map = JSON.parse(localStorage.getItem('claude-map-slugs') || '{}');
    map[getProjectSlug(fullPath)] = fullPath;
    localStorage.setItem('claude-map-slugs', JSON.stringify(map));
  } catch {}
}

function resolveProjectSlug(slug) {
  // 1. localStorage slug map (fastest, survives reload)
  try {
    const map = JSON.parse(localStorage.getItem('claude-map-slugs') || '{}');
    if (map[slug]) return map[slug];
  } catch {}
  // 2. search pinned + scanned projects by folder name
  const all = [
    ...(State.pinnedProjects || []),
    ...(State.scan?.global?.projects?.map(p => p.decodedPath).filter(Boolean) || []),
  ];
  return all.find(p => getProjectSlug(p) === slug) || null;
}

function buildUrl() {
  const params = new URLSearchParams();
  if (State.mode === 'project' && State.projectPath) {
    params.set('project', getProjectSlug(State.projectPath));
  }
  if (State.currentTab && State.currentTab !== 'overview') {
    params.set('tab', State.currentTab);
  }
  const qs = params.toString();
  return qs ? `/?${qs}` : '/';
}

function updateUrl(replace = false) {
  if (_suppressUrlUpdate) return;
  const url = buildUrl();
  if (replace) {
    history.replaceState(null, '', url);
  } else {
    history.pushState(null, '', url);
  }
}

window.addEventListener('popstate', () => {
  _suppressUrlUpdate = true;
  const params = new URLSearchParams(location.search);
  const slug   = params.get('project');
  const tab    = params.get('tab');

  if (slug) {
    const fullPath = resolveProjectSlug(slug);
    if (fullPath && State.mode === 'project' && State.projectPath === fullPath) {
      // Same project — instant tab switch
      const t = (tab && TABS_PROJECT.includes(tab)) ? tab : 'map';
      State.currentTab = t;
      syncGroupFromTab(t);
      State.activeNodeId = null;
      _suppressUrlUpdate = false;
      renderApp();
    } else if (fullPath) {
      selectProject(fullPath).then(() => {
        if (tab && TABS_PROJECT.includes(tab)) {
          State.currentTab = tab;
          syncGroupFromTab(tab);
          renderApp();
        }
        _suppressUrlUpdate = false;
      });
    } else {
      // Slug not resolvable — fall back to global
      selectGlobal();
      _suppressUrlUpdate = false;
    }
  } else {
    if (State.mode === 'global') {
      const t = (tab && TABS_GLOBAL.includes(tab)) ? tab : 'overview';
      State.currentTab = t;
      syncGroupFromTab(t);
      State.activeNodeId = null;
      _suppressUrlUpdate = false;
      renderApp();
    } else {
      selectGlobal();
      if (tab && TABS_GLOBAL.includes(tab)) {
        State.currentTab = tab;
        syncGroupFromTab(tab);
        renderApp();
      }
      _suppressUrlUpdate = false;
    }
  }
});

// ─── Render Pipeline ──────────────────────────────────────────
function renderApp() {
  renderProjectList();
  renderTabBar();
  renderTabContent();
}

function renderTabBar() {
  const scan = State.scan;
  const g    = scan?.global;
  const proj = scan?.project;
  const isProject = State.mode === 'project';

  const counts = {
    commands: isProject ? (proj?.localCommands?.length || 0) + (g?.commands?.length || 0) : g?.commands?.length || 0,
    skills:   isProject ? (proj?.localSkills?.length || 0) + (g?.skills?.length || 0) : g?.skills?.length || 0,
    plans:    g?.plans?.length || 0,
    git:      State.gitStatus?.files?.length || 0,
    rules:    (isProject ? (proj?.localRules?.length || 0) : 0) + (g?.rules?.length || 0),
    agents:   (isProject ? (proj?.localAgents?.length || 0) : 0) + (g?.agents?.length || 0),
    hooks:    Object.values(g?.settings?.hooksRaw || {}).flat().reduce((n, e) => n + (e?.hooks?.length || 1), 0),
  };

  const tabBar = document.getElementById('tab-bar');
  if (!tabBar) return;

  const groups = getTabGroups();
  const label = isProject ? projectName(State.projectPath) : 'Global';

  // Aggregate badge count for a group (sum of child tab counts)
  function groupBadge(group) {
    const total = group.tabs.reduce((s, t) => s + (counts[t] || 0), 0);
    return total > 0 ? `<span class="tab-badge">${total}</span>` : '';
  }

  // Tier 1: group-level tabs
  const tier1 = groups.map(gr => {
    const active = gr.id === State.currentGroup;
    return `<div class="tab-group-item ${active ? 'active' : ''}" onclick="navigateGroup('${gr.id}')">
      <span class="tab-icon">${gr.icon}</span>${gr.label}${groupBadge(gr)}
    </div>`;
  }).join('');

  // Tier 2: sub-tabs for active group
  const activeGroup = groups.find(gr => gr.id === State.currentGroup) || groups[0];
  const tier2 = activeGroup.tabs.map(id => {
    const meta   = TAB_META[id] || { label: id };
    const active = id === State.currentTab;
    const badge  = counts[id] != null && counts[id] > 0
      ? `<span class="tab-badge">${counts[id]}</span>` : '';
    return `<div class="tab-sub-item ${active ? 'active' : ''}" onclick="navigate('${id}')">
      ${meta.label}${badge}
    </div>`;
  }).join('');

  tabBar.innerHTML = `
    <div class="tab-tier1">
      <span class="tab-group-label" title="${isProject ? escapeAttr(State.projectPath) : '~/.claude/'}">${escapeHtml(label)}</span>
      <span class="tab-tier1-divider"></span>
      ${tier1}
    </div>
    ${activeGroup.tabs.length > 1 ? `<div class="tab-tier2">${tier2}</div>` : ''}`;
}

function renderTabContent() {
  const el = document.getElementById('tab-content');
  if (!el) return;

  if (State.currentTab === 'map' && State.mode === 'project') {
    el.innerHTML = renderMapTab();
    // Double rAF ensures layout is complete before measuring node positions for SVG lines
    requestAnimationFrame(() => { requestAnimationFrame(() => { drawMapSvgLines(); }); });
    return;
  }

  if (State.loading || State.analysisLoading) {
    el.innerHTML = renderLoading();
    return;
  }
  if (State.error)  { el.innerHTML = renderError(State.error); return; }
  if (!State.scan)  { el.innerHTML = renderEmpty(); return; }

  const renderers = {
    overview: renderOverview,
    commands: renderCommands,
    skills:   renderSkills,
    plans:    renderPlans,
    sessions: renderSessions,
    git:      renderGit,
    settings: renderSettings,
    mcp:      renderMCP,
    stats:    renderStats,
    raw:      renderRaw,
    editor:   renderEditor,
    rules:    renderRules,
    hooks:    renderHooks,
    agents:   renderAgents,
  };

  el.innerHTML = (renderers[State.currentTab] || renderEmpty)();

  // Toggle editor-active class so tray/panel are scoped to editor tab
  const mainArea = document.getElementById('main-area');
  if (mainArea) mainArea.classList.toggle('editor-active', State.currentTab === 'editor');
  if (State.currentTab === 'editor') renderTray();

  if (State.currentTab === 'git' && State.mode === 'project' && !State.gitStatus && !State.gitStatusLoading) {
    loadGitTab();
  }
  if (State.currentTab === 'stats' || State.currentTab === 'overview' || State.currentTab === 'map') {
    requestAnimationFrame(() => initStatsChart());
  }
  if (State.currentTab === 'editor') {
    setTimeout(() => initMonaco(), 0);
  }
  attachCopyButtons();
}

// ─── State renders ────────────────────────────────────────────
function renderLoading() {
  return `<div style="padding:14px 18px">
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px;margin-bottom:16px">
      ${Array(4).fill('<div class="skeleton skeleton-metric"></div>').join('')}
    </div>
    ${Array(3).fill('<div class="skeleton skeleton-card"></div>').join('')}
    <div class="skeleton skeleton-text long"></div>
    <div class="skeleton skeleton-text medium"></div>
    <div class="skeleton skeleton-text short"></div>
  </div>`;
}

function renderError(err) {
  return `<div class="error-state">
    <span class="error-icon">⚠</span>
    <h3>Failed</h3>
    <p>${escapeHtml(err?.message || String(err))}</p>
    <button class="btn-primary" onclick="doRefresh()">Retry</button>
  </div>`;
}

function renderEmpty() {
  return `<div class="empty-state">
    <div class="empty-state-icon">◈</div>
    <h3>Select a project or Global Config</h3>
    <p>Click <strong>Global Config</strong> in the sidebar to load your <code>~/.claude</code> configuration,<br>
       or click any project to inspect it.</p>
  </div>`;
}

// ─── Shared Components ────────────────────────────────────────
function renderMetricCard(label, value, sub, accent) {
  return `<div class="metric-card ${accent ? 'accent' : ''}">
    <span class="metric-value">${escapeHtml(String(value))}</span>
    <span class="metric-label">${escapeHtml(label)}</span>
    ${sub ? `<span class="metric-sub">${escapeHtml(sub)}</span>` : ''}
  </div>`;
}

function renderExpandableCard({ id, title, metaHtml, excerpt, body }) {
  const safeId = id.replace(/[^a-z0-9_-]/gi, '_');
  const rawB64 = utf8ToBase64(body || '');
  return `<div class="card" id="card-${safeId}">
    <div class="card-header" onclick="toggleCard('${safeId}')">
      <span class="card-title">${escapeHtml(title)}</span>
      <div class="card-meta">${metaHtml || ''}</div>
      <span class="expand-icon">▶</span>
    </div>
    <div class="card-excerpt">${escapeHtml(excerpt || '')}</div>
    <div class="card-body hidden" id="body-${safeId}" data-raw-b64="${escapeAttr(rawB64)}"></div>
  </div>`;
}

function toggleCard(id) {
  const card = document.getElementById(`card-${id}`);
  const body = document.getElementById(`body-${id}`);
  if (!card || !body) return;
  const isOpen = body.classList.toggle('visible');
  card.classList.toggle('expanded', isOpen);

  if (isOpen && !body.dataset.rendered) {
    body.dataset.rendered = '1';
    const raw = readMarkdownPayload(body);
    const mdDiv = document.createElement('div');
    mdDiv.className = 'markdown-body';
    try {
      mdDiv.innerHTML = renderMarkdown(raw);
      mdDiv.querySelectorAll('pre code').forEach(b => {
        if (typeof hljs !== 'undefined') hljs.highlightElement(b);
      });
    } catch { mdDiv.textContent = raw; }
    body.appendChild(mdDiv);
    attachCopyButtons(body);
  }
}

function attachCopyButtons(root) {
  const container = root || document;
  container.querySelectorAll('pre').forEach(pre => {
    if (pre.querySelector('.copy-btn')) return;
    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.textContent = 'copy';
    btn.onclick = (e) => {
      e.stopPropagation();
      navigator.clipboard?.writeText(pre.querySelector('code')?.textContent || pre.textContent || '').then(() => {
        btn.textContent = '✓ copied';
        btn.classList.add('copied');
        setTimeout(() => { btn.textContent = 'copy'; btn.classList.remove('copied'); }, 2000);
      });
    };
    pre.style.position = 'relative';
    pre.appendChild(btn);
  });
}

// ─── Sidebar — Unified Project List ───────────────────────────
function renderProjectList() {
  const el = document.getElementById('projects-list');
  if (!el) return;

  const knownProjects = State.scan?.global?.projects?.filter(p => p.verified) || [];
  const pinnedPaths   = new Set(State.pinnedProjects);
  const knownUnpinned = knownProjects.filter(p => !pinnedPaths.has(p.decodedPath));

  let html = '';

  // Global Config entry (always first)
  const isGlobal = State.mode === 'global';
  html += `<div class="sidebar-project-item global-entry ${isGlobal ? 'active' : ''}" onclick="selectGlobal()">
    <span class="proj-status-icon full">◈</span>
    <span class="proj-name">Global Config</span>
    <span class="proj-abbrev proj-abbrev-global"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg></span>
  </div>`;

  // Pinned section
  if (State.pinnedProjects.length) {
    html += `<div class="sidebar-section-label">Pinned</div>`;
    html += State.pinnedProjects.map(p => renderProjectItem(p, true)).join('');
  }

  // Known section (from scan, not pinned)
  if (knownUnpinned.length) {
    html += `<div class="sidebar-section-label">Known</div>`;
    html += knownUnpinned.map(p => renderProjectItem(p.decodedPath, false)).join('');
  }

  if (!State.pinnedProjects.length && !knownUnpinned.length) {
    html += `<span class="sidebar-hint">No projects found.<br>Click + to add one.</span>`;
  }

  el.innerHTML = html;
}

function renderProjectItem(path, pinned) {
  const name     = projectName(path);
  const isActive = State.mode === 'project' && State.projectPath === path;
  const status   = State.sidebarProjectStatuses[path] || 'loading';
  const iconClass = `proj-status-icon ${status}`;
  const icon = status === 'full' ? '◈' : status === 'partial' ? '◈' : status === 'none' ? '○' : status === 'missing' ? '✗' : '…';

  const removeBtn = pinned
    ? `<button class="remove-pin" title="Remove" onclick="event.stopPropagation();removePinnedProject('${escapeAttr(path)}')">×</button>`
    : '';

  const abbrev = projectAbbrev(name);
  return `<div class="sidebar-project-item ${isActive ? 'active' : ''}"
             onclick="selectProject('${escapeAttr(path)}')" title="${escapeAttr(path)}">
    <span class="${iconClass}">${icon}</span>
    <span class="proj-name">${escapeHtml(name)}</span>
    <span class="proj-abbrev">${escapeHtml(abbrev)}</span>
    ${removeBtn}
  </div>`;
}

// Fetch all project statuses in batches of 5
async function fetchAllProjectStatuses() {
  const knownProjects = State.scan?.global?.projects?.filter(p => p.verified).map(p => p.decodedPath) || [];
  const allPaths = [...new Set([...State.pinnedProjects, ...knownProjects])];

  // Mark all as loading
  allPaths.forEach(p => { State.sidebarProjectStatuses[p] = 'loading'; });
  renderProjectList();

  const BATCH = 5;
  for (let i = 0; i < allPaths.length; i += BATCH) {
    const batch = allPaths.slice(i, i + BATCH);
    await Promise.allSettled(batch.map(async p => {
      try {
        const r = await API.projectStatus(p);
        State.sidebarProjectStatuses[p] = r.status || 'missing';
      } catch {
        State.sidebarProjectStatuses[p] = 'missing';
      }
    }));
    renderProjectList();
  }
}

// ─── Pinned Projects API ──────────────────────────────────────
async function loadPinnedProjects() {
  try {
    const data = await API.get('/api/pinned-projects');
    State.pinnedProjects = data.projects || [];
  } catch { State.pinnedProjects = []; }
  renderProjectList();
}

function addPastedPath() {
  const input = document.getElementById('paste-path-input');
  const val = input?.value?.trim();
  if (!val) return;
  addPinnedProject(val);
  input.value = '';
}

async function addPinnedProject(path) {
  if (!path) return;
  try {
    const data = await fetch('/api/pinned-projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path })
    }).then(r => r.json());
    State.pinnedProjects = data.projects || [];
    renderProjectList();
    fetchAllProjectStatuses();
  } catch (e) { alert('Failed to add project: ' + e.message); }
}

async function removePinnedProject(path) {
  const name = projectName(path);
  if (!confirm(`Remove "${name}" from pinned projects?`)) return;
  try {
    const data = await fetch('/api/pinned-projects', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path })
    }).then(r => r.json());
    State.pinnedProjects = data.projects || [];
    renderProjectList();
  } catch (e) { alert('Failed to remove: ' + e.message); }
}

// ─── Connection Map Tab ───────────────────────────────────────
function renderMapTab() {
  if (State.analysisLoading && !State.analysis) {
    return `<div class="loading-state"><div class="spinner"></div><p>Analyzing project…</p></div>`;
  }

  const analysis = State.analysis;
  const proj     = analysis?.project;
  const conn     = analysis?.connections;

  if (!analysis) {
    return `<div class="empty-state" style="min-height:200px">
      <div class="empty-state-icon">◈</div>
      <h3>No analysis data</h3>
      <p>Could not analyze project at <code>${escapeHtml(State.projectPath)}</code></p>
    </div>`;
  }

  // Build connection definitions for SVG drawing
  State._mapConnectionDefs = [];

  // Global layer nodes
  const globalNodes = [
    { id: 'global-claude-md',  label: 'CLAUDE.md',    count: conn?.global?.claudeMd?.present ? null : null,  present: conn?.global?.claudeMd?.present },
    { id: 'global-commands',   label: 'Commands',     count: conn?.global?.commands?.count,                  present: (conn?.global?.commands?.count || 0) > 0 },
    { id: 'global-skills',     label: 'Skills',       count: conn?.global?.skills?.count,                    present: (conn?.global?.skills?.count || 0) > 0 },
    { id: 'global-hooks',      label: 'Hooks',        count: conn?.global?.hooks?.count,                     present: (conn?.global?.hooks?.count || 0) > 0 },
    { id: 'global-plugins',    label: 'Plugins',      count: conn?.global?.plugins?.count,                   present: (conn?.global?.plugins?.count || 0) > 0 },
    { id: 'global-permissions',label: 'Permissions',  count: conn?.global?.permissions?.total,               present: (conn?.global?.permissions?.total || 0) > 0 },
  ];

  // Local layer nodes
  const localNodes = [
    { id: 'local-claude-md',   label: 'CLAUDE.md',    count: null,                                           present: conn?.local?.claudeMd?.present },
    { id: 'local-settings',    label: 'settings.local', count: conn?.local?.settingsLocal?.permCount,        present: conn?.local?.settingsLocal?.present },
    { id: 'local-mcp',         label: '.mcp.json',    count: conn?.local?.mcpJson?.present ? Object.keys({}).length : null, present: conn?.local?.mcpJson?.present },
    { id: 'local-commands',    label: 'Commands',     count: conn?.local?.commands?.count,                   present: (conn?.local?.commands?.count || 0) > 0 },
    { id: 'local-registration',label: 'Registration', count: null,                                           present: proj?.inAdditionalDirectories },
  ];

  function nodeHtml(n, layer) {
    const absent = !n.present;
    const active = State.activeNodeId === n.id;
    const countStr = n.count != null ? `<span class="map-node-count">${n.count}</span>` : '';
    return `<div class="map-node ${absent ? 'absent' : ''} ${active ? 'active' : ''} map-node-${layer}"
                 id="mapnode-${n.id}"
                 data-node-id="${n.id}"
                 onclick="onMapNodeClick('${n.id}')">
      <span class="map-node-label">${escapeHtml(n.label)}</span>${countStr}
    </div>`;
  }

  // Status badge
  const statusClass = `map-status-badge ${proj?.status || 'none'}`;
  const statusLabel = { full: 'Full', partial: 'Partial', none: 'No .claude/', missing: 'Not Found' }[proj?.status] || '?';
  const sessionsStr = proj?.sessionCount ? `${proj.sessionCount} session${proj.sessionCount !== 1 ? 's' : ''}` : 'no sessions';

  const centerHtml = `<div class="map-node center-node ${State.activeNodeId === 'project-center' ? 'active' : ''}"
       id="mapnode-project-center"
       data-node-id="project-center"
       onclick="onMapNodeClick('project-center')">
    <span class="map-node-center-icon">◈</span>
    <span class="map-node-center-name">${escapeHtml(projectName(proj?.path || State.projectPath))}</span>
    <div class="map-node-center-meta">
      <span class="${statusClass}">${statusLabel}</span>
      <span class="map-node-sessions">${sessionsStr}</span>
    </div>
    <span class="map-node-center-path">${escapeHtml(proj?.path || State.projectPath)}</span>
  </div>`;

  // Register connection defs for SVG drawing (collected after render)
  globalNodes.forEach(n => {
    State._mapConnectionDefs.push({ from: `mapnode-${n.id}`, to: 'mapnode-project-center', type: n.present ? 'inherited' : 'absent' });
  });
  localNodes.forEach(n => {
    State._mapConnectionDefs.push({ from: 'mapnode-project-center', to: `mapnode-${n.id}`, type: n.present ? 'local' : 'absent' });
  });

  // Warnings
  const warnings = proj?.warnings || [];
  const warningsHtml = warnings.length
    ? `<div class="map-warnings">
        ${warnings.map(w => `
          <div class="map-warning-item ${w.level}">
            <span class="map-warning-icon">${w.level === 'error' ? '⛔' : w.level === 'warning' ? '⚠' : 'ℹ'}</span>
            <span class="map-warning-msg">${escapeHtml(w.message)}</span>
          </div>`).join('')}
      </div>` : '';

  // Detail panel
  const detailHtml = State.activeNodeId
    ? renderNodeDetailPanel(State.activeNodeId, analysis)
    : '';

  return `<div class="map-container" id="map-container">
    <svg class="map-svg-overlay" id="map-svg" aria-hidden="true"></svg>

    <div class="map-layer map-layer-top">
      ${globalNodes.map(n => nodeHtml(n, 'global')).join('')}
    </div>

    <div class="map-layer map-layer-center">
      ${centerHtml}
    </div>

    <div class="map-layer map-layer-bottom">
      ${localNodes.map(n => nodeHtml(n, 'local')).join('')}
    </div>

    ${warningsHtml}

    ${detailHtml ? `<div class="map-detail-panel">
      <div class="map-detail-header">
        <span class="map-detail-title">${getNodeTitle(State.activeNodeId, analysis)}</span>
        <button class="map-detail-close" onclick="onMapNodeClose()">✕</button>
      </div>
      <div class="map-detail-body">${detailHtml}</div>
    </div>` : ''}
  </div>
  ${renderProjectOverview()}`;
}

function getNodeTitle(nodeId, analysis) {
  const titles = {
    'global-claude-md':    'Global CLAUDE.md',
    'global-commands':     'Global Commands',
    'global-skills':       'Global Skills',
    'global-hooks':        'Global Hooks',
    'global-plugins':      'Plugins',
    'global-permissions':  'Global Permissions',
    'local-claude-md':     'Project CLAUDE.md',
    'local-settings':      'Local Permissions',
    'local-mcp':           'MCP Servers',
    'local-commands':      'Project Commands',
    'local-registration':  'Directory Registration',
    'project-center':      'Project Details',
  };
  return titles[nodeId] || nodeId;
}

function onMapNodeClick(nodeId) {
  State.activeNodeId = State.activeNodeId === nodeId ? null : nodeId;
  renderTabContent();
}

function onMapNodeClose() {
  State.activeNodeId = null;
  renderTabContent();
}

function renderNodeDetailPanel(nodeId, analysis) {
  const conn = analysis?.connections;
  const proj = analysis?.project;
  const scan = State.scan;

  switch (nodeId) {
    case 'global-claude-md': {
      const cm = scan?.global?.claudeMd;
      if (!cm?.raw) return `<p class="text-muted">No global CLAUDE.md found</p>`;
      const md = document.createElement('div');
      md.className = 'markdown-body';
      try { md.innerHTML = renderMarkdown(cm.raw || ''); } catch { md.textContent = cm.raw; }
      return md.outerHTML;
    }
    case 'global-commands': {
      const cmds = scan?.global?.commands || [];
      if (!cmds.length) return `<p class="text-muted">No global commands</p>`;
      return `<div class="cards-grid">${cmds.map(c => renderCommandCard(c, 'g_cmd_')).join('')}</div>`;
    }
    case 'global-skills': {
      const skills = scan?.global?.skills || [];
      if (!skills.length) return `<p class="text-muted">No global skills</p>`;
      return `<div class="cards-grid">${skills.map(s => renderCommandCard(s, 'g_skill_')).join('')}</div>`;
    }
    case 'global-hooks': {
      const s = scan?.global?.settings || {};
      const hooks = s.hooks || {};
      const hooksHtml = Object.entries(hooks).map(([hookType, arr]) =>
        arr.map(h => `<div class="hook-card">
          <div class="hook-card-title">${escapeHtml(hookType)}</div>
          <div class="hook-detail">
            ${h.matcher ? `<span class="hook-detail-key">Matcher</span><span class="hook-detail-value">${escapeHtml(h.matcher)}</span>` : ''}
            <span class="hook-detail-key">Command</span>
            <span class="hook-detail-value">${escapeHtml(h.command)}</span>
          </div>
        </div>`).join('')
      ).join('');
      return hooksHtml || `<p class="text-muted">No hooks configured</p>`;
    }
    case 'global-plugins': {
      const pl = scan?.global?.plugins || {};
      const installed = pl.installedPlugins || [];
      if (!installed.length) return `<p class="text-muted">No plugins installed</p>`;
      return installed.map(p => renderPluginCard(p, pl.warpPlugin)).join('');
    }
    case 'global-permissions': {
      const allow = scan?.global?.settings?.permissions?.allowParsed || [];
      if (!allow.length) return `<p class="text-muted">No global permissions</p>`;
      const rows = allow.map(p =>
        `<tr><td>${typeBadge(p.type)}</td><td class="mono">${escapeHtml(p.tool)}</td><td class="mono">${p.arg ? escapeHtml(p.arg) : '<span style="color:var(--text-muted)">—</span>'}</td></tr>`
      ).join('');
      return `<table class="data-table"><thead><tr><th>Type</th><th>Tool</th><th>Argument</th></tr></thead><tbody>${rows}</tbody></table>`;
    }
    case 'local-claude-md': {
      const lc = scan?.project?.claudeMd;
      if (!lc?.raw) return `<p class="text-muted">No project CLAUDE.md found</p>`;
      const md = document.createElement('div');
      md.className = 'markdown-body';
      try { md.innerHTML = renderMarkdown(lc.raw || ''); } catch { md.textContent = lc.raw; }
      return md.outerHTML;
    }
    case 'local-settings': {
      const perms = conn?.local?.settingsLocal;
      if (!perms?.present) return `<p class="text-muted">No settings.local.json found</p>`;
      const allow = perms.perms || scan?.project?.settingsLocal?.permissions?.allowParsed || [];
      if (!allow.length) return `<p class="text-muted">No local permissions defined</p>`;
      const rows = allow.map(p =>
        `<tr><td>${typeBadge(p.type)}</td><td class="mono">${escapeHtml(p.tool)}</td><td class="mono">${p.arg ? escapeHtml(p.arg) : '<span style="color:var(--text-muted)">—</span>'}</td></tr>`
      ).join('');
      return `<table class="data-table"><thead><tr><th>Type</th><th>Tool</th><th>Argument</th></tr></thead><tbody>${rows}</tbody></table>`;
    }
    case 'local-mcp': {
      const mcpData = conn?.local?.mcpJson;
      if (!mcpData?.present) return `<p class="text-muted">No .mcp.json found</p>`;
      const servers = mcpData.servers || [];
      if (!servers.length) return `<p class="text-muted">No MCP servers defined</p>`;
      const mcp = scan?.project?.mcpJson;
      if (mcp) return renderMcpServers(mcp);
      return `<p class="text-muted">${servers.map(escapeHtml).join(', ')}</p>`;
    }
    case 'local-commands': {
      const cmds = scan?.project?.localCommands || [];
      if (!cmds.length) return `<p class="text-muted">No project-local commands</p>`;
      return `<div class="cards-grid">${cmds.map(c => renderCommandCard(c, 'l_cmd_')).join('')}</div>`;
    }
    case 'local-registration': {
      const inDirs = proj?.inAdditionalDirectories;
      const path   = proj?.path;
      const addDirs = scan?.global?.settings?.permissions?.additionalDirectories || [];
      if (inDirs) {
        return `<div class="config-grid">
          <span class="config-key">Status</span><span class="config-value" style="color:var(--accent-teal)">✓ Registered</span>
          <span class="config-key">Path</span><span class="config-value mono">${escapeHtml(path)}</span>
          <span class="config-key">All directories</span><span class="config-value"></span>
          ${addDirs.map(d => `<span></span><span class="config-value mono" style="font-size:11px">${escapeHtml(d)}</span>`).join('')}
        </div>`;
      }
      return `<div>
        <p style="color:var(--status-none)">This project path is <strong>not</strong> listed in your global <code>additionalDirectories</code>.</p>
        <p style="font-size:12px;color:var(--text-muted);margin-top:8px">Claude Code may have limited access to this directory. Add it to <code>~/.claude/settings.json</code> under <code>permissions.additionalDirectories</code> for full access.</p>
      </div>`;
    }
    case 'project-center': {
      return `<div class="config-grid">
        <span class="config-key">Path</span><span class="config-value mono" style="font-size:11px">${escapeHtml(proj?.path || State.projectPath)}</span>
        <span class="config-key">Status</span><span class="config-value">${escapeHtml(proj?.status || '?')}</span>
        <span class="config-key">.claude/ dir</span><span class="config-value">${proj?.hasClaudeDir ? '✓ present' : '✗ absent'}</span>
        <span class="config-key">CLAUDE.md</span><span class="config-value">${proj?.hasClaudeMd ? '✓ present' : '✗ absent'}</span>
        <span class="config-key">settings.local</span><span class="config-value">${proj?.hasSettingsLocal ? '✓ present' : '✗ absent'}</span>
        <span class="config-key">.mcp.json</span><span class="config-value">${proj?.hasMcpJson ? '✓ present' : '✗ absent'}</span>
        <span class="config-key">Sessions</span><span class="config-value">${proj?.sessionCount ?? 0}</span>
        <span class="config-key">Registered</span><span class="config-value">${proj?.inAdditionalDirectories ? '✓ yes' : '✗ no'}</span>
      </div>`;
    }
    default:
      return `<p class="text-muted">No detail available</p>`;
  }
}

// ─── SVG Line Drawing ─────────────────────────────────────────
let _mapResizeObserver = null;

function drawMapSvgLines() {
  const svg       = document.getElementById('map-svg');
  const container = document.getElementById('map-container');
  if (!svg || !container) return;

  const cRect = container.getBoundingClientRect();
  console.log('[map-svg] container rect:', cRect.width, 'x', cRect.height, '| defs:', State._mapConnectionDefs.length);
  svg.setAttribute('width',  cRect.width);
  svg.setAttribute('height', cRect.height);
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  // CSS vars for colors
  const style = getComputedStyle(document.documentElement);
  const colorInherited = style.getPropertyValue('--map-line-inherited').trim() || '#00d4aa';
  const colorLocal     = style.getPropertyValue('--map-line-local').trim()     || '#4fa3e0';
  const colorAbsent    = style.getPropertyValue('--map-line-absent').trim()    || '#444c56';

  function getCenterOf(elId) {
    const el = document.getElementById(elId);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      x: r.left - cRect.left + r.width / 2,
      y: r.top  - cRect.top  + r.height / 2,
    };
  }

  State._mapConnectionDefs.forEach(def => {
    const from = getCenterOf(def.from);
    const to   = getCenterOf(def.to);
    if (!from || !to) { console.log('[map-svg] SKIP:', def.from, '->', def.to, 'from:', from, 'to:', to); return; }

    const midY = (from.y + to.y) / 2;
    const d    = `M ${from.x} ${from.y} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${to.y}`;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke-width', def.type === 'absent' ? '1' : '1.5');
    path.setAttribute('stroke-opacity', def.type === 'absent' ? '0.3' : '0.7');

    if (def.type === 'inherited') {
      path.setAttribute('stroke', colorInherited);
    } else if (def.type === 'local') {
      path.setAttribute('stroke', colorLocal);
      path.setAttribute('stroke-dasharray', '4 3');
    } else {
      path.setAttribute('stroke', colorAbsent);
      path.setAttribute('stroke-dasharray', '3 3');
    }
    svg.appendChild(path);
  });

  // ResizeObserver to redraw on resize
  if (!_mapResizeObserver) {
    _mapResizeObserver = new ResizeObserver(() => {
      if (State.currentTab === 'map') drawMapSvgLines();
    });
  }
  _mapResizeObserver.disconnect();
  _mapResizeObserver.observe(container);
}

// ─── Overview Tab ─────────────────────────────────────────────
function renderOverview() {
  const isProject = State.mode === 'project';
  return isProject ? renderProjectOverview() : renderGlobalOverview();
}

function renderGlobalOverview() {
  const g = State.scan.global;
  const s = g.settings || {};
  const stats = g.stats;
  const perms = s.permissions?.allow?.length || 0;
  const plugins = Object.values(s.enabledPlugins || {}).filter(Boolean).length;
  const projects = g.projects?.length || 0;
  const hooksCount = Object.values(s.hooks || {}).reduce((a, arr) => a + arr.length, 0);

  const daily = stats?.dailyActivity || [];
  const totalMsgs     = daily.reduce((acc, d) => acc + d.messageCount, 0);
  const totalSessions = stats?.totalSessions || daily.reduce((acc, d) => acc + d.sessionCount, 0);
  const totalTools    = daily.reduce((acc, d) => acc + d.toolCallCount, 0);
  const activeDays    = daily.length;

  const usageRow = stats ? `
    <div class="dashboard-section-label">Usage</div>
    <div class="metrics-row">
      ${renderMetricCard('Messages', formatNum(totalMsgs), 'all time', true)}
      ${renderMetricCard('Sessions', formatNum(totalSessions), 'all time')}
      ${renderMetricCard('Tool Calls', formatNum(totalTools), 'all time')}
      ${renderMetricCard('Active Days', activeDays, 'with activity')}
    </div>` : '';

  const configRow = `
    <div class="dashboard-section-label">Configuration</div>
    <div class="metrics-row">
      ${renderMetricCard('Commands', g.commands?.length || 0, 'slash commands')}
      ${renderMetricCard('Skills', g.skills?.length || 0, 'in skills/')}
      ${renderMetricCard('Permissions', perms, 'allow-list')}
      ${renderMetricCard('Hooks', hooksCount, 'configured')}
      ${renderMetricCard('Plugins', plugins, 'enabled')}
      ${renderMetricCard('Projects', projects, 'known')}
    </div>`;

  const chartHtml = daily.length ? `
    <div class="section">
      <div class="section-title">Activity — last ${Math.min(daily.length, 30)} days</div>
      <canvas id="stats-chart" height="200"></canvas>
      <div class="chart-legend">
        <div class="legend-item"><span class="legend-dot" style="background:#00d4aa"></span>Messages</div>
        <div class="legend-item"><span class="legend-dot" style="background:#9b59b6"></span>Tool Calls</div>
      </div>
    </div>` : '';

  const modelHtml = renderModelUsageSection(stats);
  const hourHtml  = renderHourlyHeatmap(stats);

  const configGrid = `<div class="section">
    <div class="section-title">Settings</div>
    <div class="config-grid">
      <span class="config-key">Model</span><span class="config-value">${escapeHtml(s.model || '—')}</span>
      <span class="config-key">Effort</span><span class="config-value">${escapeHtml(s.effortLevel || '—')}</span>
      <span class="config-key">Plugins</span><span class="config-value">${Object.keys(s.enabledPlugins || {}).join(', ') || '—'}</span>
      ${stats?.firstSessionDate ? `<span class="config-key">First session</span><span class="config-value">${formatDate(stats.firstSessionDate)}</span>` : ''}
      <span class="config-key">Last scan</span><span class="config-value">${timeSince(State.scan.meta?.scannedAt)}</span>
    </div>
  </div>`;

  const claudeMdHtml = g.claudeMd
    ? `<div class="section">
        <div class="claude-md-preview" onclick="toggleClaudeMdFull()">
          <div class="section-title" style="margin-bottom:8px">CLAUDE.md — Global Instructions</div>
          <div id="claude-md-excerpt" class="markdown-body" style="font-size:12px;padding-top:0">
            ${g.claudeMd.excerpt ? escapeHtml(g.claudeMd.excerpt) : '<em>empty</em>'}
          </div>
          <div id="claude-md-full" class="markdown-body" style="display:none"></div>
          <div class="claude-md-toggle">▼ Expand full CLAUDE.md</div>
        </div>
      </div>` : '';

  const addDirs = s.permissions?.additionalDirectories || [];
  const addDirsHtml = addDirs.length
    ? `<div class="section">
        <div class="section-title">Additional Directories (${addDirs.length})</div>
        <div class="dir-list">${addDirs.map(d => `<div class="dir-item">${escapeHtml(d)}</div>`).join('')}</div>
      </div>` : '';

  const visibleProjects = (g.projects || []).filter(p => p.verified).slice(0, 20);
  const projectsHtml = visibleProjects.length
    ? `<div class="section">
        <div class="section-title">Known Projects (${visibleProjects.length})</div>
        <div class="project-list-grid">
          ${visibleProjects.map(p => `
            <div class="project-card" onclick="selectProject('${escapeAttr(p.decodedPath)}')">
              <div class="project-card-path">${escapeHtml(p.decodedPath)}</div>
              <div class="project-card-meta">
                <span class="${p.verified ? 'dot-verified' : 'dot-unverified'}">● ${p.verified ? 'verified' : 'not found'}</span>
                ${p.hasLocalClaude ? '<span>has .claude/</span>' : ''}
                ${p.sessionCount ? `<span>${p.sessionCount} session${p.sessionCount > 1 ? 's' : ''}</span>` : ''}
              </div>
            </div>`).join('')}
        </div>
      </div>` : '';

  const hasSideStats = modelHtml || hourHtml;
  const statsLayout = (chartHtml && hasSideStats)
    ? `<div class="dashboard-two-col">
        <div class="dashboard-col-main">${chartHtml}</div>
        <div class="dashboard-col-side">${modelHtml}${hourHtml}</div>
      </div>`
    : `${chartHtml}${modelHtml}${hourHtml}`;

  // Tool usage (from stats tab)
  const toolHtml = stats ? (State.statsToolData
    ? renderToolBreakdown(State.statsToolData.toolUsage, `${State.statsToolData.sessionsScanned} sessions scanned`)
    : `<div class="section">
        <div class="section-title">Tool Usage</div>
        <button class="btn-secondary" onclick="loadToolStats()" ${State.statsToolLoading ? 'disabled' : ''}>
          ${State.statsToolLoading ? 'Scanning sessions…' : 'Load Tool Analytics'}
        </button>
      </div>`) : '';

  // Daily detail table (from stats tab)
  const sorted = [...daily].sort((a, b) => b.date.localeCompare(a.date));
  const dailyTableHtml = sorted.length ? `<div class="section">
    <div class="section-title">Daily Detail</div>
    <table class="data-table">
      <thead><tr>
        <th>Date</th>
        <th style="text-align:right">Messages</th>
        <th style="text-align:right">Tool Calls</th>
        <th style="text-align:right">Sessions</th>
      </tr></thead>
      <tbody>${sorted.slice(0, 30).map(d =>
        `<tr>
          <td style="color:var(--text-secondary)">${d.date}</td>
          <td style="text-align:right">${formatNum(d.messageCount)}</td>
          <td style="text-align:right">${formatNum(d.toolCallCount)}</td>
          <td style="text-align:right">${d.sessionCount}</td>
        </tr>`
      ).join('')}</tbody>
    </table>
  </div>` : '';

  return `
    ${usageRow}
    ${configRow}
    ${statsLayout}
    ${State.statsToolData ? `<div class="section"><div class="section-title">Tool Usage</div>${toolHtml}</div>` : toolHtml}
    ${configGrid}
    ${claudeMdHtml}
    ${addDirsHtml}
    ${dailyTableHtml}
    ${projectsHtml}
  `;
}

function renderProjectOverview() {
  const g    = State.scan.global;
  const proj = State.scan.project;
  const a    = State.analysis;
  const ap   = a?.project;
  const conn = a?.connections;

  // Project-specific counts
  const localSkills   = proj?.localSkills?.length   || conn?.local?.skills?.count   || 0;
  const localCommands = proj?.localCommands?.length  || conn?.local?.commands?.count || 0;
  const localPerms    = conn?.local?.settingsLocal?.permCount || proj?.settingsLocal?.permissions?.allow?.length || 0;
  const mcpServers    = proj?.mcpJson ? Object.keys(proj.mcpJson.mcpServers || {}).length : 0;
  const sessionCount  = ap?.sessionCount || 0;
  const status        = ap?.status || 'none';

  // Status label
  const statusLabels = { full: 'Full Setup', partial: 'Partial', none: 'No .claude/', missing: 'Not Found' };

  const metricsRow = `
    <div class="dashboard-section-label">${escapeHtml(proj?.projectName || projectName(State.projectPath))}</div>
    <div class="metrics-row">
      ${renderMetricCard('Status', statusLabels[status] || status, '', status === 'full')}
      ${renderMetricCard('Sessions', formatNum(sessionCount), 'conversations')}
      ${renderMetricCard('Skills', localSkills, 'project-local')}
      ${renderMetricCard('Commands', localCommands, 'project-local')}
      ${renderMetricCard('Permissions', localPerms, 'local allow-list')}
      ${renderMetricCard('MCP Servers', mcpServers, 'configured')}
    </div>`;

  // Project config grid
  const configGrid = `<div class="section">
    <div class="section-title">Project Configuration</div>
    <div class="config-grid">
      <span class="config-key">Path</span><span class="config-value" style="font-family:var(--font-mono);font-size:11px">${escapeHtml(proj?.path || State.projectPath)}</span>
      <span class="config-key">.claude/ dir</span><span class="config-value">${ap?.hasClaudeDir || proj?.hasClaudeDir ? '✓ present' : '✗ absent'}</span>
      <span class="config-key">CLAUDE.md</span><span class="config-value">${ap?.hasClaudeMd || proj?.claudeMd ? '✓ present' : '✗ absent'}</span>
      <span class="config-key">settings.local</span><span class="config-value">${ap?.hasSettingsLocal || proj?.settingsLocal ? '✓ present' : '✗ absent'}</span>
      <span class="config-key">.mcp.json</span><span class="config-value">${ap?.hasMcpJson || proj?.mcpJson ? '✓ present' : '✗ absent'}</span>
      <span class="config-key">Registered</span><span class="config-value">${ap?.inAdditionalDirectories ? '✓ in additionalDirectories' : '✗ not registered'}</span>
    </div>
  </div>`;

  // Project CLAUDE.md
  const projClaudeMd = proj?.claudeMd;
  const claudeMdHtml = projClaudeMd
    ? `<div class="section">
        <div class="claude-md-preview" onclick="toggleClaudeMdFull()">
          <div class="section-title" style="margin-bottom:8px">CLAUDE.md — Project Instructions</div>
          <div id="claude-md-excerpt" class="markdown-body" style="font-size:12px;padding-top:0">
            ${projClaudeMd.excerpt ? escapeHtml(projClaudeMd.excerpt) : '<em>empty</em>'}
          </div>
          <div id="claude-md-full" class="markdown-body" style="display:none"></div>
          <div class="claude-md-toggle">▼ Expand full CLAUDE.md</div>
        </div>
      </div>` : '';

  // Warnings from analysis
  const warnings = ap?.warnings || [];
  const warningsHtml = warnings.length ? `<div class="section">
    <div class="section-title">Warnings</div>
    <div class="map-warnings">
      ${warnings.map(w => `<div class="map-warning-item ${w.level}">
        <span class="map-warning-icon">${w.level === 'error' ? '⛔' : w.level === 'warning' ? '⚠' : 'ℹ'}</span>
        <span class="map-warning-msg">${escapeHtml(w.message)}</span>
      </div>`).join('')}
    </div>
  </div>` : '';

  // Local permissions summary
  const localPermsData = conn?.local?.settingsLocal?.perms || proj?.settingsLocal?.permissions?.allowParsed || [];
  const permsHtml = localPermsData.length ? `<div class="section">
    <div class="section-title">Local Permissions (${localPermsData.length})</div>
    <table class="data-table">
      <thead><tr><th>Type</th><th>Tool</th><th>Argument</th></tr></thead>
      <tbody>${localPermsData.slice(0, 10).map(p =>
        `<tr><td>${typeBadge(p.type)}</td><td class="mono">${escapeHtml(p.tool)}</td><td class="mono">${p.arg ? escapeHtml(p.arg) : '<span style="color:var(--text-muted)">—</span>'}</td></tr>`
      ).join('')}${localPermsData.length > 10 ? `<tr><td colspan="3" style="color:var(--text-muted);font-style:italic">… and ${localPermsData.length - 10} more (see Settings tab)</td></tr>` : ''}</tbody>
    </table>
  </div>` : '';

  // MCP servers
  const mcpData = proj?.mcpJson;
  const mcpHtml = mcpData ? `<div class="section">
    <div class="section-title">MCP Servers</div>
    ${renderMcpServers(mcpData)}
  </div>` : '';

  // Inherited from global
  const gs = g.settings || {};
  const globalHooksCount = Object.values(gs.hooks || {}).reduce((a, arr) => a + arr.length, 0);
  const inheritedHtml = `<div class="section">
    <div class="section-title">Inherited from Global</div>
    <div class="metrics-row">
      ${renderMetricCard('Commands', g.commands?.length || 0, 'global')}
      ${renderMetricCard('Skills', g.skills?.length || 0, 'global')}
      ${renderMetricCard('Permissions', gs.permissions?.allow?.length || 0, 'global allow-list')}
      ${renderMetricCard('Hooks', globalHooksCount, 'global')}
    </div>
  </div>`;

  return `
    ${metricsRow}
    ${warningsHtml}
    ${configGrid}
    ${claudeMdHtml}
    ${permsHtml}
    ${mcpHtml}
    ${inheritedHtml}
  `;
}

// ── Shared stat helpers ──
function renderModelUsageSection(stats) {
  const modelUsage = stats?.modelUsage || {};
  const modelNames = Object.keys(modelUsage);
  if (!modelNames.length) return '';
  const maxTokens = Math.max(...modelNames.map(m => (modelUsage[m].outputTokens || 0) + (modelUsage[m].inputTokens || 0)), 1);
  const rows = modelNames.map(m => {
    const u = modelUsage[m];
    const total = (u.inputTokens || 0) + (u.outputTokens || 0);
    const pct = (total / maxTokens * 100).toFixed(0);
    const colors = { 'claude-opus-4-6': '#00d4aa', 'claude-sonnet-4-6': '#4fa3e0', 'claude-haiku-4-5-20251001': '#d29921' };
    const color = colors[m] || '#9b59b6';
    const shortName = m.replace('claude-', '').replace(/-20\d+$/, '');
    return `<div class="model-usage-row">
      <span class="model-usage-name">${escapeHtml(shortName)}</span>
      <div class="model-usage-bar-bg"><div class="model-usage-bar" style="width:${pct}%;background:${color}"></div></div>
      <span class="model-usage-value">${formatTokens(u.outputTokens || 0)} out</span>
    </div>`;
  }).join('');
  return `<div class="section">
    <div class="section-title">Model Usage</div>
    <div class="model-usage-table">${rows}</div>
  </div>`;
}

function renderHourlyHeatmap(stats) {
  const hourCounts = stats?.hourCounts || {};
  if (!Object.keys(hourCounts).length) return '';
  const maxH = Math.max(...Object.values(hourCounts), 1);
  let cells = '';
  for (let h = 0; h < 24; h++) {
    const count = hourCounts[String(h)] || 0;
    const intensity = count / maxH;
    const bg = count ? `rgba(0,212,170,${(intensity * 0.8 + 0.1).toFixed(2)})` : 'var(--bg-elevated)';
    cells += `<div class="hour-cell" style="background:${bg}" title="${h}:00 — ${count} sessions">
      <span class="hour-label">${h}</span>
      ${count ? `<span class="hour-count">${count}</span>` : ''}
    </div>`;
  }
  return `<div class="section">
    <div class="section-title">Active Hours</div>
    <div class="hour-grid">${cells}</div>
  </div>`;
}

function toggleClaudeMdFull() {
  const excerpt = document.getElementById('claude-md-excerpt');
  const full    = document.getElementById('claude-md-full');
  const toggle  = document.querySelector('.claude-md-toggle');
  if (!excerpt || !full) return;
  const showing = full.style.display !== 'none';
  excerpt.style.display = showing ? '' : 'none';
  full.style.display    = showing ? 'none' : '';
  if (toggle) toggle.textContent = showing ? '▼ Expand full CLAUDE.md' : '▲ Collapse';
  if (!full.dataset.rendered) {
    full.dataset.rendered = '1';
    const raw = (State.mode === 'project'
      ? State.scan.project?.claudeMd?.raw
      : State.scan.global?.claudeMd?.raw) || '';
    try { full.innerHTML = renderMarkdown(raw); }
    catch { full.textContent = raw; }
    attachCopyButtons(full);
  }
}

// ─── Commands Tab ─────────────────────────────────────────────
function renderCommands() {
  const globalCommands = State.scan.global.commands || [];
  const localCommands  = State.scan.project?.localCommands || [];
  const isProject      = State.mode === 'project';
  const totalCount     = globalCommands.length + (isProject ? localCommands.length : 0);
  const sm             = State.shareMode;
  const selCount       = State.shareItems.size;

  const q = State.commandFilter.toLowerCase();
  const filterCmd = c => !q || c.name.toLowerCase().includes(q) || c.excerpt.toLowerCase().includes(q) || c.body.toLowerCase().includes(q);
  const filteredGlobal = globalCommands.filter(filterCmd);
  const filteredLocal  = localCommands.filter(filterCmd);

  const localSection = isProject && localCommands.length ? `
    <div class="section-row">
      <div class="section-title">Project-local Commands</div>
      <button class="btn-icon cmd-share-all-btn" onclick="shareCommandSet('local', this)" title="Copy all project commands as shareable JSON">
        ↓ .zip (${localCommands.length})
      </button>
    </div>
    <div class="cards-grid">
      ${filteredLocal.length
        ? filteredLocal.map(c => renderCommandCard(c, 'lcmd_', 'project')).join('')
        : `<div class="empty-state" style="min-height:80px"><p>No local commands match "<strong>${escapeHtml(q)}</strong>"</p></div>`}
    </div>` : '';

  const globalSectionLabel = isProject && localCommands.length
    ? `<div class="section-row">
        <div class="section-title">Global Commands</div>
        <button class="btn-icon cmd-share-all-btn" onclick="shareCommandSet('global', this)" title="Copy all global commands as shareable JSON">
          ↓ .zip (${globalCommands.length})
        </button>
      </div>`
    : '';

  const globalSection = `
    ${globalSectionLabel}
    <div class="cards-grid">
      ${filteredGlobal.length
        ? filteredGlobal.map(c => renderCommandCard(c, 'cmd_', 'global')).join('')
        : globalCommands.length
          ? `<div class="empty-state" style="min-height:80px"><p>No global commands match "<strong>${escapeHtml(q)}</strong>"</p></div>`
          : `<div class="empty-state" style="min-height:80px"><p>No global commands</p></div>`}
    </div>`;

  const shareAllBtn = !isProject && globalCommands.length
    ? `<button class="btn-icon cmd-share-all-btn" onclick="shareCommandSet('global', this)" title="Download all commands as .zip">↓ .zip</button>`
    : '';

  return `<div>
    <div class="tab-header">
      <h2>Commands <span class="badge">${totalCount}</span></h2>
      <div style="display:flex;gap:6px;align-items:center">
        <input class="search-input" placeholder="Filter commands…"
               value="${escapeAttr(State.commandFilter)}"
               oninput="State.commandFilter=this.value;renderTabContent()">
        <button class="btn-icon${sm ? ' active' : ''}" onclick="toggleShareMode()" title="${sm ? 'Cancel share' : 'Share commands'}">⇥ Share</button>
      </div>
    </div>
    ${sm ? renderShareBar(selCount, 'commands') : ''}
    ${localSection}
    ${globalSection}
  </div>`;
}

function renderCommandCard(c, prefix = '', scope = 'global') {
  const sm = State.shareMode;
  const key = `command:${scope}:${c.name}`;
  const checked = State.shareItems.has(key);
  const shareBtn = sm ? '' : `<button class="btn-icon card-share-btn" onclick="event.stopPropagation();shareItemDirect('command','${escapeAttr(c.name)}','${scope}')" title="Share to project">⇥</button>`;
  const metaHtml = [
    c.hasArgs ? `<span class="type-badge args">$ARGS</span>` : '',
    shareBtn,
    `<span style="font-size:11px;color:var(--text-muted)">${c.wordCount}w</span>`
  ].join('');
  const card = renderExpandableCard({
    id: prefix + c.name,
    title: c.name,
    metaHtml,
    excerpt: c.excerpt,
    body: c.body
  });
  if (!sm) return card;
  return `<div class="share-card-wrapper${checked ? ' selected' : ''}" onclick="toggleShareItem('command','${escapeAttr(c.name)}','${scope}',event)">
    <label class="share-checkbox"><input type="checkbox" ${checked ? 'checked' : ''} onclick="event.stopPropagation();toggleShareItem('command','${escapeAttr(c.name)}','${scope}',event)"></label>
    ${card}
  </div>`;
}

// ─── Skills Tab (Enhanced) ────────────────────────────────────
function renderSkills() {
  const globalSkills = State.scan.global.skills || [];
  const localSkills  = State.scan.project?.localSkills || [];
  const isProject    = State.mode === 'project';
  const totalCount   = globalSkills.length + localSkills.length;

  const q = State.skillFilter.toLowerCase();
  const filterSkill = s => !q || s.name.toLowerCase().includes(q) ||
    (s.meta?.description || '').toLowerCase().includes(q) || s.excerpt.toLowerCase().includes(q);
  const filteredGlobal = globalSkills.filter(filterSkill);
  const filteredLocal  = localSkills.filter(filterSkill);

  const globalNames = new Set(globalSkills.map(s => s.name));
  const localNames  = new Set(localSkills.map(s => s.name));

  const comparisonHtml = isProject && (globalSkills.length || localSkills.length) ? `
    <div class="section" style="margin-bottom:16px">
      <div class="section-title">Skill Comparison</div>
      <div class="skill-comparison">
        ${[...new Set([...globalNames, ...localNames])].sort().map(name => {
          const inGlobal = globalNames.has(name);
          const inLocal  = localNames.has(name);
          const scope = inGlobal && inLocal ? 'both' : inGlobal ? 'global' : 'local';
          const label = scope === 'both' ? 'Both' : scope === 'global' ? 'Global' : 'Project';
          return `<div class="skill-comparison-row">
            <span class="skill-scope-badge ${scope}">${label}</span>
            <span style="color:var(--text-primary)">${escapeHtml(name)}</span>
          </div>`;
        }).join('')}
      </div>
    </div>` : '';

  if (!totalCount) {
    return `<div>
      <div class="tab-header"><h2>Skills <span class="badge">0</span></h2>
        <button class="btn-icon" onclick="openImportModal('skill')" title="Import">↑ Import</button>
      </div>
      <div class="empty-state" style="min-height:200px">
        <div class="empty-state-icon">◻</div>
        <h3>No skills configured</h3>
        <p>Create skills in <span class="inline-code">~/.claude/skills/</span> or import from a teammate.</p>
      </div>
    </div>`;
  }

  const sm       = State.shareMode;
  const selCount = State.shareItems.size;

  return `<div>
    <div class="tab-header">
      <h2>Skills <span class="badge">${totalCount}</span></h2>
      <div style="display:flex;gap:6px;align-items:center">
        <input class="search-input" placeholder="Filter skills…"
               value="${escapeAttr(State.skillFilter)}"
               oninput="State.skillFilter=this.value;renderTabContent()">
        <button class="btn-icon${sm ? ' active' : ''}" onclick="toggleShareMode()" title="${sm ? 'Cancel share' : 'Share skills'}">⇥ Share</button>
        <button class="btn-icon" onclick="openImportModal('skill')" title="Import">↑ Import</button>
        <button class="btn-icon" onclick="openBundleModal()" title="Export Bundle">↓ Export</button>
      </div>
    </div>
    ${sm ? renderShareBar(selCount, 'skills') : ''}
    ${comparisonHtml}
    ${isProject && filteredLocal.length ? `
      <div class="skill-scope-label">Project Skills (${filteredLocal.length})</div>
      <div class="cards-grid" style="margin-bottom:16px">
        ${filteredLocal.map(s => renderSkillCard(s, 'lskill_', 'project')).join('')}
      </div>` : ''}
    <div class="skill-scope-label">${isProject ? 'Global' : 'All'} Skills (${filteredGlobal.length})</div>
    <div class="cards-grid">
      ${filteredGlobal.length
        ? filteredGlobal.map(s => renderSkillCard(s, 'gskill_', 'global')).join('')
        : `<div class="empty-state" style="min-height:80px"><p>No global skills${q ? ' matching filter' : ''}</p></div>`}
    </div>
  </div>`;
}

function renderSkillCard(skill, prefix, scope) {
  const sm     = State.shareMode;
  const key    = `skill:${scope}:${skill.name}`;
  const checked = State.shareItems.has(key);
  const m      = skill.meta || {};
  const safeId = (prefix + skill.name).replace(/[^a-z0-9_-]/gi, '_');
  const rawB64 = utf8ToBase64(skill.body || '');
  const badges = [];
  if (m.userInvocable) badges.push('<span class="skill-badge invocable">user-invocable</span>');
  if (m.agent) badges.push(`<span class="skill-badge agent">agent: ${escapeHtml(m.agent)}</span>`);
  if (m.argumentHint) badges.push(`<span class="skill-badge args">$ARGS: ${escapeHtml(m.argumentHint)}</span>`);
  if (m.disableModelInvocation) badges.push('<span class="skill-badge no-model">no-model</span>');
  if (skill.isFolder) badges.push('<span class="skill-badge" style="background:var(--bg-surface);color:var(--text-muted)">folder</span>');

  const toolsHtml = m.allowedTools?.length
    ? `<div class="skill-tools-row">${m.allowedTools.map(t => `<span class="skill-tool-badge">${escapeHtml(t)}</span>`).join('')}</div>`
    : '';

  const cardHtml = `<div class="skill-card" id="card-${safeId}">
    <div class="skill-card-header" onclick="${sm ? `toggleShareItem('skill','${escapeAttr(skill.name)}','${scope}',event)` : `toggleSkillBody('${safeId}')`}">
      <div style="flex:1;min-width:0">
        <div class="skill-card-title">${escapeHtml(m.displayName || skill.name)}</div>
        ${m.description ? `<div class="skill-card-desc">${escapeHtml(m.description)}</div>` : `<div class="skill-card-desc">${escapeHtml(skill.excerpt)}</div>`}
      </div>
      <div class="skill-card-actions">
        ${sm ? '' : `
        <button class="btn-icon card-share-btn" onclick="event.stopPropagation();shareItemDirect('skill','${escapeAttr(skill.name)}','${scope}')" title="Share to project">⇥</button>
        <button class="btn-icon card-share-btn" onclick="event.stopPropagation();exportSkill('${escapeAttr(skill.name)}','${scope}')" title="Export">↓</button>
        <button class="btn-icon card-share-btn card-delete-btn" onclick="event.stopPropagation();deleteSkill('${escapeAttr(skill.name)}','${scope}')" title="Delete skill">✕</button>`}
        <span style="font-size:11px;color:var(--text-muted)">${skill.wordCount}w</span>
      </div>
    </div>
    ${badges.length ? `<div class="skill-meta-row">${badges.join('')}</div>` : ''}
    ${toolsHtml}
    <div class="skill-card-body hidden" id="body-${safeId}" data-raw-b64="${escapeAttr(rawB64)}"></div>
  </div>`;

  if (!sm) return cardHtml;
  return `<div class="share-card-wrapper${checked ? ' selected' : ''}" onclick="toggleShareItem('skill','${escapeAttr(skill.name)}','${scope}',event)">
    <label class="share-checkbox"><input type="checkbox" ${checked ? 'checked' : ''} onclick="event.stopPropagation();toggleShareItem('skill','${escapeAttr(skill.name)}','${scope}',event)"></label>
    ${cardHtml}
  </div>`;
}

function toggleSkillBody(id) {
  const body = document.getElementById(`body-${id}`);
  if (!body) return;
  const isOpen = body.classList.toggle('visible');
  body.classList.toggle('hidden', !isOpen);
  if (isOpen && !body.dataset.rendered) {
    body.dataset.rendered = '1';
    const mdDiv = document.createElement('div');
    mdDiv.className = 'markdown-body';
    try {
      mdDiv.innerHTML = renderMarkdown(readMarkdownPayload(body));
      mdDiv.querySelectorAll('pre code').forEach(b => { if (typeof hljs !== 'undefined') hljs.highlightElement(b); });
    } catch { mdDiv.textContent = readMarkdownPayload(body); }
    body.appendChild(mdDiv);
    attachCopyButtons(body);
  }
}

// ─── Share Logic ──────────────────────────────────────────────

function renderShareBar(selCount, type) {
  return `<div class="share-action-bar">
    <span class="share-action-label">${selCount > 0 ? `${selCount} ${type} selected` : `Select ${type} to share`}</span>
    <div style="display:flex;gap:6px;margin-left:auto">
      <button class="btn-secondary" onclick="selectAllShareItems('${type}')">Select All</button>
      <button class="btn-primary" onclick="openShareModal()" ${selCount === 0 ? 'disabled' : ''}>Share to Project →</button>
    </div>
  </div>`;
}

function toggleShareMode() {
  State.shareMode = !State.shareMode;
  State.shareItems = new Map();
  renderTabContent();
}

// Quick-share a single item without entering full share mode
function shareItemDirect(type, name, scope) {
  State.shareItems = new Map();
  State.shareItems.set(`${type}:${scope}:${name}`, {
    name, type, scope,
    sourceProject: State.projectPath || null
  });
  openShareModal();
}

function toggleShareItem(type, name, scope, e) {
  if (e) e.stopPropagation();
  const key = `${type}:${scope}:${name}`;
  if (State.shareItems.has(key)) {
    State.shareItems.delete(key);
  } else {
    State.shareItems.set(key, { name, type, scope, sourceProject: State.projectPath || null });
  }
  renderTabContent();
}

function selectAllShareItems(tabType, scopeFilter) {
  let type, globalList, localList;
  if (tabType === 'skills') {
    type = 'skill';
    globalList = State.scan?.global?.skills || [];
    localList  = State.scan?.project?.localSkills || [];
  } else if (tabType === 'rule') {
    type = 'rule';
    globalList = State.scan?.global?.rules || [];
    localList  = State.scan?.project?.localRules || [];
  } else if (tabType === 'agent') {
    type = 'agent';
    globalList = State.scan?.global?.agents || [];
    localList  = State.scan?.project?.localAgents || [];
  } else {
    type = 'command';
    globalList = State.scan?.global?.commands || [];
    localList  = State.scan?.project?.localCommands || [];
  }

  if (!scopeFilter || scopeFilter === 'global') {
    globalList.forEach(item => {
      const key = `${type}:global:${item.name}`;
      State.shareItems.set(key, { name: item.name, type, scope: 'global', sourceProject: null });
    });
  }
  if (!scopeFilter || scopeFilter === 'project') {
    localList.forEach(item => {
      const key = `${type}:project:${item.name}`;
      State.shareItems.set(key, { name: item.name, type, scope: 'project', sourceProject: State.projectPath || null });
    });
  }
  renderTabContent();
}

function openShareModal() {
  if (State.shareItems.size === 0) return;
  // Build project list: pinned + known, excluding current
  const pinned  = State.pinnedProjects || [];
  const known   = (State.scan?.global?.projects || []).filter(p => p.verified).map(p => p.decodedPath);
  const allProjects = [...new Set([...pinned, ...known])].filter(p => p !== State.projectPath);

  const el = document.getElementById('share-overlay');
  if (!el) return;

  const items = [...State.shareItems.values()];
  const itemList = items.slice(0, 8).map(i =>
    `<span class="share-item-chip">${escapeHtml(i.name)} <span class="share-item-type">${i.type}</span></span>`
  ).join('') + (items.length > 8 ? `<span class="share-item-chip muted">+${items.length - 8} more</span>` : '');

  document.getElementById('share-item-preview').innerHTML = itemList;
  document.getElementById('share-target-select').innerHTML =
    `<option value="">— pick a project —</option>` +
    allProjects.map(p => `<option value="${escapeAttr(p)}">${escapeHtml(projectName(p))} <small>${escapeHtml(p)}</small></option>`).join('');

  document.getElementById('share-confirm-btn').disabled = true;
  document.getElementById('share-result').innerHTML = '';
  el.classList.remove('hidden');
}

function closeShareModal() {
  document.getElementById('share-overlay')?.classList.add('hidden');
}

function onShareTargetChange() {
  const val = document.getElementById('share-target-select')?.value;
  document.getElementById('share-confirm-btn').disabled = !val;
}

async function confirmShare() {
  const targetProject = document.getElementById('share-target-select')?.value;
  if (!targetProject) return;

  const btn = document.getElementById('share-confirm-btn');
  btn.disabled = true;
  btn.textContent = 'Copying…';

  const items = [...State.shareItems.values()];
  try {
    const result = await API.share(items, targetProject);
    const resultEl = document.getElementById('share-result');
    if (result.errors?.length) {
      resultEl.innerHTML = `<span style="color:var(--accent-red)">⚠ ${result.errors.map(e => escapeHtml(e.name + ': ' + e.error)).join(', ')}</span>`;
    }
    if (result.copied?.length) {
      resultEl.innerHTML += `<span style="color:var(--accent-green)">✓ Copied ${result.copied.length} item${result.copied.length > 1 ? 's' : ''} to ${escapeHtml(projectName(targetProject))}</span>`;
      setTimeout(() => {
        closeShareModal();
        State.shareMode = false;
        State.shareItems = new Map();
        renderTabContent();
      }, 1200);
    }
  } catch (e) {
    document.getElementById('share-result').innerHTML = `<span style="color:var(--accent-red)">Error: ${escapeHtml(e.message)}</span>`;
  }
  btn.disabled = false;
  btn.textContent = 'Copy to Project';
}

async function deleteSkill(name, scope) {
  if (!confirm(`Delete skill "${name}"? This cannot be undone.`)) return;
  const projectPath = scope === 'project' ? State.projectPath : null;
  const result = await API.deleteSkill(name, scope, projectPath);
  if (result.ok) {
    doSilentRefresh();
  } else {
    alert('Delete failed: ' + (result.error || 'unknown error'));
  }
}

function exportSkill(name, scope) {
  const project = State.mode === 'project' ? State.projectPath : '';
  window.location.href = `/api/skills/export?name=${encodeURIComponent(name)}&scope=${scope}&project=${encodeURIComponent(project)}`;
}

// ─── Plans Tab ────────────────────────────────────────────────
function renderPlans() {
  const plans = State.scan.global.plans || [];
  if (!plans.length) {
    return `<div>
      <div class="tab-header"><h2>Plans <span class="badge">0</span></h2></div>
      <div class="empty-state" style="min-height:120px"><p>No plan files found in <span class="inline-code">~/.claude/plans/</span></p></div>
    </div>`;
  }
  return `<div>
    <div class="tab-header"><h2>Plans <span class="badge">${plans.length}</span></h2></div>
    <div class="cards-grid">
      ${plans.map(p => renderExpandableCard({
        id: 'plan_' + p.name,
        title: p.name,
        metaHtml: `<span style="font-size:11px;color:var(--text-muted)">${p.wordCount}w</span>`,
        excerpt: p.excerpt,
        body: p.raw
      })).join('')}
    </div>
  </div>`;
}

// ─── Settings Tab ─────────────────────────────────────────────
function renderSettings() {
  const s    = State.scan.global.settings || {};
  const proj = State.scan.project;
  const allow = s.permissions?.allowParsed || [];
  const f = State.permFilter;

  const filtered = f === 'all' ? allow : allow.filter(p => p.type === f);

  const filterBtns = ['all','bash','read','skill','mcp','other'].map(t => {
    const cnt = t === 'all' ? allow.length : allow.filter(p => p.type === t).length;
    return `<button class="filter-btn ${f === t ? 'active' : ''}" onclick="State.permFilter='${t}';renderTabContent()">${t} <span class="tab-badge">${cnt}</span></button>`;
  }).join('');

  const permRows = filtered.map(p =>
    `<tr>
      <td>${typeBadge(p.type)}</td>
      <td class="mono">${escapeHtml(p.tool)}</td>
      <td class="mono">${p.arg ? escapeHtml(p.arg) : '<span style="color:var(--text-muted)">—</span>'}</td>
    </tr>`
  ).join('');

  const hooksHtml = Object.entries(s.hooks || {}).map(([hookType, hooks]) =>
    hooks.map(h => `
      <div class="hook-card">
        <div class="hook-card-title">${escapeHtml(hookType)}</div>
        <div class="hook-detail">
          ${h.matcher ? `<span class="hook-detail-key">Matcher</span><span class="hook-detail-value">${escapeHtml(h.matcher)}</span>` : ''}
          <span class="hook-detail-key">Command</span>
          <span class="hook-detail-value">${escapeHtml(h.command)}</span>
          ${h.timeout ? `<span class="hook-detail-key">Timeout</span><span class="hook-detail-value">${h.timeout}ms</span>` : ''}
          <span class="hook-detail-key">Source</span>
          <span class="hook-detail-value">global settings.json</span>
        </div>
      </div>`
    ).join('')
  ).join('');

  const localPerms = proj?.settingsLocal?.permissions?.allowParsed || [];
  const localHtml = proj
    ? `<div class="section">
        <div class="section-title">Project-local Permissions — ${escapeHtml(proj.projectName)} (${localPerms.length})</div>
        ${localPerms.length
          ? `<table class="data-table">
              <thead><tr><th>Type</th><th>Tool</th><th>Argument</th></tr></thead>
              <tbody>${localPerms.map(p => `<tr><td>${typeBadge(p.type)}</td><td class="mono">${escapeHtml(p.tool)}</td><td class="mono">${p.arg ? escapeHtml(p.arg) : '<span style="color:var(--text-muted)">—</span>'}</td></tr>`).join('')}</tbody>
            </table>`
          : `<p style="font-size:12px;color:var(--text-muted)">No local permissions found</p>`}
      </div>` : '';

  return `<div>
    <div class="section">
      <div class="section-title">Model & Effort</div>
      <div class="config-grid">
        <span class="config-key">Model</span><span class="config-value">${escapeHtml(s.model || '—')}</span>
        <span class="config-key">Effort</span><span class="config-value">${escapeHtml(s.effortLevel || '—')}</span>
      </div>
    </div>
    <div class="section">
      <div class="section-title">Allow-list Permissions (${allow.length})</div>
      <div class="filter-bar">${filterBtns}</div>
      <table class="data-table">
        <thead><tr><th>Type</th><th>Tool</th><th>Argument</th></tr></thead>
        <tbody>${permRows}</tbody>
      </table>
    </div>
    <div class="section">
      <div class="section-title">Hooks</div>
      ${hooksHtml || `<p style="font-size:12px;color:var(--text-muted)">No hooks configured</p>`}
    </div>
    ${localHtml}
    ${proj?.claudeIgnore ? `
  <div class="section">
    <div class="section-title">.claudeignore</div>
    <pre class="code-block" style="font-size:12px;max-height:200px;overflow-y:auto">${escapeHtml(proj.claudeIgnore)}</pre>
  </div>` : ''}
  </div>`;
}

// ─── MCP & Plugins Tab ────────────────────────────────────────
function renderMCP() {
  const pl = State.scan.global.plugins || {};
  const installed = pl.installedPlugins || [];
  const warp = pl.warpPlugin;
  const proj = State.scan.project;
  const mcpJson = proj?.mcpJson;

  const pluginsHtml = installed.length
    ? installed.map(p => renderPluginCard(p, warp)).join('')
    : `<p style="font-size:12px;color:var(--text-muted)">No plugins installed</p>`;

  const mcpHtml = mcpJson
    ? renderMcpServers(mcpJson)
    : `<div class="empty-state" style="min-height:100px">
        <p>No <span class="inline-code">.mcp.json</span> found in project root.</p>
        <p style="font-size:12px;color:var(--text-muted);margin-top:6px">Load a project to check for MCP server configuration.</p>
      </div>`;

  const extraMarkets = Object.entries(State.scan.global.settings?.extraKnownMarketplaces || {});
  const marketsHtml = extraMarkets.length
    ? `<div class="dir-list">${extraMarkets.map(([id, m]) =>
        `<div class="dir-item"><strong>${escapeHtml(id)}</strong> — ${escapeHtml(m.source?.source || '')}/${escapeHtml(m.source?.repo || '')}</div>`
      ).join('')}</div>`
    : `<p style="font-size:12px;color:var(--text-muted)">None</p>`;

  return `<div>
    <div class="section">
      <div class="section-title">Installed Plugins (${installed.length})</div>
      ${pluginsHtml}
    </div>
    <div class="section">
      <div class="section-title">Extra Marketplaces</div>
      ${marketsHtml}
    </div>
    <div class="section">
      <div class="section-title">MCP Servers${proj ? ' — ' + escapeHtml(proj.projectName) : ''}</div>
      ${mcpHtml}
    </div>
  </div>`;
}

function renderPluginCard(plugin, warpData) {
  const hookRows = warpData
    ? Object.entries(warpData.hooks || {}).map(([hookType, entries]) => {
        const scripts = entries.flatMap(e => e.hooks || []).map(h => {
          const m = h.command?.match(/scripts\/([^"'\s]+)/);
          return m ? m[1] : h.command;
        });
        return `<div class="plugin-hook-row">
          <span class="hook-type-name">${escapeHtml(hookType)}</span>
          <span class="hook-script">${scripts.map(escapeHtml).join(', ')}</span>
        </div>`;
      }).join('')
    : '';

  return `<div class="plugin-card">
    <div class="plugin-header">
      <span class="plugin-icon">⚡</span>
      <div class="plugin-info">
        <div class="plugin-name">${escapeHtml(plugin.id)}</div>
        <div class="plugin-desc">${escapeHtml(warpData?.description || '')}</div>
      </div>
      <div class="plugin-meta">
        v${escapeHtml(plugin.version)}<br>
        <span style="font-size:10px;color:var(--text-muted)">${formatDate(plugin.installedAt)}</span>
      </div>
    </div>
    ${hookRows ? `<div class="plugin-body">
      <div class="plugin-hooks-title">Hooks (${Object.keys(warpData?.hooks || {}).length})</div>
      ${hookRows}
    </div>` : ''}
  </div>`;
}

function renderMcpServers(mcp) {
  const servers = mcp.mcpServers || {};
  const keys = Object.keys(servers);
  if (!keys.length) return `<p style="font-size:12px;color:var(--text-muted)">No servers defined</p>`;
  return keys.map(name => {
    const srv = servers[name];
    return `<div class="hook-card">
      <div class="hook-card-title">${escapeHtml(name)}</div>
      <div class="hook-detail">
        <span class="hook-detail-key">Command</span><span class="hook-detail-value">${escapeHtml(srv.command || '')}</span>
        ${srv.args?.length ? `<span class="hook-detail-key">Args</span><span class="hook-detail-value">${srv.args.map(escapeHtml).join(' ')}</span>` : ''}
      </div>
    </div>`;
  }).join('');
}

// ─── Stats Tab (Enhanced) ─────────────────────────────────────
function renderStats() {
  const stats = State.scan.global.stats;
  if (!stats) {
    return `<div class="empty-state" style="min-height:200px"><p>No stats-cache.json found</p></div>`;
  }

  const daily = stats.dailyActivity || [];
  const totalMsgs     = daily.reduce((s, d) => s + d.messageCount, 0);
  const totalSessions = daily.reduce((s, d) => s + d.sessionCount, 0);
  const totalTools    = daily.reduce((s, d) => s + d.toolCallCount, 0);
  const activeDays    = daily.length;

  // Model usage breakdown
  const modelUsage = stats.modelUsage || {};
  const modelNames = Object.keys(modelUsage);
  const maxModelTokens = Math.max(...modelNames.map(m => (modelUsage[m].outputTokens || 0) + (modelUsage[m].inputTokens || 0)), 1);
  const modelRows = modelNames.map(m => {
    const u = modelUsage[m];
    const total = (u.inputTokens || 0) + (u.outputTokens || 0);
    const pct = (total / maxModelTokens * 100).toFixed(0);
    const colors = { 'claude-opus-4-6': '#00d4aa', 'claude-sonnet-4-6': '#4fa3e0', 'claude-haiku-4-5-20251001': '#d29921' };
    const color = colors[m] || '#9b59b6';
    return `<div class="model-usage-row">
      <span class="model-usage-name">${escapeHtml(m)}</span>
      <div class="model-usage-bar-bg"><div class="model-usage-bar" style="width:${pct}%;background:${color}"></div></div>
      <span class="model-usage-value">${formatTokens(u.outputTokens || 0)} out</span>
    </div>`;
  }).join('');

  // Hourly heatmap
  const hourCounts = stats.hourCounts || {};
  const maxHour = Math.max(...Object.values(hourCounts), 1);
  let hourCells = '';
  for (let h = 0; h < 24; h++) {
    const count = hourCounts[String(h)] || 0;
    const intensity = count / maxHour;
    const bg = count ? `rgba(0,212,170,${(intensity * 0.8 + 0.1).toFixed(2)})` : 'var(--bg-elevated)';
    hourCells += `<div class="hour-cell" style="background:${bg}" title="${h}:00 — ${count} sessions">
      <span class="hour-label">${h}</span>
      ${count ? `<span class="hour-count">${count}</span>` : ''}
    </div>`;
  }

  // Tool usage
  const toolHtml = State.statsToolData
    ? renderToolBreakdown(State.statsToolData.toolUsage, `${State.statsToolData.sessionsScanned} sessions scanned`)
    : `<button class="btn-primary" onclick="loadToolStats()" ${State.statsToolLoading ? 'disabled' : ''}>
        ${State.statsToolLoading ? 'Scanning sessions…' : 'Load Tool Analytics'}
       </button>`;

  // Longest session
  const longest = stats.longestSession;
  const longestHtml = longest
    ? `${renderMetricCard('Longest Session', longest.messageCount + ' msgs', longest.duration ? (longest.duration / 60000).toFixed(0) + 'm' : '')}`
    : '';

  const sorted = [...daily].sort((a, b) => b.date.localeCompare(a.date));
  const tableRows = sorted.map(d =>
    `<tr>
      <td style="color:var(--text-secondary)">${d.date}</td>
      <td style="text-align:right">${formatNum(d.messageCount)}</td>
      <td style="text-align:right">${formatNum(d.toolCallCount)}</td>
      <td style="text-align:right">${d.sessionCount}</td>
    </tr>`
  ).join('');

  return `<div>
    <div class="metrics-row">
      ${renderMetricCard('Messages', formatNum(totalMsgs), 'all time', true)}
      ${renderMetricCard('Tool Calls', formatNum(totalTools), 'all time')}
      ${renderMetricCard('Sessions', formatNum(totalSessions), 'all time')}
      ${renderMetricCard('Active Days', activeDays, 'with activity')}
      ${longestHtml}
      ${stats.firstSessionDate ? renderMetricCard('First Session', formatDate(stats.firstSessionDate), '') : ''}
    </div>

    ${modelNames.length ? `<div class="section">
      <div class="section-title">Model Usage</div>
      <div class="model-usage-table">${modelRows}</div>
    </div>` : ''}

    <div class="section">
      <div class="section-title">Activity by Hour</div>
      <div class="hour-grid">${hourCells}</div>
    </div>

    <div class="section">
      <div class="stats-chart-wrap">
        <div class="stats-chart-title">Daily Activity — last ${Math.min(daily.length, 30)} days</div>
        <canvas id="stats-chart" height="280"></canvas>
        <div class="chart-legend">
          <div class="legend-item"><span class="legend-dot" style="background:#00d4aa"></span>Messages</div>
          <div class="legend-item"><span class="legend-dot" style="background:#9b59b6"></span>Tool Calls</div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Tool Usage</div>
      ${toolHtml}
    </div>

    <div class="section">
      <div class="section-title">Daily Detail</div>
      <table class="data-table">
        <thead><tr>
          <th>Date</th>
          <th style="text-align:right">Messages</th>
          <th style="text-align:right">Tool Calls</th>
          <th style="text-align:right">Sessions</th>
        </tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
  </div>`;
}

function formatTokens(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

function renderToolBreakdown(toolUsage, subtitle) {
  const entries = Object.entries(toolUsage).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return `<p style="font-size:12px;color:var(--text-muted)">No tool usage data</p>`;
  const maxCount = entries[0][1];
  return `<p style="font-size:11px;color:var(--text-muted);margin-bottom:8px">${escapeHtml(subtitle)}</p>
    <div class="tool-breakdown-list">
      ${entries.map(([name, count]) => {
        const pct = (count / maxCount * 100).toFixed(0);
        return `<div class="tool-breakdown-row">
          <span class="tool-breakdown-name">${escapeHtml(name)}</span>
          <div class="tool-breakdown-bar-bg"><div class="tool-breakdown-bar" style="width:${pct}%"></div></div>
          <span class="tool-breakdown-count">${formatNum(count)}</span>
        </div>`;
      }).join('')}
    </div>`;
}

async function loadToolStats() {
  State.statsToolLoading = true;
  renderTabContent();
  try {
    const project = State.mode === 'project' ? State.projectPath : null;
    State.statsToolData = await API.toolStats(project);
  } catch (e) {
    State.statsToolData = { toolUsage: {}, sessionsScanned: 0, error: e.message };
  }
  State.statsToolLoading = false;
  renderTabContent();
  requestAnimationFrame(() => initStatsChart());
}

function initStatsChart() {
  const canvas = document.getElementById('stats-chart');
  if (!canvas) return;
  const stats = State.scan?.global?.stats;
  if (!stats?.dailyActivity?.length) return;

  const daily = [...stats.dailyActivity].sort((a, b) => a.date.localeCompare(b.date)).slice(-30);
  drawStatsChart(canvas, daily);

  const resizeObs = new ResizeObserver(() => drawStatsChart(canvas, daily));
  resizeObs.observe(canvas.parentElement);
}

function drawStatsChart(canvas, daily) {
  const ctx = canvas.getContext('2d');
  const W   = canvas.offsetWidth || 600;
  const H   = parseInt(canvas.getAttribute('height')) || 280;
  canvas.width  = W;
  canvas.height = H;
  const PAD = { top: 20, right: 20, bottom: 40, left: 56 };
  const cW  = W - PAD.left - PAD.right;
  const cH  = H - PAD.top  - PAD.bottom;
  const n   = daily.length;
  if (!n) return;

  const msgs  = daily.map(d => d.messageCount);
  const tools = daily.map(d => d.toolCallCount);
  const maxY  = Math.max(...msgs, ...tools, 1);

  const toX = i => PAD.left + (i / Math.max(n - 1, 1)) * cW;
  const toY = v => PAD.top + cH - (v / maxY) * cH;

  ctx.clearRect(0, 0, W, H);

  ctx.strokeStyle = 'rgba(48,54,61,0.8)';
  ctx.lineWidth   = 1;
  for (let i = 0; i <= 4; i++) {
    const y = PAD.top + (cH / 4) * i;
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + cW, y); ctx.stroke();
    const val = Math.round(maxY * (1 - i / 4));
    ctx.fillStyle = '#656d76';
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(formatNum(val), PAD.left - 6, y + 4);
  }

  function drawFilledLine(values, strokeColor, r, g, b) {
    ctx.beginPath();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    values.forEach((v, i) => {
      i === 0 ? ctx.moveTo(toX(i), toY(v)) : ctx.lineTo(toX(i), toY(v));
    });
    ctx.stroke();
    ctx.lineTo(toX(n - 1), toY(0));
    ctx.lineTo(toX(0), toY(0));
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + cH);
    grad.addColorStop(0, `rgba(${r},${g},${b},0.18)`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = grad;
    ctx.fill();
  }

  drawFilledLine(msgs,  '#00d4aa', 0, 212, 170);
  drawFilledLine(tools, '#9b59b6', 155, 89, 182);

  ctx.fillStyle = '#656d76';
  ctx.font = '10px monospace';
  ctx.textAlign = 'center';
  const step = Math.ceil(n / 8);
  daily.forEach((d, i) => {
    if (i % step === 0 || i === n - 1) {
      ctx.fillText(d.date.slice(5), toX(i), H - 8);
    }
  });
}

// ─── Raw Tab ──────────────────────────────────────────────────
function renderRaw() {
  const tree = State.scan.global.fileTree;

  return `<div class="raw-layout">
    <div class="file-tree" id="file-tree">
      ${tree ? renderTreeNode(tree, 0) : '<p style="padding:12px;font-size:12px;color:var(--text-muted)">No tree data</p>'}
    </div>
    <div class="file-viewer" id="file-viewer">
      ${State.rawFileLoading
        ? `<div class="viewer-empty"><div class="spinner"></div></div>`
        : State.rawFileContent
          ? renderFileViewer()
          : `<div class="viewer-empty">Click a file to view its contents</div>`}
    </div>
  </div>`;
}

function renderTreeNode(node, depth) {
  const indent = depth * 16;
  const isExpanded = State.fileTreeExpanded.has(node.path);
  const isActive   = node.path === State.rawSelectedPath;

  if (node.isDir) {
    const childrenHtml = isExpanded
      ? (node.children || []).map(c => renderTreeNode(c, depth + 1)).join('')
      : '';
    return `<div>
      <div class="tree-node dir ${isActive ? 'active' : ''}" style="padding-left:${8 + indent}px"
           onclick="onTreeToggle('${escapeAttr(node.path)}')">
        <span class="tree-icon">${isExpanded ? '▼' : '▶'}</span>
        <span class="tree-name">${escapeHtml(node.name)}</span>
      </div>
      ${childrenHtml}
    </div>`;
  } else {
    const icon = getFileIcon(node.name);
    return `<div class="tree-node file ${isActive ? 'active' : ''}" style="padding-left:${8 + indent}px"
         onclick="onTreeFileClick('${escapeAttr(node.path)}')">
      <span class="tree-icon">${icon}</span>
      <span class="tree-name">${escapeHtml(node.name)}</span>
      ${node.size ? `<span class="tree-size">${formatBytes(node.size)}</span>` : ''}
    </div>`;
  }
}

function getFileIcon(name) {
  if (name.endsWith('.json') || name.endsWith('.jsonl')) return '{}';
  if (name.endsWith('.md'))   return '# ';
  if (name.endsWith('.sh'))   return '$ ';
  if (name.endsWith('.js'))   return 'JS';
  return '· ';
}

function renderFileViewer() {
  const { rawSelectedPath: p, rawFileContent: fc } = State;
  if (!fc) return '';
  const lang = getLang(p);
  let displayContent = fc.content;
  let highlighted = '';
  try {
    if (lang === 'json' && !fc.truncated) {
      displayContent = JSON.stringify(JSON.parse(fc.content), null, 2);
    }
    highlighted = typeof hljs !== 'undefined'
      ? hljs.highlight(displayContent, { language: lang, ignoreIllegals: true }).value
      : escapeHtml(displayContent);
  } catch {
    highlighted = escapeHtml(displayContent);
  }

  return `
    <div class="viewer-header">
      <span class="viewer-path">${escapeHtml(p)}</span>
      <span>${formatBytes(fc.size)}</span>
      <span>${timeSince(fc.mtime)}</span>
    </div>
    <div class="viewer-body">
      <pre style="position:relative"><code class="language-${lang}">${highlighted}</code></pre>
    </div>`;
}

function getLang(p) {
  if (!p) return 'plaintext';
  if (p.endsWith('.json') || p.endsWith('.jsonl')) return 'json';
  if (p.endsWith('.md'))   return 'markdown';
  if (p.endsWith('.sh'))   return 'bash';
  if (p.endsWith('.js'))   return 'javascript';
  if (p.endsWith('.php'))  return 'php';
  return 'plaintext';
}

// ─── Editor Tab ───────────────────────────────────────────────

function renderEditor() {
  // Trigger tree load if not yet loaded for this context
  if (!State.editorFileTree && !State.editorFileTreeLoading) {
    loadEditorTree();
  }

  const treeData = State.editorFileTree;
  const filename = State.editorPath ? State.editorPath.split('/').pop() : null;
  const dirtyMark = State.editorDirty ? '<span class="editor-dirty" title="Unsaved changes"> ●</span>' : '';

  const toolbar = State.editorPath ? `
    <div class="editor-toolbar">
      <span class="editor-filename">${escapeHtml(filename)}${dirtyMark}</span>
      <span class="editor-lang-badge">${escapeHtml(getLangForMonaco(State.editorPath))}</span>
      <div style="margin-left:auto;display:flex;gap:6px">
        <button class="btn-secondary" onclick="saveEditorFile()" title="Save (⌘S)">Save</button>
      </div>
    </div>` : `
    <div class="editor-toolbar">
      <span style="color:var(--text-muted);font-size:12px">Select a file from the tree to edit</span>
    </div>`;

  const treeHtml = State.editorFileTreeLoading
    ? `<div style="padding:12px;font-size:12px;color:var(--text-muted)"><div class="spinner" style="width:14px;height:14px;margin-bottom:6px"></div>Loading…</div>`
    : treeData
      ? renderEditorTree(treeData)
      : `<div style="padding:12px;font-size:12px;color:var(--text-muted)">No files found</div>`;

  const tree = `<div class="file-tree" id="editor-file-tree">${treeHtml}</div>`;

  return `<div class="editor-pane">
    ${tree}
    <div class="editor-right">
      ${toolbar}
      <div id="monaco-container" class="monaco-container"></div>
    </div>
  </div>`;
}

async function loadEditorTree() {
  const isProject = State.mode === 'project' && State.projectPath;
  const rootPath  = isProject ? State.projectPath : null;
  const queryPath = rootPath || (State.scan?.global?.fileTree?.path) || null;
  if (!queryPath) {
    // Fall back to the global fileTree from scan
    State.editorFileTree = State.scan?.global?.fileTree || null;
    renderTabContent();
    return;
  }
  State.editorFileTreeLoading = true;
  renderTabContent();
  try {
    const data = await API.fileTree(queryPath, rootPath);
    State.editorFileTree = data.tree || null;
  } catch {
    // Fall back to global tree on error
    State.editorFileTree = State.scan?.global?.fileTree || null;
  }
  State.editorFileTreeLoading = false;
  renderTabContent();
}

function renderEditorTree(node, depth = 0) {
  if (!node) return '';
  const indent = depth * 12;
  if (!node.isDir) {
    const active = State.editorPath === node.path ? ' active' : '';
    return `<div class="editor-tree-file${active}" style="padding-left:${8 + indent}px" onclick="openEditorFile('${escapeAttr(node.path)}')" title="${escapeAttr(node.path)}">
      <span style="opacity:.5;font-size:10px">◻</span> ${escapeHtml(node.name)}
    </div>`;
  }
  // Directory
  const expanded = State.fileTreeExpanded.has(node.path);
  const children = expanded && node.children?.length
    ? node.children.map(c => renderEditorTree(c, depth + 1)).join('')
    : '';
  return `<div>
    <div class="editor-tree-dir" style="padding-left:${8 + indent}px;padding:4px 8px 4px ${8 + indent}px;font-size:12px;cursor:pointer;color:var(--text-secondary);display:flex;align-items:center;gap:4px" onclick="onTreeToggle('${escapeAttr(node.path)}')">
      <span style="font-size:9px">${expanded ? '▼' : '▶'}</span>
      <span style="opacity:.6;font-size:11px">📁</span> <strong>${escapeHtml(node.name)}</strong>
    </div>
    ${expanded ? `<div>${children}</div>` : ''}
  </div>`;
}

function getLangForMonaco(p) {
  if (!p) return 'plaintext';
  if (p.endsWith('.json') || p.endsWith('.jsonl')) return 'json';
  if (p.endsWith('.md'))   return 'markdown';
  if (p.endsWith('.sh'))   return 'shell';
  if (p.endsWith('.js'))   return 'javascript';
  if (p.endsWith('.ts'))   return 'typescript';
  if (p.endsWith('.php'))  return 'php';
  if (p.endsWith('.yaml') || p.endsWith('.yml')) return 'yaml';
  return 'plaintext';
}

function initMonaco() {
  const container = document.getElementById('monaco-container');
  if (!container) return;

  const monacoBase = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.0/min/vs';

  const doCreate = () => {
    if (window._monacoEditor) {
      // Already created — just update layout
      window._monacoEditor.layout();
      return;
    }
    window._monacoEditor = monaco.editor.create(container, {
      value: '',
      language: getLangForMonaco(State.editorPath),
      theme: State.theme === 'dark' ? 'vs-dark' : 'vs',
      automaticLayout: true,
      fontSize: 13,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: 'on',
    });

    window._monacoEditor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
      () => saveEditorFile()
    );

    window._monacoEditor.onDidChangeModelContent(() => {
      if (!State.editorDirty) {
        State.editorDirty = true;
        // Update toolbar dirty indicator without full re-render
        const fn = document.querySelector('.editor-filename');
        if (fn && !fn.querySelector('.editor-dirty')) {
          fn.insertAdjacentHTML('beforeend', '<span class="editor-dirty"> ●</span>');
        }
      }
    });

    if (State.editorPath) _loadFileIntoMonaco(State.editorPath);
  };

  // If Monaco instance exists but container was re-created (tab re-render), dispose and recreate
  if (window._monacoEditor) {
    const oldContainer = window._monacoEditor.getContainerDomNode();
    if (oldContainer !== container) {
      window._monacoEditor.dispose();
      window._monacoEditor = null;
    }
  }

  if (window.monaco) {
    doCreate();
    return;
  }

  // Load Monaco via AMD loader
  require.config({ paths: { vs: monacoBase } });
  require(['vs/editor/editor.main'], doCreate);
}

const BINARY_EXTENSIONS = new Set([
  'zip','gz','tar','tgz','bz2','xz','7z','rar',
  'png','jpg','jpeg','gif','webp','svg','ico','bmp','tiff',
  'pdf','doc','docx','xls','xlsx','ppt','pptx',
  'mp3','mp4','wav','ogg','flac','mov','avi','mkv','webm',
  'exe','dll','so','dylib','bin','dmg','pkg','deb','rpm',
  'woff','woff2','ttf','otf','eot',
  'pyc','class','o','a',
]);

function isEditableFile(filePath) {
  const ext = (filePath.split('.').pop() || '').toLowerCase();
  return !BINARY_EXTENSIONS.has(ext);
}

async function openEditorFile(filePath) {
  if (!isEditableFile(filePath)) {
    if (window._monacoEditor) {
      const model = window._monacoEditor.getModel();
      if (model) monaco.editor.setModelLanguage(model, 'plaintext');
      window._monacoEditor.setValue(`// Cannot open binary file: ${filePath.split('/').pop()}`);
      window._monacoEditor.updateOptions({ readOnly: true });
    }
    State.editorPath  = filePath;
    State.editorDirty = false;
    // Update toolbar filename only
    const fn = document.querySelector('.editor-filename');
    if (fn) fn.innerHTML = escapeHtml(filePath.split('/').pop()) + ' <span style="color:var(--accent-orange);font-size:11px">(binary)</span>';
    return;
  }
  if (State.editorDirty) {
    if (!confirm('You have unsaved changes. Discard and open new file?')) return;
  }
  State.editorPath  = filePath;
  State.editorDirty = false;

  if (window._monacoEditor) {
    // Monaco already mounted — update in-place, no full re-render needed
    await _loadFileIntoMonaco(filePath);
    // Update toolbar and active state in tree
    const fn = document.querySelector('.editor-filename');
    if (fn) fn.innerHTML = escapeHtml(filePath.split('/').pop());
    const langBadge = document.querySelector('.editor-lang-badge');
    if (langBadge) langBadge.textContent = getLangForMonaco(filePath);
    document.querySelectorAll('.editor-tree-file').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.editor-tree-file').forEach(el => {
      if (el.getAttribute('onclick')?.includes(escapeAttr(filePath))) el.classList.add('active');
    });
  } else {
    renderTabContent();
  }
}

async function _loadFileIntoMonaco(filePath) {
  if (!window._monacoEditor) return;
  try {
    const data = await API.file(filePath, State.projectPath || null);
    const model = window._monacoEditor.getModel();
    if (model) monaco.editor.setModelLanguage(model, getLangForMonaco(filePath));
    window._monacoEditor.updateOptions({ readOnly: false });
    window._monacoEditor.setValue(data.content || '');
    State.editorDirty = false;
  } catch (e) {
    window._monacoEditor.setValue(`// Error loading file: ${e.message}`);
  }
}

async function reloadEditorFile() {
  if (window._monacoEditor && State.editorPath) {
    await _loadFileIntoMonaco(State.editorPath);
  }
}

async function saveEditorFile() {
  if (!window._monacoEditor || !State.editorPath) return;
  const content = window._monacoEditor.getValue();
  try {
    const result = await API.saveFile(State.editorPath, content, State.projectPath || null);
    if (result.ok) {
      State.editorDirty = false;
      const dirty = document.querySelector('.editor-dirty');
      if (dirty) dirty.remove();
    } else {
      alert('Save failed: ' + (result.error || 'Unknown error'));
    }
  } catch (e) {
    alert('Save failed: ' + e.message);
  }
}

// ─── Rules Tab ────────────────────────────────────────────────────────────────

function renderRules() {
  const g    = State.scan?.global;
  const proj = State.scan?.project;
  const globalRules  = g?.rules  || [];
  const localRules   = proj?.localRules || [];
  const isProject    = State.mode === 'project';
  const selCount     = State.shareItems.size;

  function ruleCard(rule, scope) {
    const key     = `rule:${scope}:${rule.name}`;
    const checked = State.shareItems.has(key);
    const pathBadges = (rule.paths || []).map(p =>
      `<span class="rule-path-badge">${escapeHtml(p)}</span>`
    ).join('');

    const shareBtn  = `<button class="card-share-btn btn-ghost" onclick="shareItemDirect('rule','${escapeAttr(rule.name)}','${scope}')" title="Share to project">⇥</button>`;
    const deleteBtn = `<button class="card-delete-btn btn-ghost" onclick="deleteRule('${escapeAttr(rule.name)}','${scope}')" title="Delete rule">✕</button>`;

    const shareWrap = State.shareMode
      ? `<label class="share-checkbox"><input type="checkbox" ${checked ? 'checked' : ''} onchange="toggleShareItem('rule','${escapeAttr(rule.name)}','${scope}')"></label>`
      : '';

    const id = `rule_${scope}_${rule.name.replace(/[^a-z0-9]/gi,'_')}`;
    return `<div class="card ${State.shareMode && checked ? 'share-card-wrapper selected' : State.shareMode ? 'share-card-wrapper' : ''}" id="card-${id}">
      ${shareWrap}
      <div class="card-header" onclick="toggleCard('${id}')">
        <span class="card-title">${escapeHtml(rule.name)}</span>
        <div class="card-meta">
          ${pathBadges}
          ${rule.wordCount ? `<span class="skill-badge">${rule.wordCount}w</span>` : ''}
          ${!State.shareMode ? shareBtn + deleteBtn : ''}
        </div>
        <span class="expand-icon">▶</span>
      </div>
      <div class="card-excerpt">${escapeHtml(rule.excerpt || '')}</div>
      <div class="card-body hidden" id="body-${id}" data-raw="${escapeAttr(rule.body || rule.raw || '')}"></div>
    </div>`;
  }

  const shareModeBar = isProject ? `
    <div class="share-action-bar">
      <button class="btn-ghost ${State.shareMode ? 'active' : ''}" onclick="toggleShareMode()">
        ${State.shareMode ? '✕ Cancel' : '⇥ Share mode'}
      </button>
      ${State.shareMode ? `
        <button class="btn-ghost" onclick="selectAllShareItems('rule', 'global')">Select all global</button>
        ${proj ? `<button class="btn-ghost" onclick="selectAllShareItems('rule', 'project')">Select all project</button>` : ''}
        <button class="btn-primary" onclick="openShareModal()" ${selCount ? '' : 'disabled'}>Share ${selCount || ''}</button>
      ` : ''}
    </div>` : '';

  const localSection = isProject && proj
    ? `<div class="section">
        <div class="section-title">Project Rules — ${escapeHtml(proj.projectName)} (${localRules.length})</div>
        ${localRules.length
          ? localRules.map(r => ruleCard(r, 'project')).join('')
          : `<p class="empty-hint">No rules in .claude/rules/</p>`}
      </div>` : '';

  return `<div>
    ${shareModeBar}
    ${localSection}
    <div class="section">
      <div class="section-title">Global Rules — ~/.claude/rules/ (${globalRules.length})</div>
      ${globalRules.length
        ? globalRules.map(r => ruleCard(r, 'global')).join('')
        : `<p class="empty-hint">No global rules found</p>`}
    </div>
  </div>`;
}

async function deleteRule(name, scope) {
  if (!confirm(`Delete rule "${name}"? This cannot be undone.`)) return;
  const r = await API.deleteRule(name, scope, State.projectPath || null);
  if (!r.ok) { alert('Error: ' + r.error); return; }
  await doSilentRefresh();
}

// ─── Hooks Tab ────────────────────────────────────────────────────────────────

function renderHooks() {
  const g    = State.scan?.global;
  const proj = State.scan?.project;
  const isProject = State.mode === 'project';

  const globalHooksRaw   = g?.settings?.hooksRaw    || {};
  const projectHooksRaw  = proj?.settings?.hooksRaw  || {};
  const localHooksRaw    = proj?.settingsLocal?.hooksRaw || {};
  const warpHooks        = g?.plugins?.warpPlugin?.hooks || {};

  function hookTypeIcon(type) {
    return { command: '⌘', http: '⇆', prompt: '◷', agent: '◎' }[type] || '•';
  }

  function hookEntry(event, entry, source) {
    const hooks = entry.hooks || [];
    return hooks.map(h => {
      const typeLabel = h.type || 'command';
      const detail = typeLabel === 'http' ? (h.url || '') : typeLabel === 'command' ? (h.command || '') : (h.prompt || h.command || '');
      const raw = JSON.stringify({ [event]: [{ matcher: entry.matcher || undefined, hooks: [h] }] }, null, 2);
      return `<div class="hook-card">
        <div class="hook-card-header">
          <span class="hook-event-badge">${escapeHtml(event)}</span>
          <span class="hook-type-badge hook-type-${escapeAttr(typeLabel)}">${hookTypeIcon(typeLabel)} ${escapeHtml(typeLabel)}</span>
          <span class="hook-source-badge">${escapeHtml(source)}</span>
          <button class="btn-ghost" style="margin-left:auto;font-size:11px" onclick="copyHookJson(${escapeAttr(JSON.stringify(raw))})" title="Copy hook JSON">⧉ Copy JSON</button>
        </div>
        ${entry.matcher ? `<div class="hook-detail"><span class="hook-detail-key">Matcher</span><span class="hook-detail-value mono">${escapeHtml(entry.matcher)}</span></div>` : ''}
        <div class="hook-detail"><span class="hook-detail-key">${typeLabel === 'http' ? 'URL' : 'Command'}</span><span class="hook-detail-value mono">${escapeHtml(detail)}</span></div>
        ${h.timeout ? `<div class="hook-detail"><span class="hook-detail-key">Timeout</span><span class="hook-detail-value">${h.timeout}s</span></div>` : ''}
        ${h.statusMessage ? `<div class="hook-detail"><span class="hook-detail-key">Status</span><span class="hook-detail-value">${escapeHtml(h.statusMessage)}</span></div>` : ''}
        ${h.async ? `<div class="hook-detail"><span class="hook-detail-key">Async</span><span class="hook-detail-value">yes</span></div>` : ''}
      </div>`;
    }).join('');
  }

  function renderHookGroup(hooksObj, source) {
    if (!Object.keys(hooksObj).length) return '';
    return Object.entries(hooksObj).map(([event, entries]) =>
      entries.map(entry => hookEntry(event, entry, source)).join('')
    ).join('');
  }

  const globalHtml   = renderHookGroup(globalHooksRaw, 'global settings.json');
  const warpHtml     = renderHookGroup(warpHooks, 'warp plugin');
  const projectHtml  = isProject ? renderHookGroup(projectHooksRaw, '.claude/settings.json') : '';
  const localHtml    = isProject ? renderHookGroup(localHooksRaw, '.claude/settings.local.json') : '';

  const hasAny = globalHtml || warpHtml || projectHtml || localHtml;

  return `<div>
    <div class="section">
      <div class="section-title" style="display:flex;align-items:center;gap:8px">
        Hooks
        <span style="font-size:11px;color:var(--text-muted);font-weight:400">Hooks are defined in settings.json — copy JSON to add to another project</span>
      </div>
      ${isProject && (projectHtml || localHtml) ? `
        <div class="hooks-source-group">
          <div class="hooks-source-label">Project (.claude/settings.json + settings.local.json)</div>
          ${projectHtml || localHtml || '<p class="empty-hint">No hooks in project settings</p>'}
        </div>` : ''}
      <div class="hooks-source-group">
        <div class="hooks-source-label">Global (~/.claude/settings.json)</div>
        ${globalHtml || '<p class="empty-hint">No hooks in global settings</p>'}
      </div>
      ${warpHtml ? `<div class="hooks-source-group">
        <div class="hooks-source-label">Warp Plugin</div>
        ${warpHtml}
      </div>` : ''}
      ${!hasAny ? `<p class="empty-hint">No hooks configured. Add them to settings.json under the "hooks" key.</p>` : ''}
    </div>
  </div>`;
}

function copyHookJson(raw) {
  navigator.clipboard.writeText(raw).then(() => {
    const el = document.createElement('div');
    el.textContent = 'Hook JSON copied!';
    el.style.cssText = 'position:fixed;bottom:20px;right:20px;background:var(--bg-elevated);border:1px solid var(--bg-border);padding:8px 14px;border-radius:6px;font-size:12px;z-index:9999;color:var(--text-primary)';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2000);
  });
}

// ─── Agents Tab ───────────────────────────────────────────────────────────────

function renderAgents() {
  const g    = State.scan?.global;
  const proj = State.scan?.project;
  const globalAgents = g?.agents  || [];
  const localAgents  = proj?.localAgents || [];
  const isProject    = State.mode === 'project';
  const selCount     = State.shareItems.size;

  function agentCard(agent, scope) {
    const key     = `agent:${scope}:${agent.name}`;
    const checked = State.shareItems.has(key);
    const meta    = agent.meta || {};

    const shareBtn  = `<button class="card-share-btn btn-ghost" onclick="shareItemDirect('agent','${escapeAttr(agent.name)}','${scope}')" title="Share to project">⇥</button>`;
    const deleteBtn = `<button class="card-delete-btn btn-ghost" onclick="deleteAgent('${escapeAttr(agent.name)}','${scope}')" title="Delete agent">✕</button>`;

    const shareWrap = State.shareMode
      ? `<label class="share-checkbox"><input type="checkbox" ${checked ? 'checked' : ''} onchange="toggleShareItem('agent','${escapeAttr(agent.name)}','${scope}')"></label>`
      : '';

    const id = `agent_${scope}_${agent.name.replace(/[^a-z0-9]/gi,'_')}`;
    const allowedBadges = (meta.allowedTools || []).map(t =>
      `<span class="skill-tool-badge">${escapeHtml(t)}</span>`
    ).join('');

    return `<div class="card ${State.shareMode && checked ? 'share-card-wrapper selected' : State.shareMode ? 'share-card-wrapper' : ''}" id="card-${id}">
      ${shareWrap}
      <div class="card-header" onclick="toggleCard('${id}')">
        <span class="card-title">${escapeHtml(meta.displayName || agent.name)}</span>
        <div class="card-meta">
          ${allowedBadges}
          ${meta.description ? `<span class="skill-badge">${escapeHtml(meta.description.slice(0,40))}</span>` : ''}
          ${!State.shareMode ? shareBtn + deleteBtn : ''}
        </div>
        <span class="expand-icon">▶</span>
      </div>
      <div class="card-excerpt">${escapeHtml(agent.excerpt || '')}</div>
      <div class="card-body hidden" id="body-${id}" data-raw="${escapeAttr(agent.body || agent.raw || '')}"></div>
    </div>`;
  }

  const shareModeBar = isProject ? `
    <div class="share-action-bar">
      <button class="btn-ghost ${State.shareMode ? 'active' : ''}" onclick="toggleShareMode()">
        ${State.shareMode ? '✕ Cancel' : '⇥ Share mode'}
      </button>
      ${State.shareMode ? `
        <button class="btn-ghost" onclick="selectAllShareItems('agent', 'global')">Select all global</button>
        ${proj ? `<button class="btn-ghost" onclick="selectAllShareItems('agent', 'project')">Select all project</button>` : ''}
        <button class="btn-primary" onclick="openShareModal()" ${selCount ? '' : 'disabled'}>Share ${selCount || ''}</button>
      ` : ''}
    </div>` : '';

  const localSection = isProject && proj
    ? `<div class="section">
        <div class="section-title">Project Agents — ${escapeHtml(proj.projectName)} (${localAgents.length})</div>
        ${localAgents.length
          ? localAgents.map(a => agentCard(a, 'project')).join('')
          : `<p class="empty-hint">No agents in .claude/agents/</p>`}
      </div>` : '';

  return `<div>
    ${shareModeBar}
    ${localSection}
    <div class="section">
      <div class="section-title">Global Agents — ~/.claude/agents/ (${globalAgents.length})</div>
      ${globalAgents.length
        ? globalAgents.map(a => agentCard(a, 'global')).join('')
        : `<p class="empty-hint">No global agents found</p>`}
    </div>
  </div>`;
}

async function deleteAgent(name, scope) {
  if (!confirm(`Delete agent "${name}"? This cannot be undone.`)) return;
  const r = await API.deleteAgent(name, scope, State.projectPath || null);
  if (!r.ok) { alert('Error: ' + r.error); return; }
  await doSilentRefresh();
}

// ─── Git Tab ──────────────────────────────────────────────────

async function loadGitTab() {
  if (State.gitStatusLoading) return;
  State.gitStatusLoading = true;
  renderTabContent();

  try {
    const r = await API.gitIsRepo(State.projectPath);
    State.gitIsRepo = r.isRepo;
  } catch { State.gitIsRepo = false; }

  if (!State.gitIsRepo) {
    State.gitStatusLoading = false;
    renderTabContent();
    return;
  }

  const [status, log, worktrees, remotes, branches] = await Promise.allSettled([
    API.gitStatus(State.projectPath),
    API.gitLog(State.projectPath),
    API.gitWorktrees(State.projectPath),
    API.gitRemotes(State.projectPath),
    API.gitBranches(State.projectPath),
  ]);
  State.gitStatus    = status.value    || null;
  State.gitLog       = log.value       || null;
  State.gitWorktrees = worktrees.value || null;
  State.gitRemotes   = remotes.value   || null;
  State.gitBranches  = branches.value  || null;
  State.gitStatusLoading = false;
  renderTabContent();
  renderTabBar(); // update badge
}

function renderGit() {
  if (State.gitStatusLoading) return renderLoading();
  if (State.gitIsRepo === false) {
    return `<div class="empty-state"><div class="empty-state-icon">⎇</div><h3>Not a git repository</h3><p>This folder is not tracked by git.</p></div>`;
  }
  if (!State.gitStatus) {
    return renderLoading();
  }

  return `<div class="git-wrap">
    ${renderGitHeader()}
    <div class="git-layout">
      <div class="git-left">
        ${renderGitFileList()}
        ${renderGitCommitForm()}
      </div>
      <div class="git-right" id="git-diff-panel">
        ${State.gitDiffLoading ? '<div class="git-diff-hint"><div class="spinner"></div></div>' : (State.gitDiff ? renderGitDiff() : renderGitDiffHint())}
      </div>
    </div>
    ${renderGitHistory()}
    ${renderGitWorktrees()}
    <div id="git-op-result" class="git-op-result"></div>
  </div>`;
}

function renderGitHeader() {
  const s      = State.gitStatus;
  const current = s?.branch || '';
  const ahead  = s?.ahead  || 0;
  const behind = s?.behind || 0;
  const syncHtml = (ahead || behind)
    ? `<span class="git-sync">${behind > 0 ? `↓${behind} ` : ''}${ahead > 0 ? `↑${ahead}` : ''}</span>`
    : '';

  const hasPR = (() => {
    const url = State.gitRemotes?.remotes?.[0]?.url || '';
    return /github\.com|gitlab\.com/.test(url);
  })();

  // Build branch select — local branches first, then remotes
  const allBranches = State.gitBranches?.branches || [];
  const local  = allBranches.filter(b => !b.startsWith('origin/') && !b.startsWith('remotes/'));
  const remote = allBranches.filter(b => b.startsWith('remotes/') || b.startsWith('origin/'));

  const branchOptions = local.length
    ? `<optgroup label="Local">${local.map(b =>
        `<option value="${escapeAttr(b)}" ${b === current ? 'selected' : ''}>${escapeHtml(b)}</option>`
      ).join('')}</optgroup>
       ${remote.length ? `<optgroup label="Remote">${remote.map(b =>
        `<option value="${escapeAttr(b)}">${escapeHtml(b)}</option>`
      ).join('')}</optgroup>` : ''}`
    : `<option value="${escapeAttr(current)}" selected>${escapeHtml(current || 'unknown')}</option>`;

  return `<div class="git-header">
    <span style="font-size:12px;color:var(--text-muted);flex-shrink:0">⎇</span>
    <select class="git-branch-select" onchange="gitCheckoutBranch(this.value)" title="Switch branch">
      ${branchOptions}
    </select>
    ${syncHtml}
    <button class="btn-secondary" onclick="gitPull()" style="font-size:12px;padding:3px 10px">Pull</button>
    <button class="btn-secondary" onclick="gitPush()" style="font-size:12px;padding:3px 10px">Push</button>
    ${hasPR ? `<button class="btn-secondary" onclick="gitOpenPR()" style="font-size:12px;padding:3px 10px">Open PR ↗</button>` : ''}
    <button class="btn-ghost" onclick="loadGitTab()" title="Refresh" style="margin-left:auto">↺ Refresh</button>
  </div>`;
}

function renderGitFileList() {
  const files = State.gitStatus?.files || [];
  const staged   = files.filter(f => f.staged);
  const unstaged = files.filter(f => !f.staged);

  function fileRow(f) {
    const isActive = State.gitSelectedFile?.path === f.path && State.gitSelectedFile?.staged === f.staged;
    const statusChar = f.staged ? (f.x || '?') : (f.y || '?');
    const cls = { M:'M', A:'A', D:'D', R:'R' }[statusChar] || 'u';
    const checked = f.staged;
    return `<div class="git-file-row ${isActive ? 'active' : ''}" onclick="gitSelectFile('${escapeAttr(f.path)}', ${f.staged})">
      <input type="checkbox" ${checked ? 'checked' : ''} onclick="event.stopPropagation();gitToggleStage('${escapeAttr(f.path)}', ${f.staged})" style="flex-shrink:0;cursor:pointer">
      <span class="git-status-${cls}">${escapeHtml(statusChar)}</span>
      <span class="git-file-name" title="${escapeAttr(f.path)}">${escapeHtml(f.path)}</span>
      ${!f.staged && statusChar !== '?' ? `<button class="git-discard-btn btn-ghost" onclick="event.stopPropagation();gitDiscard('${escapeAttr(f.path)}')" title="Discard changes">✕</button>` : ''}
    </div>`;
  }

  return `<div class="git-file-list">
    ${unstaged.length ? `<div class="git-section-label">Unstaged (${unstaged.length})</div>${unstaged.map(fileRow).join('')}` : ''}
    ${staged.length   ? `<div class="git-section-label">Staged (${staged.length})</div>${staged.map(fileRow).join('')}` : ''}
    ${!files.length   ? `<div class="git-diff-hint" style="padding:20px">No changes</div>` : ''}
  </div>`;
}

function renderGitCommitForm() {
  const hasStaged = (State.gitStatus?.files || []).some(f => f.staged);
  return `<div class="git-commit-form">
    <input class="git-commit-input" type="text" placeholder="Summary (required)"
      value="${escapeAttr(State.gitCommitSummary)}"
      oninput="State.gitCommitSummary=this.value"
      onkeydown="if(event.key==='Enter')gitCommit()">
    <button class="btn-primary" onclick="gitCommit()" ${hasStaged ? '' : 'disabled'}
      style="font-size:12px;padding:5px 12px">
      Commit to ${escapeHtml(State.gitStatus?.branch || 'main')}
    </button>
  </div>`;
}

function renderGitDiffHint() {
  return `<div class="git-diff-hint">Click a file to see its diff</div>`;
}

function renderGitDiff() {
  const raw = State.gitDiff || '';
  const lines = raw.split('\n').map(line => {
    if (line.startsWith('+++') || line.startsWith('---')) {
      return `<span class="git-diff-meta">${escapeHtml(line)}</span>`;
    }
    if (line.startsWith('+')) return `<span class="git-diff-add">${escapeHtml(line)}</span>`;
    if (line.startsWith('-')) return `<span class="git-diff-del">${escapeHtml(line)}</span>`;
    if (line.startsWith('@@')) return `<span class="git-diff-hunk">${escapeHtml(line)}</span>`;
    return `<span class="git-diff-meta">${escapeHtml(line)}</span>`;
  });
  const f = State.gitSelectedFile;
  return `<div style="padding:8px 12px;border-bottom:1px solid var(--bg-border);font-size:11px;font-family:var(--font-mono);color:var(--text-muted)">${escapeHtml(f?.path || '')}</div>
  <div class="git-diff">${lines.join('\n')}</div>`;
}

function renderGitHistory() {
  const commits = State.gitLog?.commits || [];
  const open = State.gitLogExpanded ? 'open' : '';
  return `<details class="git-section-details" ${open} ontoggle="State.gitLogExpanded=this.open">
    <summary class="git-section-summary">History (${commits.length} commits)</summary>
    <div class="git-history-list">
      ${commits.map(c => `
        <div class="git-commit-row">
          <span class="git-commit-hash">${escapeHtml((c.hash||'').slice(0,7))}</span>
          <span class="git-commit-msg">${escapeHtml(c.subject || '')}</span>
          <span class="git-commit-meta">${escapeHtml(c.author || '')} · ${escapeHtml(c.date || '')}</span>
        </div>`).join('')}
      ${!commits.length ? '<div style="padding:10px 14px;color:var(--text-muted);font-size:12px">No commits</div>' : ''}
    </div>
  </details>`;
}

function renderGitWorktrees() {
  const wts = State.gitWorktrees?.worktrees || [];
  const open = State.gitWorktreesExpanded ? 'open' : '';
  return `<details class="git-section-details" ${open} ontoggle="State.gitWorktreesExpanded=this.open">
    <summary class="git-section-summary">Worktrees (${wts.length})</summary>
    <div>
      ${wts.map(wt => `
        <div class="git-worktree-row">
          <span class="git-branch ${wt.isMain ? 'git-worktree-current' : ''}">⎇ ${escapeHtml(wt.branch || '(detached)')}</span>
          <span style="flex:1;color:var(--text-muted);font-size:11px">${escapeHtml(wt.path)}</span>
          ${!wt.isMain ? `
            <button class="btn-ghost" style="font-size:11px" onclick="selectProject('${escapeAttr(wt.path)}')">Open</button>
            <button class="btn-ghost" style="font-size:11px;color:var(--accent-red,#f85149)" onclick="gitRemoveWorktree('${escapeAttr(wt.path)}')">Remove</button>
          ` : '<span style="font-size:11px;color:var(--text-muted)">(main)</span>'}
        </div>`).join('')}
      <div class="git-worktree-add-form">
        <input id="git-wt-branch" class="git-commit-input" placeholder="Branch name" style="flex:1">
        <input id="git-wt-path"   class="git-commit-input" placeholder="Worktree path (absolute)" style="flex:2">
        <label class="git-wt-existing-label" title="Check if the branch already exists">
          <input type="checkbox" id="git-wt-existing"> existing
        </label>
        <button class="btn-secondary" onclick="gitAddWorktree()" style="font-size:12px;padding:4px 10px;flex-shrink:0">+ Add Worktree</button>
      </div>
    </div>
  </details>`;
}

// ── Git event handlers ─────────────────────────────────────────

async function refreshGitStatus() {
  try {
    const r = await API.gitStatus(State.projectPath);
    State.gitStatus = r;
  } catch (e) {
    console.error('git status error', e);
  }
  renderTabContent();
  renderTabBar();
}

async function gitCheckoutBranch(branch) {
  if (!branch || branch === State.gitStatus?.branch) return;
  const uncommitted = (State.gitStatus?.files || []).length;
  if (uncommitted > 0) {
    if (!confirm(`You have ${uncommitted} uncommitted change(s). Switch to "${branch}" anyway?`)) {
      renderTabContent(); // re-render to reset the select back to current
      return;
    }
  }
  showGitOpResult(`Switching to ${branch}…`);
  try {
    const r = await API.gitCheckout(State.projectPath, branch);
    if (!r.ok) { showGitOpResult('✗ ' + r.error, false); renderTabContent(); return; }
    showGitOpResult(`✓ Switched to ${branch}`, true);
    // Full reload: new branch may have different files, log, etc.
    State.gitStatus = null;
    State.gitBranches = null;
    State.gitLog = null;
    State.gitDiff = null;
    State.gitSelectedFile = null;
    await loadGitTab();
  } catch (e) {
    showGitOpResult('✗ ' + e.message, false);
    renderTabContent();
  }
}

async function gitToggleStage(filePath, isStaged) {
  try {
    if (isStaged) await API.gitUnstage(State.projectPath, [filePath]);
    else          await API.gitStage(State.projectPath, [filePath]);
  } catch (e) { console.error(e); }
  await refreshGitStatus();
}

async function gitSelectFile(filePath, staged) {
  State.gitSelectedFile = { path: filePath, staged };
  State.gitDiff = null;
  State.gitDiffLoading = true;
  renderTabContent();
  try {
    const r = await API.gitDiff(State.projectPath, filePath, staged);
    State.gitDiff = r.diff;
  } catch (e) { State.gitDiff = `Error: ${e.message}`; }
  State.gitDiffLoading = false;
  renderTabContent();
}

async function gitDiscard(filePath) {
  if (!confirm(`Discard changes to ${filePath}? This cannot be undone.`)) return;
  try {
    await API.gitDiscard(State.projectPath, filePath);
  } catch (e) { alert(`Error: ${e.message}`); }
  if (State.gitSelectedFile?.path === filePath) {
    State.gitSelectedFile = null;
    State.gitDiff = null;
  }
  await refreshGitStatus();
}

async function gitCommit() {
  const summary = State.gitCommitSummary.trim();
  if (!summary) return;
  showGitOpResult('Committing…');
  try {
    const r = await API.gitCommit(State.projectPath, summary, State.gitCommitBody || undefined);
    State.gitCommitSummary = '';
    State.gitCommitBody = '';
    showGitOpResult(r.ok ? '✓ Committed' : '✗ ' + (r.error || 'Unknown error'), r.ok);
    if (r.ok) {
      // refresh log + status
      const [status, log] = await Promise.allSettled([API.gitStatus(State.projectPath), API.gitLog(State.projectPath)]);
      if (status.value) State.gitStatus = status.value;
      if (log.value)    State.gitLog    = log.value;
      renderTabContent();
      renderTabBar();
    }
  } catch (e) {
    showGitOpResult('✗ ' + e.message, false);
  }
}

async function gitPull() {
  showGitOpResult('Pulling…');
  try {
    const r = await API.gitPull(State.projectPath);
    showGitOpResult(r.ok ? '✓ ' + (r.output || 'Done') : '✗ ' + (r.error || 'Failed'), r.ok);
    if (r.ok) await refreshGitStatus();
  } catch (e) { showGitOpResult('✗ ' + e.message, false); }
}

async function gitPush() {
  showGitOpResult('Pushing…');
  try {
    const r = await API.gitPush(State.projectPath);
    showGitOpResult(r.ok ? '✓ ' + (r.output || 'Done') : '✗ ' + (r.error || 'Failed'), r.ok);
    if (r.ok) await refreshGitStatus();
  } catch (e) { showGitOpResult('✗ ' + e.message, false); }
}

function gitOpenPR() {
  const branch = State.gitStatus?.branch;
  const remote = State.gitRemotes?.remotes?.[0]?.url || '';
  const m = remote.match(/github\.com[:/](.+?)(?:\.git)?$/);
  if (m && branch) { window.open(`https://github.com/${m[1]}/compare/${branch}`); return; }
  const gl = remote.match(/gitlab\.com[:/](.+?)(?:\.git)?$/);
  if (gl && branch) { window.open(`https://gitlab.com/${gl[1]}/-/merge_requests/new?merge_request[source_branch]=${branch}`); return; }
  alert('Could not determine PR URL from remote: ' + remote);
}

function showGitOpResult(msg, ok) {
  const el = document.getElementById('git-op-result');
  if (!el) return;
  el.textContent = msg;
  el.className = 'git-op-result ' + (ok === true ? 'ok' : ok === false ? 'err' : '');
  if (ok !== undefined) setTimeout(() => { if (el) el.textContent = ''; }, 4000);
}

async function gitAddWorktree() {
  const branch   = document.getElementById('git-wt-branch')?.value.trim();
  const wtPath   = document.getElementById('git-wt-path')?.value.trim();
  const existing = document.getElementById('git-wt-existing')?.checked || false;
  if (!branch || !wtPath) return alert('Enter both a branch name and a path.');
  try {
    const r = await API.gitWorktreeAdd(State.projectPath, wtPath, branch, existing);
    if (!r.ok) { alert('Error: ' + r.error); return; }
    // Pin the worktree so it appears in the sidebar
    await fetch('/api/pinned-projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: wtPath }),
    });
    await loadPinnedProjects();
    const wt = await API.gitWorktrees(State.projectPath);
    State.gitWorktrees = wt;
    renderTabContent();
    renderProjectList();
  } catch (e) { alert('Error: ' + e.message); }
}

async function gitRemoveWorktree(wtPath) {
  if (!confirm(`Remove worktree at ${wtPath}?`)) return;
  try {
    const r = await API.gitWorktreeRemove(State.projectPath, wtPath);
    if (!r.ok) { alert('Error: ' + r.error); return; }
    const wt = await API.gitWorktrees(State.projectPath);
    State.gitWorktrees = wt;
    renderTabContent();
  } catch (e) { alert('Error: ' + e.message); }
}

// ─── Terminal Panel ───────────────────────────────────────────

const _terminals = {};   // { id: { xterm, ws, fitAddon, el } }
let _activeTermId = null;
let _termNextId = 0;

// ── Height persistence ──
const TERM_HEIGHT_KEY = 'terminal-panel-height';
(function initTerminalHeight() {
  const saved = parseInt(localStorage.getItem(TERM_HEIGHT_KEY), 10);
  if (saved && saved >= 120) State.terminalHeight = saved;
  _applyTerminalHeight(State.terminalHeight);
})();

function _applyTerminalHeight(px) {
  const h = Math.max(80, Math.min(px, Math.floor(window.innerHeight * 0.7)));
  State.terminalHeight = h;
  document.documentElement.style.setProperty('--terminal-panel-height', h + 'px');
  const panel = document.getElementById('terminal-panel');
  if (panel) { panel.style.height = h + 'px'; panel.style.maxHeight = h + 'px'; }
}

// ── Tray rendering ──
function renderTray() {
  const trayTabs = document.getElementById('terminal-tray-tabs');
  if (!trayTabs) return;
  const ids = Object.keys(_terminals);

  if (ids.length === 0) {
    // Placeholder chip — spawns + opens on click
    trayTabs.innerHTML = `<div class="terminal-tray-chip" onclick="trayNewTerminal()"><span>Terminal 1</span></div>`;
  } else {
    trayTabs.innerHTML = ids.map((id, i) => {
      const isActive = id === _activeTermId;
      return `<div class="terminal-tray-chip${isActive ? ' active' : ''}" onclick="trayClickChip('${id}')">
        <span>Terminal ${i + 1}</span>
        <button class="terminal-tray-chip-close" onclick="event.stopPropagation();closeTerminalTab('${id}')" title="Close">✕</button>
      </div>`;
    }).join('');
  }

  const cwdEl = document.getElementById('terminal-cwd');
  if (cwdEl) {
    const cwd = State.projectPath || '';
    cwdEl.textContent = cwd ? '~/' + cwd.split('/').slice(-2).join('/') : '~';
  }
}

function trayClickChip(id) {
  const panel = document.getElementById('terminal-panel');
  if (!panel) return;
  if (_activeTermId === id && !panel.classList.contains('hidden')) {
    minimizeTerminal();
  } else {
    switchTerminalTab(id);
    expandTerminal();
  }
}

function trayNewTerminal() {
  expandTerminal();
  spawnTerminal();
}

function expandTerminal() {
  const panel = document.getElementById('terminal-panel');
  if (!panel) return;
  panel.classList.remove('hidden');
  State.terminalPanelOpen = true;
  if (_activeTermId && _terminals[_activeTermId]) {
    setTimeout(() => _terminals[_activeTermId].fitAddon.fit(), 50);
  }
}

// Called when navigating away from editor tab to a different project/global
function _leaveEditorTab() {
  minimizeTerminal();
  const mainArea = document.getElementById('main-area');
  if (mainArea) mainArea.classList.remove('editor-active');
}

function minimizeTerminal() {
  const panel = document.getElementById('terminal-panel');
  if (!panel) return;
  panel.classList.add('hidden');
  State.terminalPanelOpen = false;
}

function closeActiveTerminalTab() {
  if (_activeTermId) closeTerminalTab(_activeTermId);
}

function spawnTerminal() {
  const id  = 'term-' + (++_termNextId);
  const cwd = State.projectPath || '';
  const wsUrl = `ws://${location.host}/terminal${cwd ? '?cwd=' + encodeURIComponent(cwd) : ''}`;

  const container = document.getElementById('terminal-container');
  if (!container) return;
  const termEl = document.createElement('div');
  termEl.id = id;
  termEl.style.cssText = 'width:100%;height:100%;display:block';
  container.appendChild(termEl);

  Object.values(_terminals).forEach(t => { t.el.style.display = 'none'; });

  const xterm = new Terminal({
    fontSize: 13,
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    theme: { background: '#1e1e1e', foreground: '#d4d4d4', cursor: '#aeafad' },
    cursorBlink: true,
    scrollback: 5000,
  });
  const fitAddon = new FitAddon.FitAddon();
  xterm.loadAddon(fitAddon);

  // Clickable file paths — match path:line patterns Claude outputs
  if (window.WebLinksAddon) {
    const filePathRegex = /(?:^|[\s"'(])((\.{0,2}\/[\w.\-/]+|[\w.\-]+\/[\w.\-/]+)\.(js|ts|tsx|jsx|mjs|cjs|json|md|yaml|yml|css|scss|html|sh|py|rb|go|rs|java|php|txt|env|toml|conf|lock)(?::\d+(?::\d+)?)?)/;
    const webLinks = new WebLinksAddon.WebLinksAddon(
      (e, uri) => {
        e.preventDefault();
        const rawPath = uri.replace(/^[\s"'(]+/, '').replace(/:[\d:]+$/, '');
        let resolved = rawPath;
        if (!rawPath.startsWith('/') && State.projectPath) {
          resolved = State.projectPath.replace(/\/$/, '') + '/' + rawPath;
        }
        openEditorFile(resolved);
        State.currentTab = 'editor';
        syncGroupFromTab('editor');
        renderApp();
      },
      { urlRegex: filePathRegex }
    );
    xterm.loadAddon(webLinks);
  }

  xterm.open(termEl);
  setTimeout(() => fitAddon.fit(), 10);

  const ws = new WebSocket(wsUrl);
  ws.onopen = () => {
    const { cols, rows } = xterm;
    ws.send(JSON.stringify({ type: 'resize', cols, rows }));
  };
  ws.onmessage = e => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'output') xterm.write(msg.data);
      if (msg.type === 'exit')   xterm.write('\r\n\x1b[33m[Process exited]\x1b[0m\r\n');
    } catch { xterm.write(e.data); }
  };
  ws.onclose = () => xterm.write('\r\n\x1b[31m[Disconnected]\x1b[0m\r\n');

  xterm.onData(data => {
    if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'input', data }));
  });

  const ro = new ResizeObserver(() => {
    fitAddon.fit();
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'resize', cols: xterm.cols, rows: xterm.rows }));
    }
  });
  ro.observe(container);

  _terminals[id] = { xterm, ws, fitAddon, el: termEl, ro };
  _activeTermId  = id;

  renderTray();
}

function switchTerminalTab(id) {
  const t = _terminals[id];
  if (!t) return;
  Object.values(_terminals).forEach(term => { term.el.style.display = 'none'; });
  t.el.style.display = 'block';
  _activeTermId = id;
  setTimeout(() => t.fitAddon.fit(), 20);
  renderTray();
}

function closeTerminalTab(id) {
  const t = _terminals[id];
  if (!t) return;
  try { t.ws.close(); t.xterm.dispose(); t.ro.disconnect(); t.el.remove(); } catch { /* ignore */ }
  delete _terminals[id];
  const remaining = Object.keys(_terminals);
  if (remaining.length) {
    switchTerminalTab(remaining[remaining.length - 1]);
  } else {
    _activeTermId = null;
    minimizeTerminal();
  }
  renderTray();
}

// ── Drag-resize ──
function initTerminalResize() {
  const handle = document.getElementById('terminal-resize-handle');
  if (!handle) return;
  let startY = 0, startH = 0, dragging = false;

  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    dragging = true;
    startY = e.clientY;
    startH = State.terminalHeight;
    handle.classList.add('dragging');
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'ns-resize';
  });

  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const delta = startY - e.clientY;   // drag up = increase height
    _applyTerminalHeight(startH + delta);
    if (_activeTermId && _terminals[_activeTermId]) _terminals[_activeTermId].fitAddon.fit();
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    localStorage.setItem(TERM_HEIGHT_KEY, String(State.terminalHeight));
    if (_activeTermId && _terminals[_activeTermId]) _terminals[_activeTermId].fitAddon.fit();
  });
}

async function onTreeToggle(nodePath) {
  if (State.fileTreeExpanded.has(nodePath)) {
    State.fileTreeExpanded.delete(nodePath);
  } else {
    State.fileTreeExpanded.add(nodePath);
  }
  renderTabContent();
}

async function onTreeFileClick(filePath) {
  State.rawSelectedPath  = filePath;
  State.rawFileLoading   = true;
  State.rawFileContent   = null;
  renderTabContent();

  try {
    const data = await API.file(filePath, State.projectPath || null);
    State.rawFileContent = data;
  } catch (e) {
    State.rawFileContent = { content: `Error: ${e.message}`, size: 0, mtime: null };
  }
  State.rawFileLoading = false;
  renderTabContent();
  requestAnimationFrame(() => attachCopyButtons());
}

// ─── Sessions Tab ─────────────────────────────────────────────
function renderSessions() {
  if (State.sessionViewMode === 'detail' && State.activeSessionId) {
    return renderSessionDetail();
  }
  if (State.historyMode) return renderCommandHistory();
  if (State.costReportMode) return renderCostReport();
  return renderSessionsList();
}

function renderSessionsList() {
  const projectPath = State.mode === 'project' ? State.projectPath : '';

  // Auto-load if not loaded
  if (!State.sessionsList && !State.sessionsLoading) {
    loadSessionsList();
    return `<div class="loading-state"><div class="spinner"></div><p>Loading sessions…</p></div>`;
  }
  if (State.sessionsLoading && !State.sessionsList) {
    return `<div class="loading-state"><div class="spinner"></div><p>Loading sessions…</p></div>`;
  }

  const sessions = State.sessionsList?.sessions || [];
  const q = State.sessionsFilter.toLowerCase();
  const filtered = q ? sessions.filter(s => s.title.toLowerCase().includes(q)) : sessions;

  return `<div>
    <div class="tab-header">
      <h2>Sessions <span class="badge">${sessions.length}</span></h2>
      <div style="display:flex;gap:8px;align-items:center">
        <div class="session-toggle">
          <button class="session-toggle-btn active" onclick="State.historyMode=false;State.costReportMode=false;renderTabContent()">Sessions</button>
          <button class="session-toggle-btn" onclick="State.historyMode=true;State.costReportMode=false;State.historyEntries=null;renderTabContent()">Command History</button>
          <button class="session-toggle-btn" onclick="State.historyMode=false;State.costReportMode=true;State.costReport=null;renderTabContent()">Cost Report</button>
        </div>
        <input class="search-input" placeholder="Filter sessions…"
               value="${escapeAttr(State.sessionsFilter)}"
               oninput="State.sessionsFilter=this.value;renderTabContent()">
      </div>
    </div>
    ${!projectPath ? '<p style="font-size:12px;color:var(--text-muted);margin-bottom:10px">Select a project from the sidebar to see its sessions.</p>' : ''}
    <div style="display:flex;flex-direction:column;gap:8px">
      ${filtered.length
        ? filtered.map(s => {
            const duration = s.startedAt && s.endedAt
              ? formatDuration(new Date(s.endedAt) - new Date(s.startedAt))
              : '';
            const resumeCmd = `claude --resume ${s.id}`;
            return `<div class="session-card">
              <div class="session-card-top" onclick="openSessionDetail('${escapeAttr(s.id)}')">
                <div class="session-card-title">${escapeHtml(s.title)}</div>
                <div class="session-card-meta">
                  ${s.gitBranch ? `<span class="session-badge branch">${escapeHtml(s.gitBranch)}</span>` : ''}
                  ${s.modelsUsed?.length ? s.modelsUsed.map(m => `<span class="session-badge model">${escapeHtml(m.split('-').slice(-2).join('-'))}</span>`).join('') : ''}
                  ${s.tokenUsage && (s.tokenUsage.input + s.tokenUsage.output) > 0 ? `<span class="session-badge cost">${escapeHtml(formatCost(calculateCost(s.tokenUsage, s.modelsUsed?.[0])))}</span>` : ''}
                  <span>${s.messageCount} msgs</span>
                  <span>${s.toolCallCount} tools</span>
                  ${duration ? `<span>${duration}</span>` : ''}
                  <span>${formatBytes(s.fileSize)}</span>
                  ${s.startedAt ? `<span>${timeSince(s.startedAt)}</span>` : ''}
                </div>
              </div>
              <div class="session-card-actions">
                <code class="session-resume-cmd">${escapeHtml(resumeCmd)}</code>
                <button class="btn-icon session-copy-btn" onclick="copyResumeCmd('${escapeAttr(s.id)}', this)" title="Copy resume command">Copy</button>
              </div>
            </div>`;
          }).join('')
        : `<div class="empty-state" style="min-height:120px"><p>${projectPath ? 'No sessions found' : 'Select a project to browse sessions'}</p></div>`}
    </div>
  </div>`;
}

function formatDuration(ms) {
  if (ms < 60000) return Math.round(ms / 1000) + 's';
  if (ms < 3600000) return Math.round(ms / 60000) + 'm';
  const h = Math.floor(ms / 3600000);
  const m = Math.round((ms % 3600000) / 60000);
  return `${h}h ${m}m`;
}

function copyResumeCmd(sessionId, btn) {
  const cmd = `claude --resume ${sessionId}`;
  navigator.clipboard?.writeText(cmd).then(() => {
    btn.textContent = '✓ Copied';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
  });
}

async function loadSessionsList() {
  const projectPath = State.mode === 'project' ? State.projectPath : '';
  if (!projectPath) { State.sessionsList = { sessions: [], total: 0 }; renderTabContent(); return; }
  State.sessionsLoading = true;
  try {
    State.sessionsList = await API.sessions(projectPath);
  } catch (e) {
    State.sessionsList = { sessions: [], total: 0, error: e.message };
  }
  State.sessionsLoading = false;
  renderTabContent();
}

async function openSessionDetail(id) {
  State.activeSessionId = id;
  State.sessionViewMode = 'detail';
  State.sessionDetailLoading = true;
  State.sessionDetail = null;
  renderTabContent();

  const projectPath = State.mode === 'project' ? State.projectPath : '';
  try {
    State.sessionDetail = await API.sessionDetail(id, projectPath);
  } catch (e) {
    State.sessionDetail = { error: e.message };
  }
  State.sessionDetailLoading = false;
  renderTabContent();
}

function renderSessionDetail() {
  if (State.sessionDetailLoading) {
    return `<div class="loading-state"><div class="spinner"></div><p>Loading conversation…</p></div>`;
  }

  const data = State.sessionDetail;
  if (!data || data.error) {
    return `<div>
      <button class="btn-secondary" onclick="State.sessionViewMode='list';renderTabContent()">← Back</button>
      <div class="error-state" style="margin-top:12px"><p>${escapeHtml(data?.error || 'Failed to load session')}</p></div>
    </div>`;
  }

  const session = data.session;
  const summary = data.summary;
  const turns   = data.turns || [];

  // Tool breakdown
  const toolEntries = Object.entries(summary.toolBreakdown || {}).sort((a, b) => b[1] - a[1]);
  const maxTool = toolEntries.length ? toolEntries[0][1] : 1;

  // Cost calculation per model
  const tt = summary.totalTokens || {};
  const primaryModel = summary.modelsUsed?.[0] || '';
  const totalCost = calculateCost(tt, primaryModel);
  const inputCost  = (tt.input || 0) * getPricing(primaryModel).input / 1_000_000;
  const outputCost = (tt.output || 0) * getPricing(primaryModel).output / 1_000_000;
  // Cache savings = what cache_read tokens would cost at full input price minus what was paid
  const p = getPricing(primaryModel);
  const cacheSavings = (tt.cacheRead || 0) * (p.input - p.cacheRead) / 1_000_000;

  // Per-model cost rows (aggregate turn-level token data by model)
  const tokensByModel = {};
  for (const turn of turns) {
    if (!turn.assistant) continue;
    const m = turn.assistant.model || 'unknown';
    if (!tokensByModel[m]) tokensByModel[m] = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    const tu = turn.assistant.tokenUsage || {};
    tokensByModel[m].input      += tu.input || 0;
    tokensByModel[m].output     += tu.output || 0;
    tokensByModel[m].cacheRead  += tu.cacheRead || 0;
    tokensByModel[m].cacheWrite += tu.cacheWrite || 0;
  }
  const modelCostRows = Object.entries(tokensByModel).map(([m, tk]) => {
    const cost = calculateCost(tk, m);
    return `<tr>
      <td style="font-family:monospace;font-size:12px">${escapeHtml(m.split('-').slice(-3).join('-'))}</td>
      <td>${formatTokens(tk.input)}</td>
      <td>${formatTokens(tk.output)}</td>
      <td>${formatTokens(tk.cacheWrite)}</td>
      <td>${formatTokens(tk.cacheRead)}</td>
      <td style="font-weight:600;color:var(--accent-teal)">${formatCost(cost)}</td>
    </tr>`;
  }).join('');

  return `<div>
    <button class="btn-secondary" onclick="State.sessionViewMode='list';renderTabContent()" style="margin-bottom:12px">← Back to Sessions</button>

    <div class="session-detail-header">
      <div style="font-size:14px;font-weight:600;color:var(--text-primary)">${escapeHtml(turns[0]?.userMessage?.slice(0, 80) || 'Session')}</div>
      <div class="session-detail-meta">
        ${session.gitBranch ? `<span class="session-badge branch">${escapeHtml(session.gitBranch)}</span>` : ''}
        ${summary.modelsUsed?.map(m => `<span class="session-badge model">${escapeHtml(m)}</span>`).join('') || ''}
        <span>${session.version || ''}</span>
        <span>${session.startedAt ? new Date(session.startedAt).toLocaleString() : ''}</span>
      </div>
    </div>

    <div class="session-summary">
      <div class="session-summary-card">
        <div class="session-summary-label">Conversation Turns</div>
        <div class="session-summary-value">${summary.totalTurns}</div>
      </div>
      <div class="session-summary-card accent">
        <div class="session-summary-label">Estimated Cost</div>
        <div class="session-summary-value">${escapeHtml(formatCost(totalCost))}</div>
      </div>
      <div class="session-summary-card">
        <div class="session-summary-label">Input Tokens</div>
        <div class="session-summary-value">${formatTokens(tt.input || 0)}</div>
      </div>
      <div class="session-summary-card">
        <div class="session-summary-label">Output Tokens</div>
        <div class="session-summary-value">${formatTokens(tt.output || 0)}</div>
      </div>
      <div class="session-summary-card">
        <div class="session-summary-label">Cache Savings</div>
        <div class="session-summary-value" style="color:var(--status-full)">${escapeHtml(formatCost(cacheSavings))}</div>
      </div>
    </div>

    ${modelCostRows ? `<div class="section">
      <div class="section-title">Cost Breakdown by Model</div>
      <div style="overflow-x:auto">
        <table class="cost-breakdown-table">
          <thead><tr><th>Model</th><th>Input</th><th>Output</th><th>Cache Write</th><th>Cache Read</th><th>Cost</th></tr></thead>
          <tbody>${modelCostRows}</tbody>
        </table>
      </div>
    </div>` : ''}

    ${toolEntries.length ? `<div class="section">
      <div class="section-title">Tool Usage</div>
      <div class="tool-breakdown-list">
        ${toolEntries.slice(0, 15).map(([name, count]) => `<div class="tool-breakdown-row">
          <span class="tool-breakdown-name">${escapeHtml(name)}</span>
          <div class="tool-breakdown-bar-bg"><div class="tool-breakdown-bar" style="width:${(count / maxTool * 100).toFixed(0)}%"></div></div>
          <span class="tool-breakdown-count">${count}</span>
        </div>`).join('')}
      </div>
    </div>` : ''}

    <div class="section">
      <div class="section-title">Conversation (${turns.length} turns)</div>
      <div class="session-timeline">
        ${turns.map(t => `<div class="turn-item">
          <div class="turn-user">
            <div class="turn-user-label">You</div>
            <div class="turn-user-text">${escapeHtml(t.userMessage || '')}</div>
          </div>
          ${t.assistant ? `<div class="turn-assistant">
            <div class="turn-assistant-label">Claude${t.assistant.model ? ` (${t.assistant.model.split('-').slice(-2).join('-')})` : ''}</div>
            <div class="turn-assistant-text">${escapeHtml(t.assistant.text || '(no text response)')}</div>
            ${t.assistant.toolCalls?.length ? `<div class="turn-tool-calls">
              ${t.assistant.toolCalls.map(tc => `<span class="tool-call-badge" title="${escapeAttr(tc.inputPreview)}">${escapeHtml(tc.name)}</span>`).join('')}
            </div>` : ''}
            <div class="turn-meta">
              ${t.timestamp ? `<span>${new Date(t.timestamp).toLocaleTimeString()}</span>` : ''}
              ${t.assistant.tokenUsage ? `<span>${formatTokens(t.assistant.tokenUsage.output)} tokens out</span>` : ''}
            </div>
          </div>` : ''}
        </div>`).join('')}
      </div>
    </div>
  </div>`;
}

function renderCommandHistory() {
  if (!State.historyEntries && !State.sessionsLoading) {
    loadCommandHistory();
    return `<div class="loading-state"><div class="spinner"></div><p>Loading history…</p></div>`;
  }
  if (State.sessionsLoading && !State.historyEntries) {
    return `<div class="loading-state"><div class="spinner"></div><p>Loading history…</p></div>`;
  }

  const entries = State.historyEntries || [];

  // Group by day
  const days = {};
  for (const e of entries) {
    const day = e.timestamp ? new Date(e.timestamp).toISOString().slice(0, 10) : 'Unknown';
    if (!days[day]) days[day] = [];
    days[day].push(e);
  }

  return `<div>
    <div class="tab-header">
      <h2>Command History <span class="badge">${entries.length}</span></h2>
      <div class="session-toggle">
        <button class="session-toggle-btn" onclick="State.historyMode=false;State.costReportMode=false;renderTabContent()">Sessions</button>
        <button class="session-toggle-btn active">Command History</button>
        <button class="session-toggle-btn" onclick="State.historyMode=false;State.costReportMode=true;State.costReport=null;renderTabContent()">Cost Report</button>
      </div>
    </div>
    ${Object.entries(days).map(([day, items]) => `
      <div class="history-day-header">${day}</div>
      ${items.map(e => `<div class="history-entry">
        <span class="history-entry-text">${escapeHtml(e.display)}</span>
        ${e.project ? `<span class="history-entry-project">${escapeHtml(projectName(e.project))}</span>` : ''}
        <span class="history-entry-time">${e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : ''}</span>
      </div>`).join('')}
    `).join('')}
    ${!entries.length ? '<div class="empty-state" style="min-height:120px"><p>No command history found</p></div>' : ''}
  </div>`;
}

function renderCostReport() {
  const projectPath = State.mode === 'project' ? State.projectPath : '';

  if (!State.costReport && !State.costReportLoading) {
    loadCostReport();
    return `<div class="loading-state"><div class="spinner"></div><p>Loading cost data…</p></div>`;
  }
  if (State.costReportLoading && !State.costReport) {
    return `<div class="loading-state"><div class="spinner"></div><p>Loading cost data…</p></div>`;
  }

  const data = State.costReport || {};
  const totalByModel = data.totalByModel || {};
  const dailyCosts   = data.dailyCosts || [];

  // Compute total cost per model and grand total
  const modelCosts = Object.entries(totalByModel).map(([model, tk]) => ({
    model,
    tokens: tk,
    cost: calculateCost(tk, model),
  })).sort((a, b) => b.cost - a.cost);

  const grandTotal   = modelCosts.reduce((s, r) => s + r.cost, 0);
  const totalInput   = modelCosts.reduce((s, r) => s + (r.tokens.input || 0) * getPricing(r.model).input / 1_000_000, 0);
  const totalOutput  = modelCosts.reduce((s, r) => s + (r.tokens.output || 0) * getPricing(r.model).output / 1_000_000, 0);
  const totalCacheR  = modelCosts.reduce((s, r) => s + (r.tokens.cacheRead || 0), 0);
  const totalCacheW  = modelCosts.reduce((s, r) => s + (r.tokens.cacheWrite || 0), 0);
  // Cache savings: what cacheRead tokens would cost at full input price vs cacheRead price
  const cacheSavings = modelCosts.reduce((s, r) => {
    const p = getPricing(r.model);
    return s + (r.tokens.cacheRead || 0) * (p.input - p.cacheRead) / 1_000_000;
  }, 0);

  const maxModelCost = modelCosts.length ? modelCosts[0].cost : 1;

  // Top 10 sessions by cost (requires sessions list to be loaded)
  const sessions = State.sessionsList?.sessions || [];
  const topSessions = sessions
    .filter(s => s.tokenUsage && (s.tokenUsage.input + s.tokenUsage.output) > 0)
    .map(s => ({ ...s, cost: calculateCost(s.tokenUsage, s.modelsUsed?.[0]) }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 10);

  // Daily cost totals for chart
  const dailyTotals = dailyCosts.map(d => {
    const total = Object.entries(d.tokensByModel).reduce((s, [m, tk]) => s + calculateCost(tk, m), 0);
    return { date: d.date, total };
  });

  return `<div>
    <div class="tab-header">
      <h2>Cost Report <span class="badge">${escapeHtml(formatCost(grandTotal))}</span></h2>
      <div class="session-toggle">
        <button class="session-toggle-btn" onclick="State.historyMode=false;State.costReportMode=false;renderTabContent()">Sessions</button>
        <button class="session-toggle-btn" onclick="State.historyMode=true;State.costReportMode=false;State.historyEntries=null;renderTabContent()">Command History</button>
        <button class="session-toggle-btn active">Cost Report</button>
      </div>
    </div>
    ${!projectPath ? '<p style="font-size:12px;color:var(--text-muted);margin-bottom:10px">Select a project to see project-specific costs. Showing all projects.</p>' : ''}

    <div class="session-summary" style="grid-template-columns:repeat(4,1fr)">
      <div class="session-summary-card accent">
        <div class="session-summary-label">Total Cost</div>
        <div class="session-summary-value">${escapeHtml(formatCost(grandTotal))}</div>
      </div>
      <div class="session-summary-card">
        <div class="session-summary-label">Input Cost</div>
        <div class="session-summary-value">${escapeHtml(formatCost(totalInput))}</div>
      </div>
      <div class="session-summary-card">
        <div class="session-summary-label">Output Cost</div>
        <div class="session-summary-value">${escapeHtml(formatCost(totalOutput))}</div>
      </div>
      <div class="session-summary-card">
        <div class="session-summary-label">Cache Savings</div>
        <div class="session-summary-value" style="color:var(--status-full)">${escapeHtml(formatCost(cacheSavings))}</div>
      </div>
    </div>

    ${dailyTotals.length > 1 ? `<div class="section">
      <div class="section-title">Daily Cost</div>
      <canvas id="cost-chart" style="width:100%;height:220px;display:block"></canvas>
    </div>` : ''}

    ${modelCosts.length ? `<div class="section">
      <div class="section-title">Cost by Model</div>
      <div class="tool-breakdown-list">
        ${modelCosts.map(r => `<div class="tool-breakdown-row">
          <span class="tool-breakdown-name" style="font-family:monospace">${escapeHtml(r.model.split('-').slice(-3).join('-'))}</span>
          <div class="tool-breakdown-bar-bg"><div class="tool-breakdown-bar" style="width:${(r.cost / maxModelCost * 100).toFixed(0)}%"></div></div>
          <span class="tool-breakdown-count">${escapeHtml(formatCost(r.cost))}</span>
        </div>`).join('')}
      </div>
      <div style="overflow-x:auto;margin-top:12px">
        <table class="cost-breakdown-table">
          <thead><tr><th>Model</th><th>Input Tok</th><th>Output Tok</th><th>Cache Write</th><th>Cache Read</th><th>Cost</th></tr></thead>
          <tbody>${modelCosts.map(r => `<tr>
            <td style="font-family:monospace;font-size:12px">${escapeHtml(r.model.split('-').slice(-3).join('-'))}</td>
            <td>${formatTokens(r.tokens.input)}</td>
            <td>${formatTokens(r.tokens.output)}</td>
            <td>${formatTokens(r.tokens.cacheWrite)}</td>
            <td>${formatTokens(r.tokens.cacheRead)}</td>
            <td style="font-weight:600;color:var(--accent-teal)">${escapeHtml(formatCost(r.cost))}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
    </div>` : '<div class="empty-state" style="min-height:120px"><p>No cost data available</p></div>'}

    ${topSessions.length ? `<div class="section">
      <div class="section-title">Top Sessions by Cost</div>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${topSessions.map(s => `<div class="session-card" style="cursor:pointer" onclick="openSessionDetail('${escapeAttr(s.id)}')">
          <div class="session-card-top">
            <div class="session-card-title">${escapeHtml(s.title)}</div>
            <div class="session-card-meta">
              ${s.gitBranch ? `<span class="session-badge branch">${escapeHtml(s.gitBranch)}</span>` : ''}
              ${s.modelsUsed?.length ? `<span class="session-badge model">${escapeHtml(s.modelsUsed[0].split('-').slice(-2).join('-'))}</span>` : ''}
              <span class="session-badge cost">${escapeHtml(formatCost(s.cost))}</span>
              <span>${formatTokens((s.tokenUsage.input || 0) + (s.tokenUsage.output || 0))} tokens</span>
              ${s.startedAt ? `<span>${timeSince(s.startedAt)}</span>` : ''}
            </div>
          </div>
        </div>`).join('')}
      </div>
    </div>` : ''}

    <p style="font-size:11px;color:var(--text-muted);margin-top:16px">
      Costs are estimates based on public Anthropic pricing. Scanned ${data.sessionsScanned || 0} sessions.
      Prices subject to change — verify at <a href="https://www.anthropic.com/pricing" target="_blank" style="color:var(--text-muted)">anthropic.com/pricing</a>.
    </p>
  </div>`;
}

async function loadCostReport() {
  const projectPath = State.mode === 'project' ? State.projectPath : '';
  State.costReportLoading = true;
  try {
    State.costReport = await API.costStats(projectPath);
    // Also load sessions list if not already loaded (needed for top-sessions table)
    if (!State.sessionsList && projectPath) loadSessionsList();
  } catch { State.costReport = { dailyCosts: [], totalByModel: {}, sessionsScanned: 0 }; }
  State.costReportLoading = false;
  renderTabContent();
  // Init chart after render
  setTimeout(() => initCostChart(), 50);
}

function initCostChart() {
  const canvas = document.getElementById('cost-chart');
  if (!canvas || !State.costReport) return;
  const dailyCosts = State.costReport.dailyCosts || [];
  const daily = dailyCosts.map(d => ({
    date: d.date,
    total: Object.entries(d.tokensByModel).reduce((s, [m, tk]) => s + calculateCost(tk, m), 0),
  }));
  if (daily.length < 2) return;
  drawCostChart(canvas, daily);
  const ro = new ResizeObserver(() => drawCostChart(canvas, daily));
  ro.observe(canvas.parentElement);
}

function drawCostChart(canvas, daily) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.parentElement.clientWidth;
  const H = 220;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const PAD = { top: 20, right: 20, bottom: 36, left: 64 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top  - PAD.bottom;
  const n  = daily.length;

  const vals = daily.map(d => d.total);
  const maxY = Math.max(...vals, 0.001);

  const toX = i => PAD.left + (i / Math.max(n - 1, 1)) * cW;
  const toY = v => PAD.top  + cH - (v / maxY) * cH;

  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const gridColor  = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';
  const labelColor = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)';
  const lineColor  = '#00d4aa';

  // Grid lines
  ctx.font = '11px system-ui,sans-serif';
  ctx.fillStyle = labelColor;
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const y = PAD.top + (cH / 4) * i;
    const v = maxY * (1 - i / 4);
    ctx.strokeStyle = gridColor;
    ctx.lineWidth   = 1;
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + cW, y); ctx.stroke();
    ctx.fillText('$' + (v < 0.01 ? v.toFixed(4) : v < 1 ? v.toFixed(3) : v.toFixed(2)), PAD.left - 6, y + 4);
  }

  // Filled area
  ctx.beginPath();
  ctx.moveTo(toX(0), toY(vals[0]));
  for (let i = 1; i < n; i++) ctx.lineTo(toX(i), toY(vals[i]));
  ctx.lineTo(toX(n - 1), PAD.top + cH);
  ctx.lineTo(toX(0), PAD.top + cH);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + cH);
  grad.addColorStop(0, 'rgba(0,212,170,0.25)');
  grad.addColorStop(1, 'rgba(0,212,170,0)');
  ctx.fillStyle = grad;
  ctx.fill();

  // Line
  ctx.beginPath();
  ctx.moveTo(toX(0), toY(vals[0]));
  for (let i = 1; i < n; i++) ctx.lineTo(toX(i), toY(vals[i]));
  ctx.strokeStyle = lineColor;
  ctx.lineWidth   = 2;
  ctx.lineJoin    = 'round';
  ctx.stroke();

  // X-axis labels
  ctx.fillStyle  = labelColor;
  ctx.textAlign  = 'center';
  const step = Math.max(1, Math.floor(n / 7));
  for (let i = 0; i < n; i += step) {
    ctx.fillText(daily[i].date.slice(5), toX(i), H - PAD.bottom + 16);
  }
}

async function loadCommandHistory() {
  State.sessionsLoading = true;
  try {
    const projectPath = State.mode === 'project' ? State.projectPath : '';
    const data = await API.history(projectPath);
    State.historyEntries = data.entries || [];
  } catch { State.historyEntries = []; }
  State.sessionsLoading = false;
  renderTabContent();
}

// ─── Import/Export Modals ─────────────────────────────────────
function openImportModal(type) {
  State.importModalOpen = true;
  document.getElementById('import-overlay')?.classList.remove('hidden');
  document.getElementById('import-modal-title').textContent = type === 'skill' ? 'Import Skill' : 'Import Command';
  document.getElementById('import-textarea').value = '';
  document.getElementById('import-preview').classList.add('hidden');
  document.getElementById('import-confirm-btn').disabled = true;
  // Set scope based on current mode
  const scopeEl = document.getElementById('import-scope');
  if (scopeEl && State.mode === 'project') scopeEl.value = 'project';
}

function closeImportModal() {
  State.importModalOpen = false;
  document.getElementById('import-overlay')?.classList.add('hidden');
}

function handleImportDrop(event) {
  event.preventDefault();
  event.currentTarget.classList.remove('dragover');
  const file = event.dataTransfer?.files?.[0];
  if (file) loadImportFile(file);
}

function handleImportFileSelect(event) {
  const file = event.target.files?.[0];
  if (file) loadImportFile(file);
  event.target.value = ''; // reset so same file can be re-selected
}

async function loadImportFile(file) {
  const dropZone = document.getElementById('import-drop-zone');
  const label = dropZone?.querySelector('.import-drop-label');
  if (label) label.textContent = file.name;

  if (file.name.endsWith('.zip')) {
    try {
      const zip = await JSZip.loadAsync(file);
      const commands = [];
      const skills = [];
      let claudeMd = null;
      const tasks = [];

      zip.forEach((relPath, entry) => {
        if (entry.dir) return;
        tasks.push(entry.async('string').then(content => {
          const lower = relPath.toLowerCase();
          const name  = relPath.split('/').pop().replace(/\.md$/i, '');
          if (lower.startsWith('commands/') || lower.startsWith('command/')) {
            commands.push({ name, content });
          } else if (lower.startsWith('skills/') || lower.startsWith('skill/')) {
            skills.push({ name, content });
          } else if (lower === 'claude.md') {
            claudeMd = content;
          } else if (lower.endsWith('.md')) {
            // unknown folder — treat as command
            commands.push({ name, content });
          }
        }));
      });

      await Promise.all(tasks);
      const bundle = JSON.stringify({
        type: 'claude-map-bundle',
        version: '1',
        ...(commands.length ? { commands } : {}),
        ...(skills.length   ? { skills }   : {}),
        ...(claudeMd        ? { claudeMd } : {}),
      }, null, 2);
      document.getElementById('import-textarea').value = bundle;
      previewImport();
    } catch (e) {
      alert('Could not read ZIP: ' + e.message);
    }
  } else {
    const reader = new FileReader();
    reader.onload = () => {
      document.getElementById('import-textarea').value = reader.result;
      previewImport();
    };
    reader.readAsText(file);
  }
}

function previewImport() {
  const text = document.getElementById('import-textarea').value.trim();
  const previewEl = document.getElementById('import-preview');
  const confirmBtn = document.getElementById('import-confirm-btn');
  if (!text) {
    previewEl.classList.add('hidden');
    confirmBtn.disabled = true;
    return;
  }

  // Try to detect if it's a bundle JSON or a skill/command markdown
  try {
    const json = JSON.parse(text);
    if (json.type === 'claude-map-bundle') {
      const skills = json.skills?.length || 0;
      const commands = json.commands?.length || 0;
      previewEl.innerHTML = `<strong>Bundle detected</strong>: ${skills} skill${skills !== 1 ? 's' : ''}, ${commands} command${commands !== 1 ? 's' : ''}${json.claudeMd ? ', CLAUDE.md' : ''}`;
      previewEl.classList.remove('hidden');
      confirmBtn.disabled = false;
      confirmBtn.dataset.mode = 'bundle';
      confirmBtn.dataset.bundle = text;
      return;
    }
  } catch { /* not JSON, treat as markdown */ }

  // Markdown skill/command
  const name = extractImportedSkillName(text);
  previewEl.innerHTML = `<strong>Skill:</strong> ${escapeHtml(name)} (${text.split(/\s+/).length} words)`;
  previewEl.classList.remove('hidden');
  confirmBtn.disabled = false;
  confirmBtn.dataset.mode = 'single';
  confirmBtn.dataset.name = name;
}

async function confirmImport() {
  const btn = document.getElementById('import-confirm-btn');
  const text = document.getElementById('import-textarea').value.trim();
  const scope = document.getElementById('import-scope').value;

  if (btn.dataset.mode === 'bundle') {
    try {
      const bundle = JSON.parse(text);
      const result = await fetch('/api/import/bundle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bundle,
          target: scope,
          projectPath: State.projectPath || '',
          overwrite: false
        })
      }).then(r => r.json());
      alert(`Imported: ${result.imported?.skills || 0} skills, ${result.imported?.commands || 0} commands${result.skipped?.length ? `\nSkipped (existing): ${result.skipped.join(', ')}` : ''}`);
    } catch (e) { alert('Import failed: ' + e.message); }
  } else {
    const name = btn.dataset.name || 'imported-skill';
    try {
      await fetch('/api/skills/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, content: text, scope, projectPath: State.projectPath || '' })
      }).then(r => r.json());
      alert(`Skill "${name}" imported successfully`);
    } catch (e) { alert('Import failed: ' + e.message); }
  }

  closeImportModal();
  doRefresh();
}

function openBundleModal() {
  document.getElementById('bundle-overlay')?.classList.remove('hidden');
  if (State.mode === 'project') {
    document.getElementById('bundle-scope').value = 'project';
  }
}

function closeBundleModal() {
  document.getElementById('bundle-overlay')?.classList.add('hidden');
}

async function confirmBundleExport() {
  const items = [];
  if (document.getElementById('bundle-skills')?.checked) items.push('skills');
  if (document.getElementById('bundle-commands')?.checked) items.push('commands');
  if (document.getElementById('bundle-claudemd')?.checked) items.push('claudeMd');
  if (!items.length) { alert('Select at least one item to export'); return; }

  const scope = document.getElementById('bundle-scope').value;

  // Use form submit to trigger download
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = '/api/export/bundle';
  form.style.display = 'none';

  // We need to POST JSON, so use fetch instead
  try {
    const res = await fetch('/api/export/bundle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, scope, projectPath: State.projectPath || '' })
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `claude-map-bundle-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) { alert('Export failed: ' + e.message); }
  closeBundleModal();
}

// ─── Share / Download Commands ────────────────────────────────
function triggerDownload(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function shareCommandByName(btn, name) {
  const allCmds = [
    ...(State.scan?.global?.commands || []),
    ...(State.scan?.project?.localCommands || []),
  ];
  const cmd = allCmds.find(c => c.name === name);
  if (!cmd) return;
  const blob = new Blob([cmd.body], { type: 'text/markdown' });
  triggerDownload(`${name}.md`, blob);
  const orig = btn.textContent;
  btn.textContent = '✓ Saved';
  btn.classList.add('copied');
  setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 1500);
}

async function shareCommandSet(scope, btn) {
  const cmds = scope === 'local'
    ? State.scan?.project?.localCommands || []
    : State.scan?.global?.commands || [];
  if (!cmds.length) return;

  const zip = new JSZip();
  const folder = zip.folder('commands');
  cmds.forEach(c => folder.file(`${c.name}.md`, c.body));
  const blob = await zip.generateAsync({ type: 'blob' });

  const label = scope === 'local'
    ? (projectName(State.projectPath) || 'project')
    : 'global';
  triggerDownload(`claude-commands-${label}.zip`, blob);

  const orig = btn.textContent;
  btn.textContent = `✓ Downloaded`;
  btn.classList.add('copied');
  setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 1500);
}

// ─── Export & Refresh ─────────────────────────────────────────
function doExport() {
  if (!State.scan) { alert('Nothing to export. Load a project first.'); return; }
  window.location.href = State.projectPath
    ? `/api/export?project=${encodeURIComponent(State.projectPath)}`
    : '/api/export';
}

// Silent refresh — re-fetches data without resetting current tab or navigation state
async function doSilentRefresh() {
  try {
    if (State.mode === 'project' && State.projectPath) {
      const [analysis, scan] = await Promise.allSettled([
        API.analyze(State.projectPath),
        API.scan(State.projectPath),
      ]);
      if (analysis.status === 'fulfilled') State.analysis = analysis.value;
      if (scan.status === 'fulfilled')     State.scan     = scan.value;
    } else {
      const scan = await API.scan(null);
      State.scan = scan;
    }
    renderApp();
    renderProjectList();
  } catch { /* ignore — stale data is fine */ }
}

function doRefresh() {
  if (State.mode === 'project' && State.projectPath) {
    selectProject(State.projectPath);
  } else {
    loadGlobal();
  }
}

// ─── SSE Client ───────────────────────────────────────────────
function initSSE() {
  const es = new EventSource('/api/events');

  es.addEventListener('connected', () => {
    State.sseConnected = true;
    updateSseIndicator(true);
  });

  es.addEventListener('cache-invalidated', () => {
    clearTimeout(State.refreshTimer);
    State.refreshTimer = setTimeout(() => doSilentRefresh(), 800);
    if (State.editorPath && State.currentTab === 'editor' && !State.editorDirty) {
      reloadEditorFile();
    }
  });

  es.onerror = () => {
    State.sseConnected = false;
    updateSseIndicator(false);
  };
}

function updateSseIndicator(connected) {
  const dot   = document.querySelector('.sse-dot');
  const label = document.querySelector('.sse-label');
  if (!dot || !label) return;
  dot.className     = `sse-dot ${connected ? 'connected' : 'disconnected'}`;
  label.textContent = connected ? 'Live' : 'Disconnected';
}

// ─── Directory Browser Modal ──────────────────────────────────
const Browser = {
  mode:        'add-project',  // 'add-project'
  currentPath: null,
  showHidden:  false,
};

function openAddProjectBrowser() {
  Browser.mode = 'add-project';
  document.getElementById('dir-browser-overlay').classList.remove('hidden');
  document.getElementById('browser-show-hidden').checked = Browser.showHidden;
  loadBookmarks();
  browserNavigate(null);
}

function closeBrowser() {
  document.getElementById('dir-browser-overlay').classList.add('hidden');
}

function confirmBrowser() {
  if (!Browser.currentPath) return;
  if (Browser.mode === 'add-project') {
    addPinnedProject(Browser.currentPath);
  }
  closeBrowser();
}

function browserToggleHidden() {
  Browser.showHidden = document.getElementById('browser-show-hidden').checked;
  browserNavigate(Browser.currentPath);
}

async function loadBookmarks() {
  try {
    const { bookmarks } = await API.get('/api/browse/bookmarks');
    const el = document.getElementById('browser-bookmarks');
    if (!el) return;
    el.innerHTML = bookmarks.map(b =>
      `<button class="bookmark-btn" onclick="browserNavigate('${escapeAttr(b.path)}')">${escapeHtml(b.name)}</button>`
    ).join('');
  } catch { /* ignore */ }
}

async function browserNavigate(dirPath) {
  const listEl  = document.getElementById('browser-list');
  const crumbEl = document.getElementById('browser-crumbs');
  const errorEl = document.getElementById('browser-error');
  const pathEl  = document.getElementById('browser-current-path');
  if (!listEl) return;

  listEl.innerHTML = '<div class="loading-state" style="min-height:100px"><div class="spinner"></div></div>';
  errorEl?.classList.add('hidden');

  const qs = dirPath
    ? `/api/browse?path=${encodeURIComponent(dirPath)}&hidden=${Browser.showHidden ? 1 : 0}`
    : `/api/browse?hidden=${Browser.showHidden ? 1 : 0}`;

  try {
    const data = await API.get(qs);
    Browser.currentPath = data.current;
    if (pathEl) pathEl.textContent = data.current;

    if (data.error && errorEl) {
      errorEl.textContent = data.error;
      errorEl.classList.remove('hidden');
    }

    if (crumbEl) {
      crumbEl.innerHTML = data.crumbs.map((c, i) => {
        const isLast = i === data.crumbs.length - 1;
        return `${i > 0 ? '<span class="crumb-sep">/</span>' : ''}<span class="crumb ${isLast ? 'last' : ''}" onclick="${isLast ? '' : `browserNavigate('${escapeAttr(c.path)}')`}">${escapeHtml(c.name)}</span>`;
      }).join('');
    }

    if (!data.dirs.length) {
      listEl.innerHTML = '<div class="browser-empty">No subfolders here</div>';
      return;
    }

    listEl.innerHTML = data.dirs.map(d => `
      <div class="dir-entry" onclick="browserNavigate('${escapeAttr(d.path)}')">
        <span class="dir-icon">${d.name.startsWith('.') ? '📁' : '📂'}</span>
        <span class="dir-name">${escapeHtml(d.name)}</span>
        <span class="dir-enter">›</span>
      </div>`).join('');

  } catch (e) {
    listEl.innerHTML = `<div class="browser-empty">Error: ${escapeHtml(e.message)}</div>`;
  }
}

// ─── Init ─────────────────────────────────────────────────────
async function initFromUrl() {
  const params = new URLSearchParams(location.search);
  const slug   = params.get('project');
  const tab    = params.get('tab');

  await loadPinnedProjects();

  if (slug) {
    const fullPath = resolveProjectSlug(slug);
    if (fullPath) {
      await selectProject(fullPath);
      if (tab && TABS_PROJECT.includes(tab)) {
        State.currentTab = tab;
        syncGroupFromTab(tab);
        renderApp();
      }
    } else {
      // Slug not found — load global silently
      await loadGlobal();
    }
  } else {
    await loadGlobal();
    if (tab && TABS_GLOBAL.includes(tab)) {
      State.currentTab = tab;
      syncGroupFromTab(tab);
      renderApp();
    }
  }

  // Normalize URL to canonical form without pushing a new history entry
  history.replaceState(null, '', buildUrl());
}

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  restoreSidebarState();
  initSSE();
  loadPinnedProjects().then(() => loadGlobal());

  // Ctrl+` / Cmd+` — toggle terminal (VS Code style)
  document.addEventListener('keydown', e => {
    if (e.key === '`' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (State.currentTab !== 'editor') {
        State.currentTab = 'editor';
        syncGroupFromTab('editor');
        renderApp();
      }
      const panel = document.getElementById('terminal-panel');
      if (panel && panel.classList.contains('hidden')) {
        if (Object.keys(_terminals).length === 0) trayNewTerminal();
        else expandTerminal();
      } else {
        minimizeTerminal();
      }
    }
  });

  initTerminalResize();
});
