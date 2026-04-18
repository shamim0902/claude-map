'use strict';

const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const os       = require('os');
const matter   = require('gray-matter');
const chokidar = require('chokidar');
const { WebSocketServer } = require('ws');
const pty      = require('node-pty');

const workflowRunner = require('./workflow-runner');
const ragEngine      = require('./rag-engine');

const app       = express();
app.use(express.json());
const PORT      = process.env.PORT || 8888;
const CLAUDE_DIR    = path.resolve(os.homedir(), '.claude');
const PINNED_FILE   = path.join(CLAUDE_DIR, 'inspector-projects.json');
const WORKFLOWS_DIR = path.join(CLAUDE_DIR, 'workflows');
fs.mkdirSync(WORKFLOWS_DIR, { recursive: true });

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
  const deny  = data.permissions?.deny  || [];
  const ask   = data.permissions?.ask   || [];
  const result = {
    permissions: {
      allow,
      allowParsed: parsePermissions(allow),
      deny,
      denyParsed:  parsePermissions(deny),
      ask,
      askParsed:   parsePermissions(ask),
      defaultMode: data.permissions?.defaultMode || null,
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
  result.hooksRaw = data.hooks || {};

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

function readRulesDir(dir) {
  const rulesDir = path.join(dir, 'rules');
  if (!fs.existsSync(rulesDir)) return [];
  const entries = [];
  function scanDir(d, prefix) {
    try {
      for (const item of fs.readdirSync(d).sort()) {
        const itemPath = path.join(d, item);
        const stat = fs.statSync(itemPath);
        if (stat.isDirectory()) {
          scanDir(itemPath, prefix ? `${prefix}/${item}` : item);
        } else if (item.endsWith('.md')) {
          const raw = safeReadText(itemPath);
          if (!raw) continue;
          const parsed = matter(raw);
          const name = prefix ? `${prefix}/${item.replace(/\.md$/, '')}` : item.replace(/\.md$/, '');
          entries.push({
            name, filename: item, filePath: itemPath, raw,
            frontmatter: parsed.data || {},
            body: parsed.content || raw,
            excerpt: excerpt(parsed.content || raw, 150),
            paths: parsed.data?.paths || [],
            wordCount: wordCount(raw),
            subdir: prefix || null,
          });
        }
      }
    } catch { /* permission */ }
  }
  scanDir(rulesDir, '');
  return entries;
}

function readAgentsDir(dir) {
  const agentsDir = path.join(dir, 'agents');
  if (!fs.existsSync(agentsDir)) return [];
  const entries = [];
  try {
    for (const item of fs.readdirSync(agentsDir).sort()) {
      const itemPath = path.join(agentsDir, item);
      const stat = fs.statSync(itemPath);
      if (stat.isDirectory()) {
        const agentMd = path.join(itemPath, 'AGENT.md');
        const altMd   = path.join(itemPath, `${item}.md`);
        const fp = fs.existsSync(agentMd) ? agentMd : fs.existsSync(altMd) ? altMd : null;
        if (!fp) continue;
        const raw = safeReadText(fp);
        if (!raw) continue;
        const parsed = matter(raw);
        entries.push({ name: item, filename: path.basename(fp), raw,
          frontmatter: parsed.data || {}, meta: buildSkillMeta(parsed.data, item),
          body: parsed.content || raw, excerpt: excerpt(parsed.content || raw, 150),
          wordCount: wordCount(raw), isFolder: true });
      } else if (item.endsWith('.md')) {
        const raw = safeReadText(itemPath);
        if (!raw) continue;
        const parsed = matter(raw);
        entries.push({ name: item.replace(/\.md$/, ''), filename: item, raw,
          frontmatter: parsed.data || {}, meta: buildSkillMeta(parsed.data, item.replace(/\.md$/, '')),
          body: parsed.content || raw, excerpt: excerpt(parsed.content || raw, 150),
          wordCount: wordCount(raw), isFolder: false });
      }
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

// ─── Live stats computation ──────────────────────────────────────────────────
// Walks ~/.claude/projects/**/*.jsonl and aggregates usage stats. Replaces the
// stale ~/.claude/stats-cache.json dependency (Claude Code doesn't refresh it
// reliably — see git history). Result is keyed on (fileCount, maxMtime,
// totalSize) so repeated scans are O(stat) unless session data changed.
let _liveStatsCache = null;   // { key, result }
let _liveStatsComputing = false;

// Non-blocking stats accessor: returns cached result if fresh, otherwise kicks
// off a background recompute and returns whatever's in cache (null on first run).
// When the background compute finishes it broadcasts an SSE cache-invalidated
// event so the frontend refetches and the UI fills in.
function getGlobalStatsAsync() {
  const files = _collectSessionJsonlFiles();
  if (!files.length) return null;
  let maxMtime = 0, totalSize = 0;
  for (const f of files) { if (f.mtime > maxMtime) maxMtime = f.mtime; totalSize += f.size; }
  const key = `${files.length}:${maxMtime}:${totalSize}`;

  if (_liveStatsCache && _liveStatsCache.key === key) return _liveStatsCache.result;

  if (!_liveStatsComputing) {
    _liveStatsComputing = true;
    setImmediate(() => {
      try { computeGlobalStats(); broadcastSSE('cache-invalidated', { reason: 'stats-ready' }); }
      finally { _liveStatsComputing = false; }
    });
  }
  return _liveStatsCache ? _liveStatsCache.result : null;
}

function _collectSessionJsonlFiles() {
  const projectsDir = path.join(CLAUDE_DIR, 'projects');
  if (!fs.existsSync(projectsDir)) return [];
  const out = [];
  let top;
  try { top = fs.readdirSync(projectsDir); } catch { return out; }
  for (const encoded of top) {
    const encDir = path.join(projectsDir, encoded);
    let st;
    try { st = fs.statSync(encDir); } catch { continue; }
    if (!st.isDirectory()) continue;
    let entries;
    try { entries = fs.readdirSync(encDir); } catch { continue; }
    for (const entry of entries) {
      const p = path.join(encDir, entry);
      let s;
      try { s = fs.statSync(p); } catch { continue; }
      // Main session files live directly under the encoded project dir.
      // Subagent jsonl files live at <encoded>/<sessionId>/subagents/agent-*.jsonl
      // and must be excluded so they don't double-count.
      if (s.isFile() && entry.endsWith('.jsonl') && !entry.includes('agent')) {
        out.push({ path: p, mtime: s.mtimeMs, size: s.size });
      }
    }
  }
  return out;
}

function computeGlobalStats() {
  const files = _collectSessionJsonlFiles();
  if (!files.length) return null;

  let maxMtime = 0;
  let totalSize = 0;
  for (const f of files) {
    if (f.mtime > maxMtime) maxMtime = f.mtime;
    totalSize += f.size;
  }
  const key = `${files.length}:${maxMtime}:${totalSize}`;
  if (_liveStatsCache && _liveStatsCache.key === key) return _liveStatsCache.result;

  const dailyMap = {};       // date -> { messageCount, toolCallCount, sessionSet }
  const modelUsage = {};     // model -> token totals
  const hourSessions = {};   // hour -> Set<sessionId>
  const sessionMeta = {};    // sessionId -> { firstTs, lastTs, messageCount }
  const allSessions = new Set();
  let firstTs = null;
  let totalMessages = 0;
  let compactionEvents = 0;

  for (const f of files) {
    let content;
    try { content = fs.readFileSync(f.path, 'utf8'); } catch { continue; }
    const lines = content.split('\n');
    for (const line of lines) {
      if (!line) continue;
      let d;
      try { d = JSON.parse(line); } catch { continue; }
      const type = d.type;
      if (type === 'system' && d.subtype === 'compact_boundary') { compactionEvents += 1; continue; }
      if (type !== 'user' && type !== 'assistant') continue;
      const ts = d.timestamp;
      if (!ts || typeof ts !== 'string') continue;
      const date = ts.slice(0, 10);
      const sid = d.sessionId || 'unknown';

      if (!dailyMap[date]) dailyMap[date] = { messageCount: 0, toolCallCount: 0, sessionSet: new Set() };
      dailyMap[date].messageCount += 1;
      dailyMap[date].sessionSet.add(sid);

      allSessions.add(sid);
      totalMessages += 1;
      if (!firstTs || ts < firstTs) firstTs = ts;

      const hour = new Date(ts).getHours();
      if (!hourSessions[hour]) hourSessions[hour] = new Set();
      hourSessions[hour].add(sid);

      const meta = sessionMeta[sid] || (sessionMeta[sid] = { firstTs: ts, lastTs: ts, messageCount: 0 });
      if (ts < meta.firstTs) meta.firstTs = ts;
      if (ts > meta.lastTs)  meta.lastTs  = ts;
      meta.messageCount += 1;

      if (type === 'assistant') {
        const blocks = d.message && d.message.content;
        if (Array.isArray(blocks)) {
          for (const b of blocks) {
            if (b && b.type === 'tool_use') dailyMap[date].toolCallCount += 1;
          }
        }
        const model = d.message && d.message.model;
        const usage = d.message && d.message.usage;
        if (model && usage && !model.startsWith('<')) {
          const m = modelUsage[model] || (modelUsage[model] = {
            inputTokens: 0, outputTokens: 0,
            cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
            webSearchRequests: 0, costUSD: 0, contextWindow: 0, maxOutputTokens: 0
          });
          m.inputTokens              += usage.input_tokens || 0;
          m.outputTokens             += usage.output_tokens || 0;
          m.cacheReadInputTokens     += usage.cache_read_input_tokens || 0;
          m.cacheCreationInputTokens += usage.cache_creation_input_tokens || 0;
        }
      }
    }
  }

  const dailyActivity = Object.keys(dailyMap).sort().map(date => ({
    date,
    messageCount: dailyMap[date].messageCount,
    sessionCount: dailyMap[date].sessionSet.size,
    toolCallCount: dailyMap[date].toolCallCount
  }));

  const hourCounts = {};
  for (const h of Object.keys(hourSessions)) hourCounts[h] = hourSessions[h].size;

  let longestSession = null;
  for (const sid of Object.keys(sessionMeta)) {
    const meta = sessionMeta[sid];
    const duration = new Date(meta.lastTs).getTime() - new Date(meta.firstTs).getTime();
    if (!longestSession || meta.messageCount > longestSession.messageCount) {
      longestSession = {
        sessionId: sid,
        duration: Number.isFinite(duration) ? duration : 0,
        messageCount: meta.messageCount,
        timestamp: meta.firstTs
      };
    }
  }

  const result = {
    version: 3,
    lastComputedDate: new Date().toISOString().slice(0, 10),
    dailyActivity,
    modelUsage,
    totalSessions: allSessions.size,
    totalMessages,
    compactionEvents,
    longestSession,
    firstSessionDate: firstTs,
    hourCounts
  };

  _liveStatsCache = { key, result };
  return result;
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
    localRules:    hasClaudeDir ? readRulesDir(claudeDir) : [],
    localAgents:   hasClaudeDir ? readAgentsDir(claudeDir) : [],
    claudeIgnore:  (() => { const f = path.join(projectPath, '.claudeignore'); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; })(),
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
      rules:  readRulesDir(CLAUDE_DIR),
      agents: readAgentsDir(CLAUDE_DIR),
      plugins: { installedPlugins, warpPlugin },
      stats: getGlobalStatsAsync(),
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

// Heartbeat every 15s — used by client watchdog to detect stale connections
setInterval(() => broadcastSSE('heartbeat', { ts: Date.now() }), 15000);

// ─── File watcher ─────────────────────────────────────────────────────────────

// Init workflow runner and RAG engine
workflowRunner.init(broadcastSSE);
ragEngine.init();
// Build RAG index in background after startup
setTimeout(() => ragEngine.buildIndex(), 3000);

const WATCH_PATHS = [
  path.join(CLAUDE_DIR, 'settings.json'),
  path.join(CLAUDE_DIR, 'CLAUDE.md'),
  path.join(CLAUDE_DIR, 'commands'),
  path.join(CLAUDE_DIR, 'skills'),
  path.join(CLAUDE_DIR, 'plans'),
  path.join(CLAUDE_DIR, 'plugins', 'installed_plugins.json'),
  WORKFLOWS_DIR,
  path.join(CLAUDE_DIR, 'projects'),   // session JSONL files — live activity
  path.join(CLAUDE_DIR, 'todos'),
];

const watcher = chokidar.watch(WATCH_PATHS, {
  persistent: true,
  ignoreInitial: true,
  awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
  depth: 5,
});

const _watchedProjectPaths = new Set();

function watchProjectPath(projectPath) {
  const resolved = path.resolve(projectPath);
  if (_watchedProjectPaths.has(resolved)) return;
  _watchedProjectPaths.add(resolved);
  watcher.add(resolved);
}

// Resolve which scope a changed file belongs to so clients can be surgical.
function _scopeForPath(filePath) {
  const resolved = path.resolve(filePath);
  // Check registered project paths first (most specific match wins)
  let bestMatch = null;
  for (const p of _watchedProjectPaths) {
    if ((resolved === p || resolved.startsWith(p + path.sep)) &&
        (!bestMatch || p.length > bestMatch.length)) {
      bestMatch = p;
    }
  }
  if (bestMatch) return { scope: 'project', projectPath: bestMatch };
  return { scope: 'global' };
}

let _broadcastTimer = null;
const _pendingScopes = new Set();

watcher.on('all', (event, filePath) => {
  invalidateCache();
  const scopeInfo = _scopeForPath(filePath);
  _pendingScopes.add(JSON.stringify(scopeInfo));
  // Debounce — coalesce rapid bursts (e.g. git checkout touching many files)
  clearTimeout(_broadcastTimer);
  _broadcastTimer = setTimeout(() => {
    const scopes = [..._pendingScopes].map(s => JSON.parse(s));
    _pendingScopes.clear();
    // If multiple different scopes changed, just broadcast a generic global refresh
    const uniqueScopes = [...new Set(scopes.map(s => s.scope))];
    const payload = uniqueScopes.length === 1
      ? scopes[0]
      : { scope: 'all' };
    broadcastSSE('cache-invalidated', { ...payload, ts: Date.now() });
  }, 200);
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

// ─── Permissions API ──────────────────────────────────────────────────────────

// Resolve the settings file path and current JSON for a given scope
function resolveSettingsTarget(scope, projectPath) {
  if (scope === 'global') {
    return { filePath: path.join(CLAUDE_DIR, 'settings.json'), dir: CLAUDE_DIR };
  }
  if (!projectPath) throw new Error('projectPath required for project scope');
  const claudeDir = path.join(path.resolve(projectPath), '.claude');
  if (!fs.existsSync(claudeDir)) fs.mkdirSync(claudeDir, { recursive: true });
  return { filePath: path.join(claudeDir, 'settings.local.json'), dir: claudeDir };
}

app.get('/api/permissions', (req, res) => {
  try {
    const scope = req.query.scope || 'global';
    const projectPath = req.query.project || null;
    const { filePath } = resolveSettingsTarget(scope, projectPath);
    const data = safeReadJson(filePath) || {};
    res.json({ permissions: data.permissions || {}, scope, filePath });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/permissions', (req, res) => {
  try {
    const { scope, projectPath, permissions } = req.body || {};
    if (!permissions || typeof permissions !== 'object') {
      return res.status(400).json({ error: 'Missing permissions object' });
    }
    const { filePath } = resolveSettingsTarget(scope || 'global', projectPath || null);

    // Read existing file (preserve non-permission fields like hooks, model, etc.)
    const existing = safeReadJson(filePath) || {};

    // Clean the incoming permissions — remove empty arrays
    const cleaned = {};
    if (permissions.defaultMode && permissions.defaultMode !== 'default') {
      cleaned.defaultMode = permissions.defaultMode;
    }
    if (Array.isArray(permissions.allow) && permissions.allow.length > 0)   cleaned.allow = permissions.allow;
    if (Array.isArray(permissions.deny)  && permissions.deny.length  > 0)   cleaned.deny  = permissions.deny;
    if (Array.isArray(permissions.ask)   && permissions.ask.length   > 0)   cleaned.ask   = permissions.ask;
    if (Array.isArray(permissions.additionalDirectories) && permissions.additionalDirectories.length > 0) {
      cleaned.additionalDirectories = permissions.additionalDirectories;
    }

    const updated = { ...existing, permissions: cleaned };
    fs.writeFileSync(filePath, JSON.stringify(updated, null, 2) + '\n', 'utf8');
    invalidateCache();
    res.json({ ok: true, filePath, permissions: cleaned });
  } catch (err) {
    res.status(500).json({ error: err.message });
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

app.get('/api/file-tree', (req, res) => {
  const dirPath    = req.query.path;
  const projectPath = req.query.project || null;
  if (!dirPath) return res.status(400).json({ error: 'Missing path' });

  const resolved = path.resolve(dirPath);
  const allowedBases = [CLAUDE_DIR];
  if (projectPath) allowedBases.push(path.resolve(projectPath));
  const allowed = allowedBases.some(base => resolved === base || resolved.startsWith(base + path.sep));
  if (!allowed) return res.status(403).json({ error: 'Forbidden' });

  // Dynamically watch project path so editor live-syncs when Claude edits files
  if (projectPath) watchProjectPath(projectPath);

  try {
    const tree = buildFileTree(resolved, 0, 5);
    res.json({ tree });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/file', (req, res) => {
  const { path: filePath, content, project } = req.body || {};
  if (!filePath || content == null) return res.status(400).json({ error: 'Missing path or content' });
  const projectPath = project || null;
  if (!isPathAllowed(filePath, projectPath)) return res.status(403).json({ error: 'Forbidden' });
  try {
    fs.writeFileSync(filePath, content, 'utf8');
    invalidateCache();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
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

// ─── Skill Delete ────────────────────────────────────────────────────────────

app.delete('/api/skills', express.json(), (req, res) => {
  const { name, scope, projectPath } = req.body;
  if (!name) return res.status(400).json({ error: 'Missing name' });

  const baseDir = scope === 'project' && projectPath
    ? path.join(path.resolve(projectPath), '.claude', 'skills')
    : path.join(CLAUDE_DIR, 'skills');

  const resolved = resolveSourceFile(baseDir, name, 'skill');
  if (!resolved) return res.status(404).json({ error: 'Skill not found' });

  try {
    if (resolved.isFolder) {
      fs.rmSync(resolved.dir, { recursive: true, force: true });
    } else {
      fs.unlinkSync(resolved.file);
    }
    invalidateCache();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/rules', express.json(), (req, res) => {
  const { name, scope, projectPath } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const baseDir = scope === 'global'
    ? path.join(CLAUDE_DIR, 'rules')
    : path.join(path.resolve(projectPath || ''), '.claude', 'rules');
  const filePath = path.join(baseDir, `${name}.md`);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    else return res.status(404).json({ error: 'Rule not found' });
    invalidateCache();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/agents', express.json(), (req, res) => {
  const { name, scope, projectPath } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const baseDir = scope === 'global'
    ? path.join(CLAUDE_DIR, 'agents')
    : path.join(path.resolve(projectPath || ''), '.claude', 'agents');
  const flat = path.join(baseDir, `${name}.md`);
  const folder = path.join(baseDir, name);
  try {
    if (fs.existsSync(flat)) fs.unlinkSync(flat);
    else if (fs.existsSync(folder)) fs.rmSync(folder, { recursive: true, force: true });
    else return res.status(404).json({ error: 'Agent not found' });
    invalidateCache();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Share Skills/Commands ───────────────────────────────────────────────────

// Resolve skill/command source: handles flat .md and folder skills
function resolveSourceFile(baseDir, name, type) {
  if (type === 'command') {
    const f = path.join(baseDir, `${name}.md`);
    return fs.existsSync(f) ? { file: f, isFolder: false } : null;
  }
  // Skills: flat file, then folder/SKILL.md, then folder/<name>.md
  const flat      = path.join(baseDir, `${name}.md`);
  const folderDir = path.join(baseDir, name);
  const skillMd   = path.join(folderDir, 'SKILL.md');
  const altMd     = path.join(folderDir, `${name}.md`);
  if (fs.existsSync(flat))    return { file: flat,    isFolder: false };
  if (fs.existsSync(skillMd)) return { file: skillMd, isFolder: true, dir: folderDir };
  if (fs.existsSync(altMd))   return { file: altMd,   isFolder: true, dir: folderDir };
  return null;
}

function copyDirRecursive(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name), d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirRecursive(s, d);
    else fs.copyFileSync(s, d);
  }
}

app.post('/api/share', express.json(), (req, res) => {
  const { items, targetProject } = req.body;
  if (!items?.length || !targetProject)
    return res.status(400).json({ error: 'Missing items or targetProject' });

  const resolvedTarget = path.resolve(targetProject);
  const copied = [], errors = [];

  for (const item of items) {
    const { name, type, scope, sourceProject } = item;
    if (!name || !type) { errors.push({ name: name || '?', error: 'Missing fields' }); continue; }

    const subdir = type === 'command' ? 'commands' : type === 'rule' ? 'rules' : type === 'agent' ? 'agents' : 'skills';
    const sourceBase = scope === 'global'
      ? path.join(CLAUDE_DIR, subdir)
      : path.join(path.resolve(sourceProject || ''), '.claude', subdir);

    const destDir = path.join(resolvedTarget, '.claude', subdir);

    try {
      if (type === 'rule') {
        // Rules: name may include subdir like "frontend/react"
        const srcFile = path.join(sourceBase, `${name}.md`);
        if (!fs.existsSync(srcFile)) { errors.push({ name, error: 'Source rule not found' }); continue; }
        const destFile = path.join(destDir, `${name}.md`);
        const destSubDir = path.dirname(destFile);
        if (!fs.existsSync(destSubDir)) fs.mkdirSync(destSubDir, { recursive: true });
        fs.copyFileSync(srcFile, destFile);
        copied.push({ name });
      } else {
        const resolved = resolveSourceFile(sourceBase, name, type);
        if (!resolved) { errors.push({ name, error: 'Source file not found' }); continue; }
        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
        if (resolved.isFolder) {
          copyDirRecursive(resolved.dir, path.join(destDir, name));
        } else {
          fs.copyFileSync(resolved.file, path.join(destDir, `${name}.md`));
        }
        copied.push({ name });
      }
    } catch (e) {
      errors.push({ name, error: e.message });
    }
  }

  if (copied.length) invalidateCache();
  res.json({ copied, errors });
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

// ─── Git Endpoints ────────────────────────────────────────────────────────────

const { execFile } = require('child_process');

function git(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && !stdout) reject(new Error(stderr?.trim() || err.message));
      else resolve(stdout.trim());
    });
  });
}

function getProjectPath(req) {
  return req.query.project || req.body?.project || null;
}

app.get('/api/git/is-repo', async (req, res) => {
  const p = getProjectPath(req);
  if (!p) return res.json({ isRepo: false });
  try {
    await git(['rev-parse', '--git-dir'], p);
    res.json({ isRepo: true });
  } catch {
    res.json({ isRepo: false });
  }
});

app.get('/api/git/status', async (req, res) => {
  const p = getProjectPath(req);
  if (!p) return res.status(400).json({ error: 'project required' });
  try {
    const [porcelain, branchRaw, upstreamRaw] = await Promise.allSettled([
      git(['status', '--porcelain=v1'], p),
      git(['branch', '--show-current'], p),
      git(['rev-list', '--count', '--left-right', '@{upstream}...HEAD'], p),
    ]);

    const branch = branchRaw.status === 'fulfilled' ? branchRaw.value : 'unknown';

    let ahead = 0, behind = 0;
    if (upstreamRaw.status === 'fulfilled' && upstreamRaw.value) {
      const parts = upstreamRaw.value.split(/\s+/);
      behind = parseInt(parts[0], 10) || 0;
      ahead  = parseInt(parts[1], 10) || 0;
    }

    const files = [];
    if (porcelain.status === 'fulfilled' && porcelain.value) {
      for (const line of porcelain.value.split('\n')) {
        if (!line) continue;
        const x = line[0];  // index (staged)
        const y = line[1];  // worktree (unstaged)
        let filePath = line.slice(3);
        // Handle renames: "old -> new"
        if (filePath.includes(' -> ')) filePath = filePath.split(' -> ')[1];

        // A file can appear in both staged and unstaged
        if (x !== ' ' && x !== '?') {
          files.push({ path: filePath, x, y, staged: true });
        }
        if (y !== ' ' && y !== '?') {
          // Avoid adding twice if both staged and unstaged are set
          if (x === ' ' || x === '?') files.push({ path: filePath, x, y, staged: false });
        }
        if (x === '?' && y === '?') {
          files.push({ path: filePath, x: '?', y: '?', staged: false });
        }
      }
    }

    res.json({ branch, ahead, behind, files });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/git/diff', async (req, res) => {
  const p = getProjectPath(req);
  const file = req.query.file;
  const staged = req.query.staged === '1';
  if (!p || !file) return res.status(400).json({ error: 'project and file required' });
  try {
    const args = staged
      ? ['diff', '--cached', '--', file]
      : ['diff', '--', file];
    const diff = await git(args, p);
    res.json({ diff });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/git/log', async (req, res) => {
  const p = getProjectPath(req);
  if (!p) return res.status(400).json({ error: 'project required' });
  try {
    const raw = await git(['log', '--pretty=format:%H|%s|%an|%ar|%D', '-30'], p);
    const commits = raw ? raw.split('\n').map(line => {
      const [hash, subject, author, date, refs] = line.split('|');
      return { hash, subject, author, date, refs };
    }) : [];
    res.json({ commits });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/git/branches', async (req, res) => {
  const p = getProjectPath(req);
  if (!p) return res.status(400).json({ error: 'project required' });
  try {
    const raw = await git(['branch', '-a', '--format=%(refname:short)'], p);
    const branches = raw ? raw.split('\n').filter(Boolean) : [];
    res.json({ branches });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/git/checkout', async (req, res) => {
  const p      = req.body?.project;
  const branch = req.body?.branch;
  if (!p || !branch) return res.status(400).json({ error: 'project and branch required' });
  try {
    const output = await git(['checkout', branch], p);
    res.json({ ok: true, output });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/git/remotes', async (req, res) => {
  const p = getProjectPath(req);
  if (!p) return res.status(400).json({ error: 'project required' });
  try {
    const raw = await git(['remote', '-v'], p);
    const seen = new Set();
    const remotes = [];
    if (raw) {
      for (const line of raw.split('\n')) {
        const m = line.match(/^(\S+)\s+(\S+)/);
        if (m && !seen.has(m[1])) {
          seen.add(m[1]);
          remotes.push({ name: m[1], url: m[2] });
        }
      }
    }
    res.json({ remotes });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/git/worktrees', async (req, res) => {
  const p = getProjectPath(req);
  if (!p) return res.status(400).json({ error: 'project required' });
  try {
    const raw = await git(['worktree', 'list', '--porcelain'], p);
    const worktrees = [];
    let current = null;
    for (const line of (raw || '').split('\n')) {
      if (line.startsWith('worktree ')) {
        if (current) worktrees.push(current);
        current = { path: line.slice(9), branch: '', isMain: false };
      } else if (line.startsWith('branch ') && current) {
        current.branch = line.slice(7).replace('refs/heads/', '');
      } else if (line === 'bare' && current) {
        current.bare = true;
      } else if (line === '' && current) {
        worktrees.push(current);
        current = null;
      }
    }
    if (current) worktrees.push(current);
    if (worktrees.length > 0) worktrees[0].isMain = true;
    res.json({ worktrees });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/git/stage', async (req, res) => {
  const p = req.body?.project;
  const files = req.body?.files;
  if (!p || !files?.length) return res.status(400).json({ error: 'project and files required' });
  try {
    await git(['add', '--', ...files], p);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/git/unstage', async (req, res) => {
  const p = req.body?.project;
  const files = req.body?.files;
  if (!p || !files?.length) return res.status(400).json({ error: 'project and files required' });
  try {
    await git(['restore', '--staged', '--', ...files], p);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/git/discard', async (req, res) => {
  const p = req.body?.project;
  const file = req.body?.file;
  if (!p || !file) return res.status(400).json({ error: 'project and file required' });
  try {
    await git(['checkout', '--', file], p);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/git/commit', async (req, res) => {
  const p = req.body?.project;
  const summary = req.body?.summary;
  const body    = req.body?.body;
  if (!p || !summary) return res.status(400).json({ error: 'project and summary required' });
  try {
    const args = ['commit', '-m', summary];
    if (body) args.push('-m', body);
    const output = await git(args, p);
    res.json({ ok: true, output });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/git/pull', async (req, res) => {
  const p = req.body?.project;
  if (!p) return res.status(400).json({ error: 'project required' });
  try {
    const output = await git(['pull'], p);
    res.json({ ok: true, output });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/git/push', async (req, res) => {
  const p = req.body?.project;
  if (!p) return res.status(400).json({ error: 'project required' });
  try {
    const output = await git(['push'], p);
    res.json({ ok: true, output });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/git/worktree/add', async (req, res) => {
  const p        = req.body?.project;
  const wtPath   = req.body?.path;
  const branch   = req.body?.branch;
  const existing = req.body?.existing;   // true = checkout existing branch, false = create new
  if (!p || !wtPath || !branch) return res.status(400).json({ error: 'project, path, and branch required' });
  try {
    const args = existing
      ? ['worktree', 'add', wtPath, branch]           // checkout existing branch
      : ['worktree', 'add', wtPath, '-b', branch];    // create new branch
    const output = await git(args, p);
    res.json({ ok: true, output });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.delete('/api/git/worktree', async (req, res) => {
  const p      = req.body?.project;
  const wtPath = req.body?.path;
  if (!p || !wtPath) return res.status(400).json({ error: 'project and path required' });
  try {
    const output = await git(['worktree', 'remove', wtPath], p);
    res.json({ ok: true, output });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── Workflow CRUD ────────────────────────────────────────────────────────────

app.get('/api/workflows', (req, res) => {
  try {
    const files = fs.existsSync(WORKFLOWS_DIR)
      ? fs.readdirSync(WORKFLOWS_DIR).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
      : [];
    const list = files.map(f => {
      try {
        const raw  = fs.readFileSync(path.join(WORKFLOWS_DIR, f), 'utf8');
        const parsed = matter(raw);
        const nodes = parsed.data?.nodes || [];
        return {
          filename:    f,
          name:        parsed.data?.name || f.replace(/\.ya?ml$/, ''),
          description: parsed.data?.description || '',
          nodeCount:   nodes.length,
          projectPath: parsed.data?.projectPath || null,
          updatedAt:   fs.statSync(path.join(WORKFLOWS_DIR, f)).mtime.toISOString(),
        };
      } catch { return null; }
    }).filter(Boolean);
    res.json({ ok: true, workflows: list, claudeAvailable: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/workflows/:name', (req, res) => {
  const filename = req.params.name.endsWith('.yaml') || req.params.name.endsWith('.yml')
    ? req.params.name : req.params.name + '.yaml';
  const filePath = path.join(WORKFLOWS_DIR, filename);
  if (!filePath.startsWith(WORKFLOWS_DIR)) return res.status(400).json({ error: 'Invalid path' });
  try {
    const raw    = fs.readFileSync(filePath, 'utf8');
    const parsed = matter(raw);
    res.json({ ok: true, raw, data: parsed.data });
  } catch { res.status(404).json({ ok: false, error: 'Not found' }); }
});

app.post('/api/workflows/:name', (req, res) => {
  const filename = req.params.name.endsWith('.yaml') || req.params.name.endsWith('.yml')
    ? req.params.name : req.params.name + '.yaml';
  const filePath = path.join(WORKFLOWS_DIR, filename);
  if (!filePath.startsWith(WORKFLOWS_DIR)) return res.status(400).json({ error: 'Invalid path' });
  try {
    const content = req.body?.content;
    if (!content) return res.status(400).json({ error: 'content required' });
    fs.writeFileSync(filePath, content, 'utf8');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.delete('/api/workflows/:name', (req, res) => {
  const filename = req.params.name.endsWith('.yaml') || req.params.name.endsWith('.yml')
    ? req.params.name : req.params.name + '.yaml';
  const filePath = path.join(WORKFLOWS_DIR, filename);
  if (!filePath.startsWith(WORKFLOWS_DIR)) return res.status(400).json({ error: 'Invalid path' });
  try {
    fs.unlinkSync(filePath);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ─── Workflow Execution ────────────────────────────────────────────────────────

app.post('/api/workflows/:name/run', async (req, res) => {
  const filename = req.params.name.endsWith('.yaml') || req.params.name.endsWith('.yml')
    ? req.params.name : req.params.name + '.yaml';
  const filePath = path.join(WORKFLOWS_DIR, filename);
  if (!filePath.startsWith(WORKFLOWS_DIR)) return res.status(400).json({ error: 'Invalid path' });
  try {
    const raw        = fs.readFileSync(filePath, 'utf8');
    const parsed     = matter(raw);
    const inputValues = req.body?.inputs || {};
    // Fire-and-forget — run ID returned immediately, progress via SSE
    const runId = await workflowRunner.startRun(parsed.data, inputValues);
    res.json({ ok: true, runId });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/workflows/run/:runId/pause', (req, res) => {
  const run = workflowRunner.activeRuns.get(req.params.runId);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  run.pause();
  res.json({ ok: true });
});

app.post('/api/workflows/run/:runId/resume', (req, res) => {
  const run = workflowRunner.activeRuns.get(req.params.runId);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  run.resume();
  res.json({ ok: true });
});

app.post('/api/workflows/run/:runId/cancel', (req, res) => {
  const run = workflowRunner.activeRuns.get(req.params.runId);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  run.cancel();
  res.json({ ok: true });
});

app.get('/api/workflows/run/:runId/state', (req, res) => {
  const run = workflowRunner.activeRuns.get(req.params.runId);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  res.json({ ok: true, state: run.state });
});

// ─── RAG ─────────────────────────────────────────────────────────────────────

app.get('/api/rag/status', (req, res) => {
  res.json({ ok: true, ...ragEngine.getStatus() });
});

app.get('/api/rag/search', (req, res) => {
  const q = req.query.q || '';
  const k = Math.min(parseInt(req.query.k || '5', 10), 20);
  if (!q) return res.json({ ok: true, results: [] });
  res.json({ ok: true, results: ragEngine.search(q, k) });
});

app.post('/api/rag/index', async (req, res) => {
  try {
    const docCount = ragEngine.buildIndex();
    broadcastSSE('rag:indexed', { docCount, durationMs: 0 });
    res.json({ ok: true, docCount });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/rag/crawl', async (req, res) => {
  const { url, maxDepth = 1, maxPages = 20 } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url required' });
  try {
    const start    = Date.now();
    const count    = await ragEngine.crawlUrl(url, maxDepth, maxPages);
    const duration = Date.now() - start;
    broadcastSSE('rag:indexed', { docCount: ragEngine.getStatus().docCount, durationMs: duration });
    res.json({ ok: true, pagesCrawled: count });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ─── Start ────────────────────────────────────────────────────────────────────

const httpServer = app.listen(PORT, () => {
  console.log(`\n  Claude Map`);
  console.log(`  ──────────`);
  console.log(`  http://localhost:${PORT}\n`);
  // Warm live stats in the background so the first /api/scan is instant.
  setImmediate(() => { try { computeGlobalStats(); } catch { /* noop */ } });
});

// ─── Terminal WebSocket (node-pty) ────────────────────────────────────────────

const wss = new WebSocketServer({ server: httpServer, path: '/terminal' });

wss.on('connection', (ws, req) => {
  const params = new URL(req.url, `http://localhost:${PORT}`).searchParams;
  const cwd = (() => {
    try {
      const p = params.get('cwd');
      return p && fs.existsSync(p) ? p : os.homedir();
    } catch { return os.homedir(); }
  })();

  // Try shells in order until one spawns successfully
  const shellCandidates = [
    process.env.SHELL,
    '/bin/zsh', '/bin/bash', '/bin/sh',
  ].filter(Boolean);

  let term;
  let lastErr;
  for (const sh of shellCandidates) {
    try {
      term = pty.spawn(sh, [], {
        name: 'xterm-256color',
        cols: 80, rows: 24,
        cwd,
        env: { ...process.env, TERM: 'xterm-256color' },
      });
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!term) {
    ws.send(JSON.stringify({ type: 'output', data: `\r\nFailed to spawn shell: ${lastErr?.message}\r\nTry: npm rebuild node-pty\r\n` }));
    ws.close();
    return;
  }

  term.onData(data => {
    if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'output', data }));
  });
  term.onExit(() => {
    if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'exit' }));
  });

  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'input')  term.write(msg.data);
      if (msg.type === 'resize') term.resize(Math.max(1, msg.cols), Math.max(1, msg.rows));
    } catch { /* ignore malformed */ }
  });

  // Keepalive: ping every 25s so NAT/OS doesn't silently drop the TCP connection.
  // isAlive is reset to false before each ping and back to true when pong arrives.
  // If a full cycle passes with no pong the socket is considered dead and terminated.
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  const pingInterval = setInterval(() => {
    if (!ws.isAlive) { ws.terminate(); return; }
    ws.isAlive = false;
    ws.ping();
  }, 25000);

  ws.on('close', () => {
    clearInterval(pingInterval);
    try { term.kill(); } catch { /* already dead */ }
  });
});
