'use strict';

const { spawn }  = require('child_process');
const path       = require('path');
const fs         = require('fs');
const os         = require('os');

// ─── Internal state ───────────────────────────────────────────────────────────

let _broadcast = () => {};  // injected via init()

// runId → { cancel, pause, resume, state }
const activeRuns = new Map();

function init(broadcastFn) {
  _broadcast = broadcastFn;
}

// ─── ID / context helpers ─────────────────────────────────────────────────────

function generateRunId() {
  return 'run-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}

function resolveTemplate(str, context) {
  if (!str) return '';
  return str.replace(/\{\{([a-z0-9_-]+)\.([a-z0-9_]+)\}\}/gi, (_, id, field) => {
    return context[id]?.[field] ?? '';
  });
}

function evaluateCondition(expr, context) {
  const resolved = resolveTemplate(expr, context);
  const containsMatch    = resolved.match(/^([\s\S]+?)\s+contains\s+'([^']+)'$/i);
  const notContainsMatch = resolved.match(/^([\s\S]+?)\s+not contains\s+'([^']+)'$/i);
  if (notContainsMatch) return !notContainsMatch[1].includes(notContainsMatch[2]);
  if (containsMatch)    return containsMatch[1].includes(containsMatch[2]);
  return Boolean(resolved.trim());
}

// ─── Topological sort ─────────────────────────────────────────────────────────

function topoSort(nodes, edges) {
  const nodeMap  = Object.fromEntries(nodes.map(n => [n.id, n]));
  const inDegree = Object.fromEntries(nodes.map(n => [n.id, 0]));
  const adj      = Object.fromEntries(nodes.map(n => [n.id, []]));

  for (const e of edges) {
    if (nodeMap[e.from] && nodeMap[e.to]) {
      adj[e.from].push(e.to);
      inDegree[e.to]++;
    }
  }

  // Kahn's algorithm
  const queue  = nodes.filter(n => inDegree[n.id] === 0).map(n => n.id);
  const sorted = [];
  const visited = new Set();

  while (queue.length) {
    const id = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    sorted.push(id);
    for (const next of (adj[id] || [])) {
      inDegree[next]--;
      if (inDegree[next] === 0) queue.push(next);
    }
  }

  // Any remaining unvisited = part of a back-edge cycle (condition loops) — append in definition order
  for (const n of nodes) {
    if (!visited.has(n.id)) sorted.push(n.id);
  }

  return sorted.map(id => nodeMap[id]).filter(Boolean);
}

// ─── Process execution ────────────────────────────────────────────────────────

function executeClaudeProcess(prompt, cwd, runId, nodeId) {
  return new Promise((resolve, reject) => {
    const safeCwd = (cwd && fs.existsSync(cwd)) ? cwd : os.homedir();
    let stdout = '';
    let child;

    if (prompt.length > 3500) {
      // Large prompt: pipe via stdin
      child = spawn('claude', ['--cwd', safeCwd], {
        cwd: safeCwd,
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      child.stdin.write(prompt);
      child.stdin.end();
    } else {
      child = spawn('claude', ['-p', prompt, '--cwd', safeCwd], {
        cwd: safeCwd,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    }

    child.stdout.on('data', chunk => {
      const text = chunk.toString();
      stdout += text;
      _broadcast('workflow:progress', { runId, nodeId, status: 'running', chunk: text });
    });

    child.stderr.on('data', chunk => {
      _broadcast('workflow:progress', { runId, nodeId, status: 'running', chunk: '[stderr] ' + chunk.toString() });
    });

    child.on('error', err => reject(err));
    child.on('close', code => {
      if (code === 0 || stdout.length > 0) resolve(stdout.trim());
      else reject(new Error(`claude exited with code ${code}`));
    });

    // Expose kill handle to active runs map
    if (runId && activeRuns.has(runId)) {
      const run = activeRuns.get(runId);
      run._childKill = () => { try { child.kill('SIGTERM'); } catch {} };
    }
  });
}

// ─── Node executors ───────────────────────────────────────────────────────────

async function executeAgentNode(node, context, runId) {
  const prompt = resolveTemplate(node.config?.prompt || '', context);
  const cwd    = node.config?.projectPath || null;
  return executeClaudeProcess(prompt, cwd, runId, node.id);
}

async function executeSkillNode(node, context, runId) {
  const skillName = node.config?.skillName;
  if (!skillName) throw new Error('Skill node missing skillName');

  const skillDirs = [
    path.join(os.homedir(), '.claude', 'skills'),
  ];
  let skillBody = null;
  for (const dir of skillDirs) {
    const filePath = path.join(dir, skillName + '.md');
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      // Strip gray-matter frontmatter
      skillBody = raw.replace(/^---[\s\S]*?---\n?/, '').trim();
      break;
    }
  }
  if (!skillBody) throw new Error(`Skill not found: ${skillName}`);

  const args    = resolveTemplate(node.config?.args || '', context);
  const prompt  = skillBody.replace(/\$ARGUMENTS/g, args);
  const resolved = resolveTemplate(prompt, context);
  const cwd     = node.config?.projectPath || null;
  return executeClaudeProcess(resolved, cwd, runId, node.id);
}

async function executeRefinerNode(node, context, runId) {
  const cfg = node.config || {};
  const maxIterations = cfg.maxIterations || 3;
  let iteration    = 0;
  let currentOutput = resolveTemplate(cfg.refinePrompt || '', context);

  while (iteration < maxIterations) {
    _broadcast('workflow:progress', {
      runId, nodeId: node.id, status: 'running',
      iteration, phase: 'checking',
    });

    // Check step
    const checkContext = { ...context, [node.id]: { output: currentOutput, lastReview: '' } };
    const checkPrompt  = resolveTemplate(cfg.checkPrompt || '', checkContext);
    const review       = await executeClaudeProcess(checkPrompt, cfg.projectPath || null, runId, node.id + ':check');

    const evalContext = { ...context, [node.id]: { output: currentOutput, lastReview: review } };
    const passes      = evaluateCondition(cfg.condition || '', evalContext);

    if (passes) break;

    iteration++;
    if (iteration >= maxIterations) break;

    // Refine step
    _broadcast('workflow:progress', {
      runId, nodeId: node.id, status: 'running',
      iteration, phase: 'refining',
    });
    const refineContext  = { ...context, [node.id]: { output: currentOutput, lastReview: review } };
    const refinePrompt   = resolveTemplate(cfg.refinePrompt || '', refineContext);
    currentOutput        = await executeClaudeProcess(refinePrompt, cfg.projectPath || null, runId, node.id + ':refine');
  }

  return currentOutput;
}

function executeConditionNode(node, context) {
  const passes = evaluateCondition(node.config?.condition || '', context);
  return passes ? (node.config?.trueTarget || null) : (node.config?.falseTarget || null);
}

// ─── Main run loop ────────────────────────────────────────────────────────────

async function startRun(workflowDef, inputValues = {}) {
  const runId = generateRunId();
  const nodes = workflowDef.nodes || [];
  const edges = workflowDef.edges || [];

  // Build run state
  const runState = {
    runId,
    workflowName: workflowDef.name,
    status: 'running',
    nodeStates: Object.fromEntries(nodes.map(n => [n.id, { status: 'pending', output: null, startedAt: null, endedAt: null, iteration: 0 }])),
    context: {},
    error: null,
    _childKill: null,
    _paused: false,
    _cancelled: false,
  };

  // Pause/resume/cancel controls
  let _resumeResolve = null;
  const controls = {
    cancel: () => {
      runState._cancelled = true;
      if (runState._childKill) runState._childKill();
      if (_resumeResolve) _resumeResolve();
    },
    pause:  () => { runState._paused = true; },
    resume: () => {
      runState._paused = false;
      if (_resumeResolve) { _resumeResolve(); _resumeResolve = null; }
    },
    state: runState,
  };
  activeRuns.set(runId, controls);

  _broadcast('workflow:progress', { runId, status: 'started', workflowName: workflowDef.name });

  // Inject input values into context up-front
  for (const node of nodes) {
    if (node.type === 'input') {
      runState.context[node.id] = { output: inputValues[node.id] || node.config?.default || '' };
      runState.nodeStates[node.id].status = 'done';
    }
  }

  const sorted = topoSort(nodes, edges);
  const skipped = new Set();

  try {
    for (const node of sorted) {
      if (runState._cancelled) break;
      if (skipped.has(node.id)) {
        runState.nodeStates[node.id].status = 'skipped';
        continue;
      }
      if (node.type === 'input') continue; // already handled

      // Wait if paused
      if (runState._paused) {
        _broadcast('workflow:progress', { runId, nodeId: node.id, status: 'paused' });
        await new Promise(r => { _resumeResolve = r; });
        if (runState._cancelled) break;
      }

      runState.nodeStates[node.id].status = 'running';
      runState.nodeStates[node.id].startedAt = new Date().toISOString();
      _broadcast('workflow:progress', { runId, nodeId: node.id, status: 'running' });

      try {
        let output = '';

        if (node.type === 'agent') {
          output = await executeAgentNode(node, runState.context, runId);

        } else if (node.type === 'skill') {
          output = await executeSkillNode(node, runState.context, runId);

        } else if (node.type === 'refiner') {
          output = await executeRefinerNode(node, runState.context, runId);

        } else if (node.type === 'condition') {
          const nextId = executeConditionNode(node, runState.context);
          // Mark the branch NOT taken as skipped
          const trueTarget  = node.config?.trueTarget;
          const falseTarget = node.config?.falseTarget;
          if (nextId === trueTarget  && falseTarget) skipped.add(falseTarget);
          if (nextId === falseTarget && trueTarget)  skipped.add(trueTarget);
          output = nextId || '';

        } else if (node.type === 'output') {
          output = resolveTemplate(node.config?.message || '', runState.context);
        }

        runState.context[node.id] = { output };
        runState.nodeStates[node.id].status  = 'done';
        runState.nodeStates[node.id].output  = output;
        runState.nodeStates[node.id].endedAt = new Date().toISOString();
        _broadcast('workflow:progress', { runId, nodeId: node.id, status: 'done', output });

      } catch (err) {
        runState.nodeStates[node.id].status = 'error';
        runState.nodeStates[node.id].endedAt = new Date().toISOString();
        _broadcast('workflow:error', { runId, nodeId: node.id, error: err.message });
        runState.status = 'error';
        runState.error  = err.message;
        break;
      }
    }

    if (runState.status !== 'error') {
      runState.status = runState._cancelled ? 'cancelled' : 'done';
    }
    _broadcast('workflow:done', { runId, status: runState.status, context: runState.context });

  } finally {
    // Keep run state for 5 min then clean up
    setTimeout(() => activeRuns.delete(runId), 5 * 60 * 1000);
  }

  return runId;
}

// ─── Public API ───────────────────────────────────────────────────────────────

module.exports = { init, startRun, activeRuns };
