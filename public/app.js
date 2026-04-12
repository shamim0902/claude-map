// ═══════════════════════════════════════════════════════════════
//  Claude Map — Frontend Application  v2.0
// ═══════════════════════════════════════════════════════════════

// ─── State ────────────────────────────────────────────────────
const State = {
  // Navigation
  mode: 'global',        // 'global' | 'project'
  projectPath: '',
  currentTab: 'overview',
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

  // Misc
  sseConnected: false,
  refreshTimer: null,
  statsSort: 'date-desc',
};

// ─── Tab Definitions ──────────────────────────────────────────
const TABS_GLOBAL  = ['overview','commands','skills','plans','settings','mcp','stats','raw'];
const TABS_PROJECT = ['map','overview','commands','skills','plans','settings','mcp','stats','raw'];

const TAB_META = {
  map:      { label: 'Map' },
  overview: { label: 'Overview' },
  commands: { label: 'Commands' },
  skills:   { label: 'Skills' },
  plans:    { label: 'Plans' },
  settings: { label: 'Settings' },
  mcp:      { label: 'MCP & Plugins' },
  stats:    { label: 'Stats' },
  raw:      { label: 'Raw' },
};

function getCurrentTabs() {
  return State.mode === 'project' ? TABS_PROJECT : TABS_GLOBAL;
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
  }
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
}

function toggleTheme() {
  applyTheme(State.theme === 'dark' ? 'light' : 'dark');
}

// ─── Navigation ───────────────────────────────────────────────
function selectGlobal() {
  State.mode        = 'global';
  State.projectPath = '';
  State.currentTab  = 'overview';
  State.analysis    = null;
  State.activeNodeId = null;

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
  State.mode        = 'project';
  State.projectPath = path;
  State.currentTab  = 'map';
  State.activeNodeId = null;
  State.analysis    = null;
  State.analysisLoading = true;
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
  State.currentTab = tab;
  State.activeNodeId = null;
  renderApp();
}

// ─── Render Pipeline ──────────────────────────────────────────
function renderApp() {
  renderProjectList();
  renderTabBar();
  renderTabContent();
}

function renderTabBar() {
  const tabs = getCurrentTabs();
  const scan = State.scan;
  const g    = scan?.global;
  const counts = {
    commands: (State.mode === 'project' ? State.scan?.project?.localCommands?.length : g?.commands?.length) || g?.commands?.length || 0,
    skills:   (State.mode === 'project' ? State.scan?.project?.localSkills?.length  : g?.skills?.length)   || g?.skills?.length   || 0,
    plans:    g?.plans?.length || 0,
  };

  const tabBar = document.getElementById('tab-bar');
  if (!tabBar) return;
  tabBar.innerHTML = tabs.map(id => {
    const meta   = TAB_META[id] || { label: id };
    const active = id === State.currentTab;
    const badge  = counts[id] != null && counts[id] > 0
      ? `<span class="tab-badge">${counts[id]}</span>` : '';
    return `<div class="tab-item ${active ? 'active' : ''}" onclick="navigate('${id}')">${meta.label}${badge}</div>`;
  }).join('');
}

function renderTabContent() {
  const el = document.getElementById('tab-content');
  if (!el) return;

  if (State.currentTab === 'map' && State.mode === 'project') {
    el.innerHTML = renderMapTab();
    requestAnimationFrame(() => drawMapSvgLines());
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
    settings: renderSettings,
    mcp:      renderMCP,
    stats:    renderStats,
    raw:      renderRaw,
  };

  el.innerHTML = (renderers[State.currentTab] || renderEmpty)();

  if (State.currentTab === 'stats') {
    requestAnimationFrame(() => initStatsChart());
  }
  attachCopyButtons();
}

// ─── State renders ────────────────────────────────────────────
function renderLoading() {
  return `<div class="loading-state"><div class="spinner"></div><p>Scanning configuration…</p></div>`;
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
  return `<div class="card" id="card-${safeId}">
    <div class="card-header" onclick="toggleCard('${safeId}')">
      <span class="card-title">${escapeHtml(title)}</span>
      <div class="card-meta">${metaHtml || ''}</div>
      <span class="expand-icon">▶</span>
    </div>
    <div class="card-excerpt">${escapeHtml(excerpt || '')}</div>
    <div class="card-body hidden" id="body-${safeId}" data-raw="${escapeAttr(body)}"></div>
  </div>`;
}

function toggleCard(id) {
  const card = document.getElementById(`card-${id}`);
  const body = document.getElementById(`body-${id}`);
  if (!card || !body) return;
  const isOpen = body.classList.toggle('visible');
  body.classList.toggle('hidden', !isOpen);
  card.classList.toggle('expanded', isOpen);

  if (isOpen && !body.dataset.rendered) {
    body.dataset.rendered = '1';
    const raw = body.dataset.raw || '';
    const mdDiv = document.createElement('div');
    mdDiv.className = 'markdown-body';
    try {
      mdDiv.innerHTML = marked.parse(raw);
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
  html += `<div class="sidebar-project-item ${isGlobal ? 'active' : ''}" onclick="selectGlobal()">
    <span class="proj-status-icon full">◈</span>
    <span class="proj-name">Global Config</span>
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

  return `<div class="sidebar-project-item ${isActive ? 'active' : ''}"
             onclick="selectProject('${escapeAttr(path)}')" title="${escapeAttr(path)}">
    <span class="${iconClass}">${icon}</span>
    <span class="proj-name">${escapeHtml(name)}</span>
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
  </div>`;
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
  requestAnimationFrame(() => drawMapSvgLines());
}

function onMapNodeClose() {
  State.activeNodeId = null;
  renderTabContent();
  requestAnimationFrame(() => drawMapSvgLines());
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
      try { md.innerHTML = marked.parse(cm.raw || ''); } catch { md.textContent = cm.raw; }
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
      try { md.innerHTML = marked.parse(lc.raw || ''); } catch { md.textContent = lc.raw; }
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
  svg.setAttribute('width',  cRect.width);
  svg.setAttribute('height', cRect.height);
  svg.innerHTML = '';

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
    if (!from || !to) return;

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
  const g = State.scan.global;
  const proj = State.scan.project;
  const s = g.settings || {};
  const perms = s.permissions?.allow?.length || 0;
  const plugins = Object.values(s.enabledPlugins || {}).filter(Boolean).length;
  const projects = g.projects?.length || 0;

  const metricCards = [
    renderMetricCard('Commands', g.commands?.length || 0, 'slash commands', true),
    renderMetricCard('Skills', g.skills?.length || 0, 'in skills/'),
    renderMetricCard('Plans', g.plans?.length || 0, 'plan files'),
    renderMetricCard('Permissions', perms, 'allow-list entries'),
    renderMetricCard('Plugins', plugins, 'enabled'),
    renderMetricCard('Projects', projects, 'known paths'),
  ];

  const claudeMdHtml = g.claudeMd
    ? `<div class="claude-md-preview" onclick="toggleClaudeMdFull()">
        <div class="section-title" style="margin-bottom:8px">CLAUDE.md</div>
        <div id="claude-md-excerpt" class="markdown-body" style="font-size:12px;padding-top:0">
          ${g.claudeMd.excerpt ? escapeHtml(g.claudeMd.excerpt) : '<em>empty</em>'}
        </div>
        <div id="claude-md-full" class="markdown-body" style="display:none"></div>
        <div class="claude-md-toggle">▼ Expand full CLAUDE.md</div>
      </div>`
    : `<div class="empty-state" style="min-height:80px"><p>No CLAUDE.md found</p></div>`;

  const hooksCount = Object.values(s.hooks || {}).reduce((a, arr) => a + arr.length, 0);
  const configHtml = `<div class="config-grid">
    <span class="config-key">Model</span><span class="config-value">${escapeHtml(s.model || '—')}</span>
    <span class="config-key">Effort</span><span class="config-value">${escapeHtml(s.effortLevel || '—')}</span>
    <span class="config-key">Hooks</span><span class="config-value">${hooksCount} hook${hooksCount !== 1 ? 's' : ''} configured</span>
    <span class="config-key">Plugins</span><span class="config-value">${Object.keys(s.enabledPlugins || {}).join(', ') || '—'}</span>
    <span class="config-key">Last scan</span><span class="config-value">${timeSince(State.scan.meta?.scannedAt)}</span>
  </div>`;

  const addDirs = s.permissions?.additionalDirectories || [];
  const addDirsHtml = addDirs.length
    ? `<div class="dir-list">${addDirs.map(d => `<div class="dir-item">${escapeHtml(d)}</div>`).join('')}</div>`
    : `<p style="font-size:12px;color:var(--text-muted)">None configured</p>`;

  const visibleProjects = (g.projects || []).filter(p => p.verified).slice(0, 20);
  const projectsHtml = visibleProjects.length
    ? `<div class="project-list-grid">
        ${visibleProjects.map(p => `
          <div class="project-card" onclick="selectProject('${escapeAttr(p.decodedPath)}')">
            <div class="project-card-path">${escapeHtml(p.decodedPath)}</div>
            <div class="project-card-meta">
              <span class="${p.verified ? 'dot-verified' : 'dot-unverified'}">● ${p.verified ? 'verified' : 'not found'}</span>
              ${p.hasLocalClaude ? '<span>has .claude/</span>' : ''}
              ${p.sessionCount ? `<span>${p.sessionCount} session${p.sessionCount > 1 ? 's' : ''}</span>` : ''}
            </div>
          </div>`).join('')}
      </div>`
    : `<p style="font-size:12px;color:var(--text-muted)">No verified project paths found</p>`;

  const projHtml = proj
    ? `<div class="section">
        <div class="section-title">Active Project: ${escapeHtml(proj.projectName)}</div>
        <div class="config-grid">
          <span class="config-key">Path</span><span class="config-value" style="font-family:var(--font-mono);font-size:11px">${escapeHtml(proj.path)}</span>
          <span class="config-key">.claude/</span><span class="config-value">${proj.hasClaudeDir ? '✓ present' : '✗ not found'}</span>
          ${proj.settingsLocal ? `<span class="config-key">Local perms</span><span class="config-value">${proj.settingsLocal.permissions?.allow?.length || 0} allow entries</span>` : ''}
          ${proj.mcpJson ? `<span class="config-key">MCP servers</span><span class="config-value">${Object.keys(proj.mcpJson.mcpServers || {}).length}</span>` : ''}
        </div>
      </div>` : '';

  return `
    <div class="metrics-row">${metricCards.join('')}</div>
    ${projHtml}
    <div class="section">
      <div class="section-title">Configuration</div>
      ${configHtml}
    </div>
    <div class="section">
      <div class="section-title">CLAUDE.md — Global Instructions</div>
      ${claudeMdHtml}
    </div>
    <div class="section">
      <div class="section-title">Additional Directories (${addDirs.length})</div>
      ${addDirsHtml}
    </div>
    <div class="section">
      <div class="section-title">Known Projects (${visibleProjects.length})</div>
      ${projectsHtml}
    </div>
  `;
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
    try { full.innerHTML = marked.parse(State.scan.global.claudeMd.raw || ''); }
    catch { full.textContent = State.scan.global.claudeMd.raw || ''; }
    attachCopyButtons(full);
  }
}

// ─── Commands Tab ─────────────────────────────────────────────
function renderCommands() {
  const commands = State.scan.global.commands || [];
  const q = State.commandFilter.toLowerCase();
  const filtered = q
    ? commands.filter(c => c.name.toLowerCase().includes(q) || c.excerpt.toLowerCase().includes(q) || c.body.toLowerCase().includes(q))
    : commands;

  return `<div>
    <div class="tab-header">
      <h2>Commands <span class="badge">${commands.length}</span></h2>
      <input class="search-input" placeholder="Filter commands…"
             value="${escapeAttr(State.commandFilter)}"
             oninput="State.commandFilter=this.value;renderTabContent()">
    </div>
    <div class="cards-grid">
      ${filtered.length
        ? filtered.map(c => renderCommandCard(c, 'cmd_')).join('')
        : `<div class="empty-state" style="min-height:120px"><p>No commands match "<strong>${escapeHtml(q)}</strong>"</p></div>`}
    </div>
  </div>`;
}

function renderCommandCard(c, prefix = '') {
  const metaHtml = [
    c.hasArgs ? `<span class="type-badge args">$ARGS</span>` : '',
    `<span style="font-size:11px;color:var(--text-muted)">${c.wordCount}w</span>`
  ].join('');
  return renderExpandableCard({
    id: prefix + c.name,
    title: c.name,
    metaHtml,
    excerpt: c.excerpt,
    body: c.body
  });
}

// ─── Skills Tab ───────────────────────────────────────────────
function renderSkills() {
  const skills = State.scan.global.skills || [];
  if (!skills.length) {
    return `<div>
      <div class="tab-header"><h2>Skills <span class="badge">0</span></h2></div>
      <div class="empty-state" style="min-height:200px">
        <div class="empty-state-icon">◻</div>
        <h3>No skills configured</h3>
        <p>The <span class="inline-code">~/.claude/skills/</span> directory exists but is empty.</p>
      </div>
    </div>`;
  }

  const q = State.skillFilter.toLowerCase();
  const filtered = q
    ? skills.filter(s => s.name.toLowerCase().includes(q) || s.excerpt.toLowerCase().includes(q))
    : skills;

  return `<div>
    <div class="tab-header">
      <h2>Skills <span class="badge">${skills.length}</span></h2>
      <input class="search-input" placeholder="Filter skills…"
             value="${escapeAttr(State.skillFilter)}"
             oninput="State.skillFilter=this.value;renderTabContent()">
    </div>
    <div class="cards-grid">
      ${filtered.map(s => renderCommandCard(s, 'skill_')).join('')}
    </div>
  </div>`;
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

// ─── Stats Tab ────────────────────────────────────────────────
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
  canvas.width  = W;
  canvas.height = 280;
  const H   = 280;
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

// ─── Export & Refresh ─────────────────────────────────────────
function doExport() {
  if (!State.scan) { alert('Nothing to export. Load a project first.'); return; }
  window.location.href = State.projectPath
    ? `/api/export?project=${encodeURIComponent(State.projectPath)}`
    : '/api/export';
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
    State.refreshTimer = setTimeout(() => doRefresh(), 800);
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
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initSSE();
  loadPinnedProjects().then(() => loadGlobal());
});
