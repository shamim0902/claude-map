'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ─── Paths ────────────────────────────────────────────────────────────────────

const RAG_DIR  = path.join(os.homedir(), '.claude', 'rag-index');
const IDX_FILE = path.join(RAG_DIR, 'index.json');

// ─── In-memory index ──────────────────────────────────────────────────────────

let _index = null;   // { docs, idf, updatedAt }
let _rebuildTimer = null;

const STOPWORDS = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','with',
  'by','from','is','are','was','were','be','been','being','have','has',
  'had','do','does','did','will','would','could','should','may','might',
  'can','this','that','these','those','it','its','as','not','no','so',
  'if','then','else','when','where','which','who','what','how',
]);

// ─── Tokenise / TF ────────────────────────────────────────────────────────────

function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

function computeTF(tokens) {
  const freq = {};
  for (const t of tokens) freq[t] = (freq[t] || 0) + 1;
  const total = tokens.length || 1;
  const tf = {};
  for (const [w, c] of Object.entries(freq)) tf[w] = c / total;
  return tf;
}

function computeIDF(docs) {
  const df = {};
  for (const doc of docs) {
    for (const w of Object.keys(doc.tf)) df[w] = (df[w] || 0) + 1;
  }
  const N   = docs.length || 1;
  const idf = {};
  for (const [w, count] of Object.entries(df)) {
    idf[w] = Math.log(N / count) + 1;
  }
  return idf;
}

// ─── Index I/O ────────────────────────────────────────────────────────────────

function loadIndex() {
  try {
    if (fs.existsSync(IDX_FILE)) {
      _index = JSON.parse(fs.readFileSync(IDX_FILE, 'utf8'));
      console.log(`[rag] Loaded index: ${_index.docs?.length || 0} docs`);
    }
  } catch {
    _index = null;
  }
  if (!_index) _index = { docs: [], idf: {}, updatedAt: null };
}

function saveIndex() {
  try {
    fs.mkdirSync(RAG_DIR, { recursive: true });
    fs.writeFileSync(IDX_FILE, JSON.stringify(_index), 'utf8');
  } catch (e) {
    console.warn('[rag] Failed to save index:', e.message);
  }
}

// ─── Build index ──────────────────────────────────────────────────────────────

function addDoc(docs, id, source, title, filePath, text) {
  const tokens = tokenize(text);
  docs.push({ id, source, title, path: filePath, text: text.slice(0, 50000), tf: computeTF(tokens) });
}

function scanDir(docs, dir, source, ext = ['.md']) {
  if (!fs.existsSync(dir)) return;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!ext.some(e => f.endsWith(e))) continue;
      const filePath = path.join(dir, f);
      try {
        const raw  = fs.readFileSync(filePath, 'utf8');
        // Strip gray-matter frontmatter
        const body = raw.replace(/^---[\s\S]*?---\n?/, '').trim();
        const name = f.replace(/\.md$/, '');
        addDoc(docs, `${source}:${name}`, source, name, filePath, body);
      } catch { /* skip unreadable */ }
    }
  } catch { /* skip unreadable dir */ }
}

function buildIndex() {
  console.log('[rag] Building index…');
  const docs = [];

  scanDir(docs, path.join(os.homedir(), '.claude', 'skills'),   'skill');
  scanDir(docs, path.join(os.homedir(), '.claude', 'commands'),  'command');
  scanDir(docs, path.join(os.homedir(), '.claude', 'plans'),     'plan');

  // Existing crawled docs — merge back in
  if (_index?.docs) {
    for (const d of _index.docs) {
      if (d.source === 'web' && !docs.find(x => x.id === d.id)) {
        docs.push(d);
      }
    }
  }

  const idf = computeIDF(docs);
  _index = { docs, idf, updatedAt: new Date().toISOString() };
  saveIndex();
  console.log(`[rag] Index built: ${docs.length} docs`);
  return docs.length;
}

function scheduleRebuild() {
  clearTimeout(_rebuildTimer);
  _rebuildTimer = setTimeout(() => buildIndex(), 2000);
}

// ─── Search ───────────────────────────────────────────────────────────────────

function search(query, k = 5) {
  if (!_index || !_index.docs.length) return [];
  const qTokens = tokenize(query);
  if (!qTokens.length) return [];

  const idf = _index.idf;
  const scored = _index.docs.map(doc => {
    let score = 0;
    for (const w of qTokens) {
      if (doc.tf[w] && idf[w]) score += doc.tf[w] * idf[w];
    }
    return { ...doc, score };
  });

  return scored
    .filter(d => d.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(d => ({
      id:      d.id,
      source:  d.source,
      title:   d.title,
      path:    d.path,
      score:   Math.round(d.score * 1000) / 1000,
      excerpt: d.text.slice(0, 300),
    }));
}

// ─── Web crawler ──────────────────────────────────────────────────────────────

async function crawlUrl(startUrl, maxDepth = 1, maxPages = 20) {
  const visited = new Set();
  const queue   = [{ url: startUrl, depth: 0 }];
  const crawled = [];

  while (queue.length && crawled.length < maxPages) {
    const { url: current, depth } = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);

    try {
      const res = await fetch(current, {
        signal:  AbortSignal.timeout(10000),
        headers: { 'User-Agent': 'claude-map/1.0 (RAG indexer)' },
      });
      if (!res.ok) continue;

      const html = await res.text();

      // Extract readable text
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 50000);

      const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
      const title      = titleMatch ? titleMatch[1].trim() : current;

      crawled.push({ url: current, title, text });

      // Follow same-origin links if not at max depth
      if (depth < maxDepth) {
        const base   = new URL(current);
        const linkRx = /href=["']([^"'#]+)["']/gi;
        let m;
        while ((m = linkRx.exec(html)) !== null) {
          try {
            const abs = new URL(m[1], base).href;
            if (abs.startsWith(base.origin) && !visited.has(abs)) {
              queue.push({ url: abs, depth: depth + 1 });
            }
          } catch { /* invalid URL */ }
        }
      }
    } catch { /* network error — skip */ }
  }

  // Merge crawled docs into index
  if (!_index) _index = { docs: [], idf: {}, updatedAt: null };
  for (const page of crawled) {
    const id  = 'web:' + page.url;
    const idx = _index.docs.findIndex(d => d.id === id);
    const tokens = tokenize(page.text);
    const doc    = { id, source: 'web', title: page.title, path: page.url, text: page.text, tf: computeTF(tokens) };
    if (idx >= 0) _index.docs[idx] = doc;
    else _index.docs.push(doc);
  }
  _index.idf       = computeIDF(_index.docs);
  _index.updatedAt = new Date().toISOString();
  saveIndex();

  return crawled.length;
}

// ─── Status ───────────────────────────────────────────────────────────────────

function getStatus() {
  return {
    docCount:   _index?.docs?.length || 0,
    updatedAt:  _index?.updatedAt    || null,
    sources:    _index?.docs
      ? [...new Set(_index.docs.map(d => d.source))].reduce((acc, s) => {
          acc[s] = _index.docs.filter(d => d.source === s).length;
          return acc;
        }, {})
      : {},
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

module.exports = { init: loadIndex, buildIndex, scheduleRebuild, search, crawlUrl, getStatus };
