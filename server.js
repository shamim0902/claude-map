'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const matter  = require('gray-matter');
const chokidar = require('chokidar');

const app       = express();
app.use(express.json());
const PORT      = process.env.PORT || 3131;
const CLAUDE_DIR    = path.resolve(os.homedir(), '.claude');
const PINNED_FILE   = path.join(CLAUDE_DIR, 'inspector-projects.json');

// ─── Cache ────────────────────────────────────────────────────────────────────

const cache = { data: null, ts: 0, ttl: 5000 };

function invalidateCache() {
  cache.data = null;
  cache.ts   = 0;
}

async function getCachedScan(projectPath) {
  const now = Date.now();
  const key = projectPath || '__global__';
  if (cache.data && cache.key === key && (now - cache.ts) < cache.ttl) {
    return cache.data;
  }
  const result = await buildScanResult(projectPath);
  cache.data = result;
  cache.key  = key;
  cache.ts   = now;
  return result;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch { return null; }
}

function safeReadText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch { return null; }
}

function excerpt(text, len = 200) {
  if (!text) return '';
  const stripped = text.replace(/^---[\s\S]*?---\n?/, '').replace(/#+\s/g, '').replace(/\*\*/g, '').trim();
  return stripped.length > len ? stripped.slice(0, len) + '…' : stripped;
}

function wordCount(text) {
  return text ? text.trim().split(/\s+/).length : 0;
}

function parsePermissions(allow) {
  if (!Array.isArray(allow)) return [];
  return allow.map(raw => {
    const m = raw.match(/^([\w]+(?:__[\w]+)*)\((.+)\)$/s);
    if (!m) {
      const tool = raw.trim();
      const type = tool.startsWith('mcp__') ? 'mcp' : 'other';
      return { raw, tool, arg: null, type };
    }
    const [, tool, arg] = m;
    let type = 'other';
    if (tool === 'Bash')           type = 'bash';
    else if (tool === 'Read')      type = 'read';
    else if (tool === 'Skill')     type = 'skill';
    else if (tool.startsWith('mcp__')) type = 'mcp';
    return { raw, tool, arg: arg.trim(), type };
  });
}

function decodeProjectPath(encoded) {
  // "-Users-hasanuzzamanshamim-Desktop-foo" → "/Users/hasanuzzamanshamim/Desktop/foo"
  return encoded.replace(/-/g, '/');
}

function verifyPath(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

// ─── File readers ─────────────────────────────────────────────────────────────

function readClaudeMd(dir) {
  const filePath = path.join(dir, 'CLAUDE.md');
  const raw = safeReadText(filePath);
  if (!raw) return null;
  return { raw, excerpt: excerpt(raw, 300) };
}

function readSettingsJson(dir, filename = 'settings.json') {
  const filePath = path.join(dir, filename);
  const data = safeReadJson(filePath);
  if (!data) return null;

  const allow = data.permissions?.allow || [];
  const result = {
    permissions: {
      allow,
      allowParsed: parsePermissions(allow),
      additionalDirectories: data.permissions?.additionalDirectories || []
    },
    hooks: {},
    model: data.model || null,
    effortLevel: data.effortLevel || null,
    enabledPlugins: data.enabledPlugins || {},
    extraKnownMarketplaces: data.extraKnownMarketplaces || {}
  };

  // Parse hooks into flat list
  if (data.hooks) {
    for (const [hookType, entries] of Object.entries(data.hooks)) {
      result.hooks[hookType] = [];
      for (const entry of entries) {
        const matcher = entry.matcher || null;
        for (const h of (entry.hooks || [])) {
          result.hooks[hookType].push({
            matcher,
            command: h.command,
            timeout: h.timeout || null,
            type: h.type || 'command'
          });
        }
      }
    }
  }

  return result;
}

function readCommandsDir(dir) {
  const commandsDir = path.join(dir, 'commands');
  if (!fs.existsSync(commandsDir)) return [];
  const entries = [];
  try {
    const files = fs.readdirSync(commandsDir).filter(f => f.endsWith('.md')).sort();
    for (const file of files) {
      const filePath = path.join(commandsDir, file);
      const raw = safeReadText(filePath);
      if (!raw) continue;
      const parsed = matter(raw);
      entries.push({
        name: file.replace(/\.md$/, ''),
        filename: file,
        raw,
        frontmatter: parsed.data || {},
        body: parsed.content || raw,
        excerpt: excerpt(parsed.content || raw, 150),
        hasArgs: raw.includes('$ARGUMENTS'),
        wordCount: wordCount(raw)
      });
    }
  } catch { /* empty dir or permission error */ }
  return entries;
}

function buildSkillMeta(data, fallbackName) {
  if (!data) data = {};
  const allowedToolsRaw = data['allowed-tools'] || data.allowedTools || '';
  return {
    displayName: data.name || fallbackName,
    description: data.description || null,
    allowedTools: allowedToolsRaw
      ? String(allowedToolsRaw).split(',').map(s => s.trim()).filter(Boolean)
      : [],
    argumentHint: data['argument-hint'] || data.argumentHint || null,
    userInvocable: data['user-invocable'] !== false,
    disableModelInvocation: !!data['disable-model-invocation'],
    agent: data.agent || null,
  };
}

function readSkillsDir(dir) {
  const skillsDir = path.join(dir, 'skills');
  if (!fs.existsSync(skillsDir)) return [];
  const entries = [];
  try {
    const items = fs.readdirSync(skillsDir);
    for (const item of items.sort()) {
      const itemPath = path.join(skillsDir, item);
      const stat = fs.statSync(itemPath);
      if (stat.isDirectory()) {
        // Skill folder: look for SKILL.md or <name>.md
        const skillMd = path.join(itemPath, 'SKILL.md');
        const altMd   = path.join(itemPath, `${item}.md`);
        const filePath = fs.existsSync(skillMd) ? skillMd : fs.existsSync(altMd) ? altMd : null;
        if (!filePath) continue;
        const raw = safeReadText(filePath);
        if (!raw) continue;
        const parsed = matter(raw);
        entries.push({
          name: item,
          filename: path.basename(filePath),
          raw,
          frontmatter: parsed.data || {},
          meta: buildSkillMeta(parsed.data, item),
          body: parsed.content || raw,
          excerpt: excerpt(parsed.content || raw, 150),
          hasArgs: raw.includes('$ARGUMENTS'),
          wordCount: wordCount(raw),
          isFolder: true
        });
      } else if (item.endsWith('.md')) {
        const raw = safeReadText(itemPath);
        if (!raw) continue;
        const parsed = matter(raw);
        entries.push({
          name: item.replace(/\.md$/, ''),
          filename: item,
          raw,
          frontmatter: parsed.data || {},
          meta: buildSkillMeta(parsed.data, item.replace(/\.md$/, '')),
          body: parsed.content || raw,
          excerpt: excerpt(parsed.content || raw, 150),
          hasArgs: raw.includes('$ARGUMENTS'),
          wordCount: wordCount(raw),
          isFolder: false
        });
      }
    }
  } catch { /* empty or permission error */ }
  return entries;
}

function readPlansDir(dir) {
  const plansDir = path.join(dir, 'plans');
  if (!fs.existsSync(plansDir)) return [];
  const entries = [];
  try {
    const files = fs.readdirSync(plansDir).filter(f => f.endsWith('.md')).sort();
    for (const file of files) {
      const filePath = path.join(plansDir, file);
      const raw = safeReadText(filePath);
      if (!raw) continue;
      entries.push({
        name: file.replace(/\.md$/, ''),
        filename: file,
        raw,
        excerpt: excerpt(raw, 200),
        wordCount: wordCount(raw)
      });
    }
  } catch { /* empty */ }
  return entries;
}

function readInstalledPlugins(dir) {
  const filePath = path.join(dir, 'plugins', 'installed_plugins.json');
  const data = safeReadJson(filePath);
  if (!data || !data.plugins) return [];
  const result = [];
  for (const [id, versions] of Object.entries(data.plugins)) {
    if (Array.isArray(versions) && versions.length > 0) {
      result.push({ id, ...versions[versions.length - 1] });
    }
  }
  return result;
}

function readWarpPlugin(dir) {
  const hooksPath = path.join(dir, 'plugins', 'cache', 'claude-code-warp', 'warp', '2.0.0', 'hooks', 'hooks.json');
  const data = safeReadJson(hooksPath);
  if (!data) return null;

  // Resolve script names from hook commands
  const scripts = new Set();
  if (data.hooks) {
    for (const entries of Object.values(data.hooks)) {
      for (const entry of entries) {
        for (const h of (entry.hooks || [])) {
          const m = h.command?.match(/scripts\/([^"'\s]+)/);
          if (m) scripts.add(m[1]);
        }
      }
    }
  }

  return {
    description: data.description || '',
    hooks: data.hooks || {},
    scripts: Array.from(scripts)
  };
}

function readStatsCache(dir) {
  const filePath = path.join(dir, 'stats-cache.json');
  const data = safeReadJson(filePath);
  if (!data) return null;
  return data;
}

function readProjectsDir(dir) {
  const projectsDir = path.join(dir, 'projects');
  if (!fs.existsSync(projectsDir)) return [];
  const entries = [];
  try {
    const items = fs.readdirSync(projectsDir).filter(d => {
      return fs.statSync(path.join(projectsDir, d)).isDirectory();
    });
    for (const encoded of items) {
      const decoded = decodeProjectPath(encoded);
      const verified = verifyPath(decoded);
      const projectClaudeDir = path.join(decoded, '.claude');
      const hasLocalClaude = verified && fs.existsSync(projectClaudeDir);

      // Count session files
      const sessionFiles = [];
      try {
        const subDir = path.join(projectsDir, encoded);
        const subs = fs.readdirSync(subDir);
        for (const sub of subs) {
          const subPath = path.join(subDir, sub);
          if (fs.statSync(subPath).isDirectory()) {
            const files = fs.readdirSync(subPath).filter(f => f.endsWith('.jsonl'));
            sessionFiles.push(...files);
          }
        }
      } catch { /* skip */ }

      entries.push({ encodedName: encoded, decodedPath: decoded, verified, hasLocalClaude, sessionCount: sessionFiles.length });
    }
  } catch { /* permission error */ }
  return entries.sort((a, b) => a.decodedPath.localeCompare(b.decodedPath));
}

function readMcpJson(projectPath) {
  if (!projectPath) return null;
  const candidates = [
    path.join(projectPath, '.mcp.json'),
    path.join(projectPath, '.claude', '.mcp.json')
  ];
  for (const p of candidates) {
    const data = safeReadJson(p);
    if (data) return { path: p, ...data };
  }
  return null;
}

function readProjectConfig(projectPath) {
  if (!projectPath) return null;
  const claudeDir = path.join(projectPath, '.claude');
  const hasClaudeDir = fs.existsSync(claudeDir);
  return {
    path: projectPath,
    projectName: path.basename(projectPath),
    hasClaudeDir,
    claudeMd: readClaudeMd(projectPath) || readClaudeMd(claudeDir),
    settingsLocal: readSettingsJson(claudeDir, 'settings.local.json'),
    settings: readSettingsJson(claudeDir, 'settings.json'),
    mcpJson: readMcpJson(projectPath),
    localSkills:   hasClaudeDir ? readSkillsDir(claudeDir) : [],
    localCommands: hasClaudeDir ? readCommandsDir(claudeDir) : [],
  };
}

// ─── File tree builder ────────────────────────────────────────────────────────

const SKIP_DIRS  = new Set(['file-history', 'session-env', 'shell-snapshots', 'telemetry', 'projects', 'todos', 'sessions', 'paste-cache', 'ide', 'debug']);
const LARGE_FILE_THRESHOLD = 512 * 1024; // 512 KB

function buildFileTree(basePath, depth = 0, maxDepth = 3) {
  const name = path.basename(basePath);
  const node = { name, path: basePath, isDir: false, children: [], size: null };

  let stat;
  try { stat = fs.statSync(basePath); } catch { return null; }

  if (stat.isDirectory()) {
    node.isDir = true;
    if (depth >= maxDepth || SKIP_DIRS.has(name)) return node;
    try {
      const items = fs.readdirSync(basePath).sort();
      for (const item of items) {
        if (item.startsWith('.') && item !== '.claude') continue;
        const child = buildFileTree(path.join(basePath, item), depth + 1, maxDepth);
        if (child) node.children.push(child);
      }
    } catch { /* permission */ }
  } else {
    node.size = stat.size;
  }
  return node;
}

// ─── Main assembler ───────────────────────────────────────────────────────────

async function buildScanResult(projectPath = null) {
  const start = Date.now();

  const installedPlugins = readInstalledPlugins(CLAUDE_DIR);
  const warpPlugin = readWarpPlugin(CLAUDE_DIR);

  const result = {
    meta: {
      scannedAt: new Date().toISOString(),
      globalPath: CLAUDE_DIR,
      projectPath: projectPath || null,
      scanDurationMs: 0
    },
    global: {
      claudeMd: readClaudeMd(CLAUDE_DIR),
      settings: readSettingsJson(CLAUDE_DIR),
      commands: readCommandsDir(CLAUDE_DIR),
      skills: readSkillsDir(CLAUDE_DIR),
      plans: readPlansDir(CLAUDE_DIR),
      plugins: { installedPlugins, warpPlugin },
      stats: readStatsCache(CLAUDE_DIR),
      projects: readProjectsDir(CLAUDE_DIR),
      fileTree: buildFileTree(CLAUDE_DIR, 0, 3)
    },
    project: projectPath ? readProjectConfig(projectPath) : null
  };

  result.meta.scanDurationMs = Date.now() - start;
  return result;
}

// ─── SSE ─────────────────────────────────────────────────────────────────────

const sseClients = new Set();

function broadcastSSE(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(payload); } catch { sseClients.delete(res); }
  }
}

// Heartbeat every 30s
setInterval(() => broadcastSSE('heartbeat', { ts: Date.now() }), 30000);

// ─── File watcher ─────────────────────────────────────────────────────────────

const WATCH_PATHS = [
  path.join(CLAUDE_DIR, 'settings.json'),
  path.join(CLAUDE_DIR, 'CLAUDE.md'),
  path.join(CLAUDE_DIR, 'commands'),
  path.join(CLAUDE_DIR, 'skills'),
  path.join(CLAUDE_DIR, 'plans'),
  path.join(CLAUDE_DIR, 'stats-cache.json'),
  path.join(CLAUDE_DIR, 'plugins', 'installed_plugins.json'),
];

const watcher = chokidar.watch(WATCH_PATHS, {
  persistent: true,
  ignoreInitial: true,
  awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 }
});

watcher.on('all', (event, filePath) => {
  invalidateCache();
  broadcastSSE('file-changed', { path: filePath, event });
  broadcastSSE('cache-invalidated', {});
});

// ─── Security helper ──────────────────────────────────────────────────────────

function isPathAllowed(requestedPath, projectPath) {
  const resolved = path.resolve(requestedPath);
  const allowed  = [CLAUDE_DIR];
  if (projectPath) allowed.push(path.resolve(projectPath));
  return allowed.some(base =>
    resolved === base ||
    resolved.startsWith(base + path.sep)
  );
}

// ─── Pinned Projects ──────────────────────────────────────────────────────────

function readPinned() {
  const data = safeReadJson(PINNED_FILE);
  return Array.isArray(data?.projects) ? data.projects : [];
}

function writePinned(projects) {
  fs.writeFileSync(PINNED_FILE, JSON.stringify({ projects }, null, 2), 'utf8');
}

// ─── Directory Browser ────────────────────────────────────────────────────────

function browseDir(dirPath, showHidden) {
  const resolved = path.resolve(dirPath);
  const entries  = fs.readdirSync(resolved, { withFileTypes: true });
  const dirs = entries
    .filter(e => {
      if (!e.isDirectory()) return false;
      if (!showHidden && e.name.startsWith('.')) return false;
      return true;
    })
    .map(e => ({ name: e.name, path: path.join(resolved, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  const parent = resolved !== path.parse(resolved).root
    ? path.dirname(resolved)
    : null;

  // Build breadcrumb segments
  const root  = path.parse(resolved).root;
  const rel   = path.relative(root, resolved);
  const parts = rel ? rel.split(path.sep) : [];
  const crumbs = [{ name: root || '/', path: root || '/' }];
  let acc = root;
  for (const part of parts) {
    acc = path.join(acc, part);
    crumbs.push({ name: part, path: acc });
  }

  return { current: resolved, parent, crumbs, dirs };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.use(express.static(path.join(__dirname, 'public')));

// Pinned projects CRUD
app.get('/api/pinned-projects', (req, res) => {
  const projects = readPinned();
  res.json({ projects });
});

app.post('/api/pinned-projects', (req, res) => {
  const { path: projectPath } = req.body;
  if (!projectPath || typeof projectPath !== 'string') {
    return res.status(400).json({ error: 'Missing path' });
  }
  const resolved = path.resolve(projectPath);
  const projects = readPinned();
  if (!projects.includes(resolved)) {
    projects.push(resolved);
    writePinned(projects);
  }
  res.json({ projects });
});

app.delete('/api/pinned-projects', (req, res) => {
  const { path: projectPath } = req.body;
  if (!projectPath) return res.status(400).json({ error: 'Missing path' });
  const resolved = path.resolve(projectPath);
  const projects = readPinned().filter(p => p !== resolved);
  writePinned(projects);
  res.json({ projects });
});

// Directory browser
app.get('/api/browse', (req, res) => {
  const dirPath    = req.query.path  || os.homedir();
  const showHidden = req.query.hidden === '1';
  try {
    res.json(browseDir(dirPath, showHidden));
  } catch (e) {
    // Return parent on permission error so the UI can recover
    const parent = path.dirname(path.resolve(dirPath));
    try {
      res.json({ ...browseDir(parent, showHidden), error: e.message });
    } catch {
      res.status(403).json({ error: e.message });
    }
  }
});

// Quick bookmarks
app.get('/api/browse/bookmarks', (req, res) => {
  const home     = os.homedir();
  const marks    = [
    { name: 'Home',     path: home },
    { name: 'Desktop',  path: path.join(home, 'Desktop') },
    { name: 'Documents',path: path.join(home, 'Documents') },
    { name: 'Volumes',  path: '/Volumes' },
    { name: 'Root',     path: '/' },
  ].filter(m => { try { fs.accessSync(m.path); return true; } catch { return false; } });
  res.json({ bookmarks: marks });
});

app.get('/api/scan', async (req, res) => {
  try {
    const projectPath = req.query.project || null;
    const data = await getCachedScan(projectPath);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message, code: 'SCAN_FAILED' });
  }
});

app.get('/api/file', async (req, res) => {
  const filePath   = req.query.path;
  const projectPath = req.query.project || null;

  if (!filePath) return res.status(400).json({ error: 'Missing path', code: 'MISSING_PATH' });
  if (!isPathAllowed(filePath, projectPath)) {
    return res.status(403).json({ error: 'Forbidden', code: 'PATH_NOT_ALLOWED' });
  }

  try {
    const stat = fs.statSync(filePath);
    if (stat.size > LARGE_FILE_THRESHOLD && filePath.endsWith('.jsonl')) {
      // Truncate large JSONL
      const fd = fs.openSync(filePath, 'r');
      const buf = Buffer.alloc(LARGE_FILE_THRESHOLD);
      fs.readSync(fd, buf, 0, LARGE_FILE_THRESHOLD, 0);
      fs.closeSync(fd);
      return res.json({
        content: buf.toString('utf8') + '\n\n[... file truncated, too large to display ...]',
        size: stat.size,
        truncated: true,
        mtime: stat.mtime.toISOString()
      });
    }
    const content = fs.readFileSync(filePath, 'utf8');
    res.json({ content, size: stat.size, truncated: false, mtime: stat.mtime.toISOString() });
  } catch (err) {
    res.status(404).json({ error: err.message, code: 'FILE_NOT_FOUND' });
  }
});

app.get('/api/export', async (req, res) => {
  try {
    const projectPath = req.query.project || null;
    const data = await getCachedScan(projectPath);
    const filename = `claude-map-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(data, null, 2));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  res.write(`event: connected\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);
  sseClients.add(res);

  req.on('close', () => sseClients.delete(res));
});

// ─── Project Analysis ─────────────────────────────────────────────────────────

function countSessionFiles(projectPath) {
  const encoded    = projectPath.replace(/\//g, '-');
  const sessionDir = path.join(CLAUDE_DIR, 'projects', encoded);
  if (!fs.existsSync(sessionDir)) return 0;
  let count = 0;
  try {
    for (const sub of fs.readdirSync(sessionDir)) {
      const subPath = path.join(sessionDir, sub);
      try {
        if (fs.statSync(subPath).isDirectory()) {
          count += fs.readdirSync(subPath).filter(f => f.endsWith('.jsonl')).length;
        }
      } catch { /* skip */ }
    }
  } catch { /* permission */ }
  return count;
}

function buildGlobalConnections(globalSettings) {
  const gs    = globalSettings || readSettingsJson(CLAUDE_DIR);
  const allow = gs?.permissions?.allowParsed
             || parsePermissions(gs?.permissions?.allow || []);

  const hooksFromSettings = gs?.hooks || {};
  const warpHooks         = readWarpPlugin(CLAUDE_DIR)?.hooks || {};
  const allHookTypes      = new Set([...Object.keys(hooksFromSettings), ...Object.keys(warpHooks)]);
  const totalHooks = [hooksFromSettings, warpHooks]
    .flatMap(h => Object.values(h))
    .flat()
    .reduce((n, entry) => n + (entry.hooks?.length || 1), 0);

  return {
    claudeMd:    { present: !!readClaudeMd(CLAUDE_DIR) },
    commands:    { count: readCommandsDir(CLAUDE_DIR).length },
    skills:      { count: readSkillsDir(CLAUDE_DIR).length },
    hooks:       { count: totalHooks, types: Array.from(allHookTypes) },
    plugins:     { count: readInstalledPlugins(CLAUDE_DIR).length },
    permissions: { total: allow.length }
  };
}

function buildLocalConnections(projectPath, claudeDir, hasClaudeDir,
                                hasClaudeMd, hasSettingsLocal, hasMcpJson) {
  if (!projectPath || !hasClaudeDir) {
    return {
      claudeMd:      { present: false },
      settingsLocal: { present: false, permCount: 0, perms: [] },
      mcpJson:       { present: false, servers: [] },
      commands:      { count: 0 },
      skills:        { count: 0 },
      plans:         { count: 0 }
    };
  }
  const settingsLocal = readSettingsJson(claudeDir, 'settings.local.json');
  const localPerms    = settingsLocal?.permissions?.allowParsed || [];
  const mcpData       = readMcpJson(projectPath);
  const mcpServers    = mcpData ? Object.keys(mcpData.mcpServers || {}) : [];

  return {
    claudeMd:      { present: hasClaudeMd },
    settingsLocal: { present: hasSettingsLocal, permCount: localPerms.length, perms: localPerms },
    mcpJson:       { present: hasMcpJson, servers: mcpServers },
    commands:      { count: readCommandsDir(claudeDir).length },
    skills:        { count: readSkillsDir(claudeDir).length },
    plans:         { count: readPlansDir(claudeDir).length }
  };
}

function buildProjectAnalysis(projectPath) {
  const exists = fs.existsSync(projectPath);
  const globalSettings = readSettingsJson(CLAUDE_DIR);
  const globalConn = buildGlobalConnections(globalSettings);

  if (!exists) {
    return {
      project: {
        path: projectPath, name: path.basename(projectPath), exists: false,
        hasClaudeDir: false, hasClaudeMd: false, hasSettingsLocal: false, hasMcpJson: false,
        inAdditionalDirectories: false, sessionCount: 0, status: 'missing',
        warnings: [{ level: 'error', message: 'Path does not exist on disk' }]
      },
      connections: { global: globalConn, local: buildLocalConnections(null) }
    };
  }

  const claudeDir        = path.join(projectPath, '.claude');
  const hasClaudeDir     = fs.existsSync(claudeDir);
  const hasClaudeMd      = fs.existsSync(path.join(projectPath, 'CLAUDE.md'))
                        || (hasClaudeDir && fs.existsSync(path.join(claudeDir, 'CLAUDE.md')));
  const hasSettingsLocal = hasClaudeDir && fs.existsSync(path.join(claudeDir, 'settings.local.json'));
  const hasMcpJson       = fs.existsSync(path.join(projectPath, '.mcp.json'))
                        || (hasClaudeDir && fs.existsSync(path.join(claudeDir, '.mcp.json')));

  const status = !hasClaudeDir ? 'none'
    : (!hasClaudeMd || !hasSettingsLocal) ? 'partial' : 'full';

  const additionalDirs = globalSettings?.permissions?.additionalDirectories || [];
  const inAdditionalDirectories = additionalDirs.some(
    d => path.resolve(d) === path.resolve(projectPath)
  );
  const sessionCount = countSessionFiles(projectPath);

  const warnings = [];
  if (!hasClaudeDir)            warnings.push({ level: 'warning', message: 'No .claude/ directory — project has no Claude-specific configuration' });
  if (hasClaudeDir && !hasClaudeMd) warnings.push({ level: 'warning', message: 'No CLAUDE.md found — project has no custom instructions' });
  if (!inAdditionalDirectories) warnings.push({ level: 'info',    message: 'Not registered in global additionalDirectories' });
  if (!hasMcpJson)              warnings.push({ level: 'info',    message: 'No MCP servers configured (.mcp.json not found)' });

  return {
    project: {
      path: projectPath, name: path.basename(projectPath), exists: true,
      hasClaudeDir, hasClaudeMd, hasSettingsLocal, hasMcpJson,
      inAdditionalDirectories, sessionCount, status, warnings
    },
    connections: {
      global: globalConn,
      local:  buildLocalConnections(projectPath, claudeDir, hasClaudeDir,
                                    hasClaudeMd, hasSettingsLocal, hasMcpJson)
    }
  };
}

// Project analysis routes
app.get('/api/project-status', (req, res) => {
  const projectPath = req.query.path;
  if (!projectPath) return res.status(400).json({ error: 'Missing path' });
  const resolved = path.resolve(projectPath);
  if (!fs.existsSync(resolved)) return res.json({ status: 'missing' });
  const claudeDir = path.join(resolved, '.claude');
  if (!fs.existsSync(claudeDir)) return res.json({ status: 'none' });
  const hasClaudeMd  = fs.existsSync(path.join(resolved, 'CLAUDE.md'))
                    || fs.existsSync(path.join(claudeDir, 'CLAUDE.md'));
  const hasSettings  = fs.existsSync(path.join(claudeDir, 'settings.local.json'));
  res.json({ status: (!hasClaudeMd || !hasSettings) ? 'partial' : 'full' });
});

app.get('/api/analyze', (req, res) => {
  const projectPath = req.query.project;
  if (!projectPath) return res.status(400).json({ error: 'Missing project parameter' });
  try {
    res.json(buildProjectAnalysis(path.resolve(projectPath)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Sessions & History ──────────────────────────────────────────────────────

function encodeProjectPath(projectPath) {
  return projectPath.replace(/\//g, '-');
}

function getSessionDir(projectPath) {
  const encoded = encodeProjectPath(projectPath);
  return path.join(CLAUDE_DIR, 'projects', encoded);
}

function readSessionHead(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());
    let sessionId = null, title = null, gitBranch = null, version = null;
    let startedAt = null, endedAt = null, model = null;
    let msgCount = 0, toolCount = 0;
    let totalInput = 0, totalOutput = 0, totalCacheRead = 0, totalCacheWrite = 0;
    const modelsUsed = new Set();

    for (const line of lines) {
      try {
        const d = JSON.parse(line);
        if (d.timestamp) {
          if (!startedAt) startedAt = d.timestamp;
          endedAt = d.timestamp;
        }
        if (!sessionId && d.sessionId) sessionId = d.sessionId;
        if (!gitBranch && d.gitBranch) gitBranch = d.gitBranch;
        if (!version && d.version) version = d.version;
        if (d.type === 'user') {
          msgCount++;
          if (!title && d.message?.content && d.userType !== 'internal') {
            const c = d.message.content;
            let text = typeof c === 'string' ? c : Array.isArray(c) ? (c.find(b => b.type === 'text')?.text || '') : '';
            // Skip system/agent prompts
            if (text && !text.startsWith('-\nYou are agent') && !text.startsWith('You are agent')) {
              title = text.slice(0, 120);
            }
          }
        }
        if (d.type === 'assistant') {
          msgCount++;
          const m = d.message?.model;
          if (m) modelsUsed.add(m);
          const content = d.message?.content;
          if (Array.isArray(content)) {
            toolCount += content.filter(b => b.type === 'tool_use').length;
          }
          const usage = d.message?.usage || {};
          totalInput      += usage.input_tokens || 0;
          totalOutput     += usage.output_tokens || 0;
          totalCacheRead  += usage.cache_read_input_tokens || 0;
          totalCacheWrite += usage.cache_write_input_tokens || 0;
        }
      } catch { /* skip malformed line */ }
    }

    const stat = fs.statSync(filePath);
    return {
      id: sessionId || path.basename(filePath, '.jsonl'),
      title: title || '(untitled session)',
      gitBranch: gitBranch || null,
      version: version || null,
      startedAt, endedAt,
      messageCount: msgCount,
      toolCallCount: toolCount,
      modelsUsed: Array.from(modelsUsed),
      fileSize: stat.size,
      tokenUsage: { input: totalInput, output: totalOutput, cacheRead: totalCacheRead, cacheWrite: totalCacheWrite },
    };
  } catch { return null; }
}

app.get('/api/sessions', (req, res) => {
  const projectPath = req.query.project;
  if (!projectPath) return res.status(400).json({ error: 'Missing project parameter' });
  const limit  = Math.min(parseInt(req.query.limit)  || 50, 200);
  const offset = parseInt(req.query.offset) || 0;

  const sessionDir = getSessionDir(path.resolve(projectPath));
  if (!fs.existsSync(sessionDir)) return res.json({ sessions: [], total: 0, offset });

  // Find all .jsonl files (direct children and in subdirs)
  const jsonlFiles = [];
  try {
    for (const entry of fs.readdirSync(sessionDir)) {
      const entryPath = path.join(sessionDir, entry);
      const stat = fs.statSync(entryPath);
      if (stat.isFile() && entry.endsWith('.jsonl')) {
        jsonlFiles.push({ path: entryPath, mtime: stat.mtimeMs });
      } else if (stat.isDirectory() && !entry.includes('subagent')) {
        // Look for session .jsonl in session subdirs (skip subagents/)
        for (const sub of fs.readdirSync(entryPath)) {
          if (sub === 'subagents' || sub === 'tool-results') continue;
          const subPath = path.join(entryPath, sub);
          try {
            if (sub.endsWith('.jsonl') && !sub.includes('agent') && fs.statSync(subPath).isFile()) {
              jsonlFiles.push({ path: subPath, mtime: fs.statSync(subPath).mtimeMs });
            }
          } catch { /* skip */ }
        }
      }
    }
  } catch { /* permission error */ }

  // Sort by modification time descending
  jsonlFiles.sort((a, b) => b.mtime - a.mtime);
  const total = jsonlFiles.length;
  const page  = jsonlFiles.slice(offset, offset + limit);

  const sessions = page.map(f => readSessionHead(f.path)).filter(Boolean);
  res.json({ sessions, total, offset });
});

app.get('/api/sessions/:id', (req, res) => {
  const projectPath = req.query.project;
  if (!projectPath) return res.status(400).json({ error: 'Missing project parameter' });
  const sessionId = req.params.id;
  const sessionDir = getSessionDir(path.resolve(projectPath));

  // Find the JSONL file for this session
  let targetFile = null;
  const directFile = path.join(sessionDir, `${sessionId}.jsonl`);
  if (fs.existsSync(directFile)) {
    targetFile = directFile;
  } else {
    // Check subdirectories
    try {
      for (const entry of fs.readdirSync(sessionDir)) {
        const candidate = path.join(sessionDir, entry, `${sessionId}.jsonl`);
        if (fs.existsSync(candidate)) { targetFile = candidate; break; }
      }
    } catch { /* skip */ }
  }

  if (!targetFile) return res.status(404).json({ error: 'Session not found' });

  try {
    const content = fs.readFileSync(targetFile, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());

    let sessionMeta = { id: sessionId, gitBranch: null, version: null, startedAt: null, endedAt: null };
    const turns = [];
    const toolBreakdown = {};
    const modelsUsed = new Set();
    let totalInput = 0, totalOutput = 0, totalCacheRead = 0, totalCacheWrite = 0;
    let currentTurn = null;

    for (const line of lines) {
      try {
        const d = JSON.parse(line);
        if (d.type === 'file-history-snapshot' || d.type === 'progress') continue;

        if (!sessionMeta.gitBranch && d.gitBranch) sessionMeta.gitBranch = d.gitBranch;
        if (!sessionMeta.version && d.version) sessionMeta.version = d.version;
        if (d.timestamp) {
          if (!sessionMeta.startedAt) sessionMeta.startedAt = d.timestamp;
          sessionMeta.endedAt = d.timestamp;
        }

        if (d.type === 'user') {
          // Start a new turn
          const msgContent = d.message?.content;
          let text = '';
          if (typeof msgContent === 'string') text = msgContent;
          else if (Array.isArray(msgContent)) text = (msgContent.find(b => b.type === 'text')?.text || '');

          currentTurn = {
            index: turns.length,
            userMessage: text.slice(0, 2000),
            timestamp: d.timestamp || null,
            assistant: null
          };
          turns.push(currentTurn);
        }

        if (d.type === 'assistant' && currentTurn) {
          const msg = d.message || {};
          const model = msg.model || null;
          if (model) modelsUsed.add(model);

          const contentBlocks = msg.content || [];
          const textParts = [];
          const toolCalls = [];

          for (const block of (Array.isArray(contentBlocks) ? contentBlocks : [])) {
            if (block.type === 'text' && block.text) textParts.push(block.text);
            if (block.type === 'tool_use') {
              const inputStr = JSON.stringify(block.input || {});
              const preview = inputStr.length > 120 ? inputStr.slice(0, 120) + '…' : inputStr;
              toolCalls.push({ name: block.name, inputPreview: preview });
              toolBreakdown[block.name] = (toolBreakdown[block.name] || 0) + 1;
            }
          }

          const usage = msg.usage || {};
          const input      = usage.input_tokens || 0;
          const output     = usage.output_tokens || 0;
          const cacheR     = usage.cache_read_input_tokens || 0;
          const cacheW     = usage.cache_write_input_tokens || 0;
          totalInput      += input;
          totalOutput     += output;
          totalCacheRead  += cacheR;
          totalCacheWrite += cacheW;

          // Merge with existing assistant data if multiple assistant chunks
          if (currentTurn.assistant) {
            if (textParts.length) currentTurn.assistant.text += '\n' + textParts.join('\n');
            currentTurn.assistant.toolCalls.push(...toolCalls);
            currentTurn.assistant.tokenUsage.input      += input;
            currentTurn.assistant.tokenUsage.output     += output;
            currentTurn.assistant.tokenUsage.cacheRead  += cacheR;
            currentTurn.assistant.tokenUsage.cacheWrite += cacheW;
          } else {
            currentTurn.assistant = {
              model,
              text: textParts.join('\n').slice(0, 2000),
              toolCalls,
              tokenUsage: { input, output, cacheRead: cacheR, cacheWrite: cacheW }
            };
          }
        }
      } catch { /* skip malformed line */ }
    }

    res.json({
      session: sessionMeta,
      turns,
      summary: {
        totalTurns: turns.length,
        toolBreakdown,
        modelsUsed: Array.from(modelsUsed),
        totalTokens: { input: totalInput, output: totalOutput, cacheRead: totalCacheRead, cacheWrite: totalCacheWrite }
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/history', (req, res) => {
  const historyFile = path.join(CLAUDE_DIR, 'history.jsonl');
  if (!fs.existsSync(historyFile)) return res.json({ entries: [] });

  const projectFilter = req.query.project ? path.resolve(req.query.project) : null;
  const limit = Math.min(parseInt(req.query.limit) || 200, 500);

  try {
    const content = fs.readFileSync(historyFile, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());
    const entries = [];

    for (const line of lines) {
      try {
        const d = JSON.parse(line);
        if (projectFilter && d.project && path.resolve(d.project) !== projectFilter) continue;
        entries.push({
          display: d.display || '',
          timestamp: d.timestamp || null,
          project: d.project || null,
          sessionId: d.sessionId || null,
        });
      } catch { /* skip */ }
    }

    // Sort by timestamp descending, return latest
    entries.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    res.json({ entries: entries.slice(0, limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Tool Usage Stats ────────────────────────────────────────────────────────

app.get('/api/stats/tools', (req, res) => {
  const projectPath = req.query.project;
  const days = parseInt(req.query.days) || 30;
  const cutoff = Date.now() - days * 86400000;

  // Collect JSONL files to scan
  const filesToScan = [];
  const projectsDir = path.join(CLAUDE_DIR, 'projects');
  if (!fs.existsSync(projectsDir)) return res.json({ toolUsage: {}, sessionsScanned: 0 });

  try {
    const encodedDirs = projectPath
      ? [encodeProjectPath(path.resolve(projectPath))]
      : fs.readdirSync(projectsDir).filter(d => {
          try { return fs.statSync(path.join(projectsDir, d)).isDirectory(); } catch { return false; }
        });

    for (const encoded of encodedDirs) {
      const dir = path.join(projectsDir, encoded);
      if (!fs.existsSync(dir)) continue;
      try {
        for (const entry of fs.readdirSync(dir)) {
          const entryPath = path.join(dir, entry);
          try {
            const stat = fs.statSync(entryPath);
            if (stat.isFile() && entry.endsWith('.jsonl') && stat.mtimeMs > cutoff) {
              filesToScan.push(entryPath);
            } else if (stat.isDirectory()) {
              for (const sub of fs.readdirSync(entryPath)) {
                if (sub.endsWith('.jsonl') && !sub.includes('agent')) {
                  const subPath = path.join(entryPath, sub);
                  try {
                    if (fs.statSync(subPath).mtimeMs > cutoff) filesToScan.push(subPath);
                  } catch { /* skip */ }
                }
              }
            }
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }

  const toolUsage = {};
  let sessionsScanned = 0;

  // Limit to 100 most recent files for performance
  filesToScan.sort((a, b) => {
    try { return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs; } catch { return 0; }
  });
  const toScan = filesToScan.slice(0, 100);

  for (const file of toScan) {
    try {
      const content = fs.readFileSync(file, 'utf8');
      sessionsScanned++;
      for (const line of content.split('\n')) {
        if (!line.includes('"tool_use"')) continue;
        try {
          const d = JSON.parse(line);
          if (d.type !== 'assistant') continue;
          const blocks = d.message?.content;
          if (!Array.isArray(blocks)) continue;
          for (const b of blocks) {
            if (b.type === 'tool_use' && b.name) {
              toolUsage[b.name] = (toolUsage[b.name] || 0) + 1;
            }
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  res.json({ toolUsage, sessionsScanned, period: `${days}d` });
});

// ─── Cost Stats ──────────────────────────────────────────────────────────────

app.get('/api/stats/costs', (req, res) => {
  const projectPath = req.query.project;
  const projectsDir = path.join(CLAUDE_DIR, 'projects');
  if (!fs.existsSync(projectsDir)) return res.json({ dailyCosts: [], totalByModel: {}, sessionsScanned: 0 });

  // Collect JSONL files (same pattern as /api/sessions)
  const filesToScan = [];
  try {
    const encodedDirs = projectPath
      ? [encodeProjectPath(path.resolve(projectPath))]
      : fs.readdirSync(projectsDir).filter(d => {
          try { return fs.statSync(path.join(projectsDir, d)).isDirectory(); } catch { return false; }
        });

    for (const encoded of encodedDirs) {
      const dir = path.join(projectsDir, encoded);
      if (!fs.existsSync(dir)) continue;
      try {
        for (const entry of fs.readdirSync(dir)) {
          const entryPath = path.join(dir, entry);
          try {
            const stat = fs.statSync(entryPath);
            if (stat.isFile() && entry.endsWith('.jsonl')) {
              filesToScan.push({ path: entryPath, mtime: stat.mtimeMs });
            } else if (stat.isDirectory() && !entry.includes('subagent')) {
              for (const sub of fs.readdirSync(entryPath)) {
                if (sub.endsWith('.jsonl') && !sub.includes('agent')) {
                  const subPath = path.join(entryPath, sub);
                  try { filesToScan.push({ path: subPath, mtime: fs.statSync(subPath).mtimeMs }); } catch { /* skip */ }
                }
              }
            }
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }

  // Sort most recent first, cap at 200 for performance
  filesToScan.sort((a, b) => b.mtime - a.mtime);
  const toScan = filesToScan.slice(0, 200);

  const dailyCostsMap = {};  // { 'YYYY-MM-DD': { [model]: { input, output, cacheRead, cacheWrite } } }
  const totalByModel  = {};  // { [model]: { input, output, cacheRead, cacheWrite } }
  let sessionsScanned = 0;

  for (const file of toScan) {
    try {
      const content = fs.readFileSync(file.path, 'utf8');
      sessionsScanned++;
      for (const line of content.split('\n')) {
        if (!line.trim() || !line.includes('"assistant"')) continue;
        try {
          const d = JSON.parse(line);
          if (d.type !== 'assistant') continue;
          const usage = d.message?.usage;
          if (!usage) continue;
          const model = d.message?.model || 'unknown';
          const date  = d.timestamp ? d.timestamp.slice(0, 10) : 'unknown';

          const input      = usage.input_tokens || 0;
          const output     = usage.output_tokens || 0;
          const cacheRead  = usage.cache_read_input_tokens || 0;
          const cacheWrite = usage.cache_write_input_tokens || 0;
          if (input + output + cacheRead + cacheWrite === 0) continue;

          // Daily accumulation
          if (!dailyCostsMap[date]) dailyCostsMap[date] = {};
          if (!dailyCostsMap[date][model]) dailyCostsMap[date][model] = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
          dailyCostsMap[date][model].input      += input;
          dailyCostsMap[date][model].output     += output;
          dailyCostsMap[date][model].cacheRead  += cacheRead;
          dailyCostsMap[date][model].cacheWrite += cacheWrite;

          // Total accumulation
          if (!totalByModel[model]) totalByModel[model] = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
          totalByModel[model].input      += input;
          totalByModel[model].output     += output;
          totalByModel[model].cacheRead  += cacheRead;
          totalByModel[model].cacheWrite += cacheWrite;
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  const dailyCosts = Object.entries(dailyCostsMap)
    .map(([date, tokensByModel]) => ({ date, tokensByModel }))
    .sort((a, b) => a.date.localeCompare(b.date));

  res.json({ dailyCosts, totalByModel, sessionsScanned });
});

// ─── Skill Export/Import ─────────────────────────────────────────────────────

app.get('/api/skills/export', (req, res) => {
  const { name, scope, project } = req.query;
  if (!name) return res.status(400).json({ error: 'Missing name' });

  const baseDir = scope === 'project' && project
    ? path.join(path.resolve(project), '.claude', 'skills')
    : path.join(CLAUDE_DIR, 'skills');

  // Try file.md then folder/SKILL.md
  const filePath = path.join(baseDir, `${name}.md`);
  const folderPath = path.join(baseDir, name, 'SKILL.md');
  const target = fs.existsSync(filePath) ? filePath : fs.existsSync(folderPath) ? folderPath : null;

  if (!target) return res.status(404).json({ error: 'Skill not found' });

  const content = fs.readFileSync(target, 'utf8');
  res.setHeader('Content-Type', 'text/markdown');
  res.setHeader('Content-Disposition', `attachment; filename="${name}.md"`);
  res.send(content);
});

app.post('/api/skills/import', (req, res) => {
  const { name, content, scope, projectPath } = req.body;
  if (!name || !content) return res.status(400).json({ error: 'Missing name or content' });

  const baseDir = scope === 'project' && projectPath
    ? path.join(path.resolve(projectPath), '.claude', 'skills')
    : path.join(CLAUDE_DIR, 'skills');

  // Security: validate base dir
  const resolvedBase = path.resolve(baseDir);
  if (!resolvedBase.includes('.claude')) {
    return res.status(403).json({ error: 'Invalid target directory' });
  }

  // Create dir if needed
  if (!fs.existsSync(resolvedBase)) fs.mkdirSync(resolvedBase, { recursive: true });

  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filePath = path.join(resolvedBase, `${safeName}.md`);
  fs.writeFileSync(filePath, content, 'utf8');
  invalidateCache();
  res.json({ success: true, path: filePath });
});

// ─── Bundle Export/Import ────────────────────────────────────────────────────

app.post('/api/export/bundle', async (req, res) => {
  const { items, scope, projectPath } = req.body;
  if (!items || !Array.isArray(items)) return res.status(400).json({ error: 'Missing items array' });

  const isProject = scope === 'project' && projectPath;
  const baseDir = isProject ? path.join(path.resolve(projectPath), '.claude') : CLAUDE_DIR;
  const bundle = {
    version: 1,
    type: 'claude-map-bundle',
    exportedAt: new Date().toISOString(),
    source: {
      project: isProject ? path.basename(projectPath) : 'global',
      path: isProject ? projectPath : CLAUDE_DIR
    }
  };

  if (items.includes('skills')) {
    bundle.skills = (isProject ? readSkillsDir(baseDir) : readSkillsDir(CLAUDE_DIR))
      .map(s => ({ name: s.name, filename: s.filename, raw: s.raw, isFolder: s.isFolder }));
  }
  if (items.includes('commands')) {
    bundle.commands = (isProject ? readCommandsDir(baseDir) : readCommandsDir(CLAUDE_DIR))
      .map(c => ({ name: c.name, filename: c.filename, raw: c.raw }));
  }
  if (items.includes('claudeMd')) {
    const cm = isProject
      ? (readClaudeMd(path.resolve(projectPath)) || readClaudeMd(baseDir))
      : readClaudeMd(CLAUDE_DIR);
    bundle.claudeMd = cm?.raw || null;
  }

  const filename = `claude-map-bundle-${new Date().toISOString().slice(0, 10)}.json`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(bundle, null, 2));
});

app.post('/api/import/bundle', (req, res) => {
  const { bundle, target, projectPath, overwrite } = req.body;
  if (!bundle || bundle.type !== 'claude-map-bundle') {
    return res.status(400).json({ error: 'Invalid bundle format' });
  }

  const isProject = target === 'project' && projectPath;
  const baseDir = isProject ? path.join(path.resolve(projectPath), '.claude') : CLAUDE_DIR;
  const result = { imported: { skills: 0, commands: 0 }, skipped: [] };

  // Import skills
  if (bundle.skills?.length) {
    const skillsDir = path.join(baseDir, 'skills');
    if (!fs.existsSync(skillsDir)) fs.mkdirSync(skillsDir, { recursive: true });
    for (const skill of bundle.skills) {
      const safeName = skill.name.replace(/[^a-zA-Z0-9_-]/g, '_');
      const filePath = path.join(skillsDir, `${safeName}.md`);
      if (fs.existsSync(filePath) && !overwrite) {
        result.skipped.push(safeName);
        continue;
      }
      fs.writeFileSync(filePath, skill.raw, 'utf8');
      result.imported.skills++;
    }
  }

  // Import commands
  if (bundle.commands?.length) {
    const commandsDir = path.join(baseDir, 'commands');
    if (!fs.existsSync(commandsDir)) fs.mkdirSync(commandsDir, { recursive: true });
    for (const cmd of bundle.commands) {
      const safeName = cmd.name.replace(/[^a-zA-Z0-9_-]/g, '_');
      const filePath = path.join(commandsDir, `${safeName}.md`);
      if (fs.existsSync(filePath) && !overwrite) {
        result.skipped.push(safeName);
        continue;
      }
      fs.writeFileSync(filePath, cmd.raw, 'utf8');
      result.imported.commands++;
    }
  }

  invalidateCache();
  res.json(result);
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n  Claude Map`);
  console.log(`  ──────────`);
  console.log(`  http://localhost:${PORT}\n`);
});
