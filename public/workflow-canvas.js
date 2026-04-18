'use strict';

/* global WFForms, jsyaml */

// ─── WFCanvas — SVG drag-and-drop workflow designer ──────────────────────────

const WFCanvas = (() => {

  // ── Node type palette ─────────────────────────────────────────────────────

  const NODE_TYPE = {
    input:     { color: '#3b7dd8', icon: '→', label: 'Input'     },
    agent:     { color: '#7c5cbf', icon: '◆', label: 'Agent'     },
    skill:     { color: '#2a9d8f', icon: '⚡', label: 'Skill'     },
    condition: { color: '#c8933a', icon: '?',  label: 'Condition' },
    refiner:   { color: '#c0604a', icon: '↺', label: 'Refiner'   },
    output:    { color: '#457b9d', icon: '✓', label: 'Output'    },
  };

  const NODE_W = 170, NODE_H = 56, PORT_R = 7, CORNER = 8;
  const NS = 'http://www.w3.org/2000/svg';

  // ── Module state ──────────────────────────────────────────────────────────

  let _svg = null, _root = null;
  let _def = null;         // { name, nodes:[], edges:[] }
  let _onSave = null;
  let _selected = null;    // nodeId string
  let _drag = null;        // { nodeId?, pan?, startX, startY, origX, origY }
  let _edgeDrag = null;    // { fromId, x1, y1, preview }
  let _pan = { x: 40, y: 40 };
  let _zoom = 1;
  let _dirty = false;

  // ── SVG helpers ───────────────────────────────────────────────────────────

  function el(tag, attrs) {
    const e = document.createElementNS(NS, tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  }

  function svgPt(evt) {
    const pt = _svg.createSVGPoint();
    pt.x = evt.clientX; pt.y = evt.clientY;
    return pt.matrixTransform(_root.getScreenCTM().inverse());
  }

  function nodeById(id) { return (_def.nodes || []).find(n => n.id === id); }

  // ── Arrow marker ──────────────────────────────────────────────────────────

  function ensureArrowDef() {
    // Remove old defs if any
    _svg.querySelectorAll('defs').forEach(d => d.remove());
    const defs   = el('defs');
    const marker = el('marker', {
      id: 'wf-arrow', markerWidth: '9', markerHeight: '9',
      refX: '8', refY: '4', orient: 'auto',
    });
    const poly = el('polygon', { points: '0 0, 9 4, 0 8', fill: 'rgba(180,180,200,0.5)' });
    marker.appendChild(poly);
    defs.appendChild(marker);
    _svg.appendChild(defs);
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  function render() {
    if (!_svg) return;
    _svg.innerHTML = '';
    ensureArrowDef();

    _root = el('g');
    _svg.appendChild(_root);

    // Edges first (drawn below nodes)
    for (const edge of (_def.edges || [])) renderEdgeEl(edge);
    // Nodes on top
    for (const node of (_def.nodes || [])) renderNodeEl(node);

    applyTransform();
  }

  function edgePath(from, to) {
    const x1 = from.position.x + NODE_W, y1 = from.position.y + NODE_H / 2;
    const x2 = to.position.x,             y2 = to.position.y   + NODE_H / 2;
    const dx = Math.max(40, Math.abs(x2 - x1) * 0.45);
    return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
  }

  function renderEdgeEl(edge) {
    const from = nodeById(edge.from), to = nodeById(edge.to);
    if (!from || !to) return;
    const path = el('path', {
      d: edgePath(from, to),
      class: 'wf-edge',
      'marker-end': 'url(#wf-arrow)',
      'data-from': edge.from,
      'data-to': edge.to,
    });
    // Right-click to delete edge
    path.addEventListener('contextmenu', e => {
      e.preventDefault();
      e.stopPropagation();
      _def.edges = _def.edges.filter(ed => !(ed.from === edge.from && ed.to === edge.to));
      render();
      markDirty();
    });
    _root.appendChild(path);
  }

  function renderNodeEl(node) {
    const tc = NODE_TYPE[node.type] || NODE_TYPE.agent;
    const x  = node.position?.x ?? 0;
    const y  = node.position?.y ?? 0;
    const sel = _selected === node.id;

    const g = el('g', { class: 'wf-node', 'data-id': node.id, transform: `translate(${x},${y})` });

    // Selection ring
    if (sel) {
      g.appendChild(el('rect', {
        x: -3, y: -3, width: NODE_W + 6, height: NODE_H + 6,
        rx: CORNER + 2, ry: CORNER + 2,
        fill: 'none', stroke: '#60a5fa', 'stroke-width': 2.5,
      }));
    }

    // Body
    g.appendChild(el('rect', {
      width: NODE_W, height: NODE_H,
      rx: CORNER, ry: CORNER,
      fill: tc.color, opacity: node._status === 'skipped' ? 0.35 : 0.92,
    }));

    // Status ring
    if (node._status === 'running') {
      const ring = el('rect', {
        width: NODE_W, height: NODE_H, rx: CORNER, ry: CORNER,
        fill: 'none', stroke: '#fbbf24', 'stroke-width': 2.5, class: 'wf-node-pulse',
      });
      g.appendChild(ring);
    } else if (node._status === 'error') {
      g.appendChild(el('rect', {
        width: NODE_W, height: NODE_H, rx: CORNER, ry: CORNER,
        fill: 'none', stroke: '#f87171', 'stroke-width': 2.5,
      }));
    }

    // Icon strip
    g.appendChild(el('rect', {
      x: 0, y: 0, width: 34, height: NODE_H, rx: CORNER, ry: CORNER,
      fill: 'rgba(0,0,0,0.22)',
    }));
    // Mask the right half of icon strip
    g.appendChild(el('rect', { x: 17, y: 0, width: 17, height: NODE_H, fill: 'rgba(0,0,0,0.22)' }));

    const iconT = el('text', {
      x: 17, y: NODE_H / 2 + 5, 'text-anchor': 'middle',
      'font-size': 14, fill: 'white', 'pointer-events': 'none',
    });
    iconT.textContent = tc.icon;
    g.appendChild(iconT);

    // Status icon (done/error)
    if (node._status === 'done') {
      const done = el('text', { x: NODE_W - 6, y: 14, 'text-anchor': 'end', 'font-size': 11, fill: '#4ade80', 'pointer-events': 'none' });
      done.textContent = '✓';
      g.appendChild(done);
    }

    // Label
    const lbl = el('text', {
      x: 42, y: NODE_H / 2 - 5,
      'font-size': 12, 'font-weight': 600, fill: 'white', 'pointer-events': 'none',
      class: 'wf-node-label',
    });
    lbl.textContent = (node.label || node.id).slice(0, 18);
    g.appendChild(lbl);

    const sub = el('text', {
      x: 42, y: NODE_H / 2 + 10,
      'font-size': 10, fill: 'rgba(255,255,255,0.6)', 'pointer-events': 'none',
    });
    sub.textContent = node.id.slice(0, 22);
    g.appendChild(sub);

    // Input port (left, skip for input nodes)
    if (node.type !== 'input') {
      const inP = el('circle', {
        cx: 0, cy: NODE_H / 2, r: PORT_R,
        fill: '#1e293b', stroke: 'rgba(255,255,255,0.35)', 'stroke-width': 1.5,
        class: 'wf-port wf-port-in', cursor: 'crosshair',
        'data-node': node.id, 'data-port': 'in',
      });
      g.appendChild(inP);
    }

    // Output port (right, skip for output nodes)
    if (node.type !== 'output') {
      const outP = el('circle', {
        cx: NODE_W, cy: NODE_H / 2, r: PORT_R,
        fill: '#1e293b', stroke: 'rgba(255,255,255,0.35)', 'stroke-width': 1.5,
        class: 'wf-port wf-port-out', cursor: 'crosshair',
        'data-node': node.id, 'data-port': 'out',
      });
      g.appendChild(outP);
    }

    // Drag handle (transparent overlay on body, excludes ports)
    const handle = el('rect', {
      x: PORT_R + 2, y: 0, width: NODE_W - (PORT_R + 2) * 2, height: NODE_H,
      fill: 'transparent', cursor: 'grab', class: 'wf-node-handle', 'data-node': node.id,
    });
    g.appendChild(handle);

    _root.appendChild(g);
  }

  function applyTransform() {
    if (_root) _root.setAttribute('transform', `translate(${_pan.x},${_pan.y}) scale(${_zoom})`);
  }

  function redrawEdges() {
    _root.querySelectorAll('.wf-edge').forEach(p => p.remove());
    const firstNode = _root.querySelector('.wf-node');
    for (const edge of (_def.edges || [])) {
      const from = nodeById(edge.from), to = nodeById(edge.to);
      if (!from || !to) continue;
      const path = el('path', {
        d: edgePath(from, to), class: 'wf-edge',
        'marker-end': 'url(#wf-arrow)', 'data-from': edge.from, 'data-to': edge.to,
      });
      path.addEventListener('contextmenu', e => {
        e.preventDefault(); e.stopPropagation();
        _def.edges = _def.edges.filter(ed => !(ed.from === edge.from && ed.to === edge.to));
        render(); markDirty();
      });
      _root.insertBefore(path, firstNode);
    }
  }

  // ── Event handlers ─────────────────────────────────────────────────────────

  function onMouseDown(e) {
    if (e.button !== 0) return;
    const target = e.target;

    // Output port → begin edge draw
    if (target.classList.contains('wf-port-out')) {
      e.stopPropagation();
      const nodeId = target.getAttribute('data-node');
      const node   = nodeById(nodeId);
      if (!node) return;
      const pt = svgPt(e);
      const x1 = node.position.x + NODE_W, y1 = node.position.y + NODE_H / 2;
      const preview = el('path', { class: 'wf-edge wf-edge-preview', 'stroke-dasharray': '7 4', d: `M${x1},${y1} L${pt.x},${pt.y}` });
      _root.appendChild(preview);
      _edgeDrag = { fromId: nodeId, x1, y1, preview };
      return;
    }

    // Input port → ignore (edge lands here on mouseup)
    if (target.classList.contains('wf-port-in')) { e.stopPropagation(); return; }

    // Node handle → drag node
    if (target.classList.contains('wf-node-handle')) {
      e.stopPropagation();
      const nodeId = target.getAttribute('data-node');
      const node   = nodeById(nodeId);
      if (!node) return;
      selectNode(nodeId);
      const pt = svgPt(e);
      _drag = { nodeId, startX: pt.x, startY: pt.y, origX: node.position.x, origY: node.position.y };
      target.style.cursor = 'grabbing';
      return;
    }

    // Node group click → select
    const nodeG = target.closest?.('[data-id]');
    if (nodeG && nodeG !== _svg) {
      selectNode(nodeG.getAttribute('data-id'));
      return;
    }

    // Empty canvas → pan
    _drag = { pan: true, startX: e.clientX, startY: e.clientY, origX: _pan.x, origY: _pan.y };
  }

  function onMouseMove(e) {
    if (_edgeDrag) {
      const pt = svgPt(e);
      const { x1, y1 } = _edgeDrag;
      const dx = Math.max(30, Math.abs(pt.x - x1) * 0.45);
      _edgeDrag.preview.setAttribute('d', `M${x1},${y1} C${x1+dx},${y1} ${pt.x-dx},${pt.y} ${pt.x},${pt.y}`);
      return;
    }
    if (!_drag) return;

    if (_drag.pan) {
      _pan.x = _drag.origX + (e.clientX - _drag.startX);
      _pan.y = _drag.origY + (e.clientY - _drag.startY);
      applyTransform();
      return;
    }

    const pt = svgPt(e);
    const node = nodeById(_drag.nodeId);
    if (!node) return;
    node.position.x = Math.round(_drag.origX + (pt.x - _drag.startX));
    node.position.y = Math.round(_drag.origY + (pt.y - _drag.startY));

    const g = _root.querySelector(`[data-id="${_drag.nodeId}"]`);
    if (g) g.setAttribute('transform', `translate(${node.position.x},${node.position.y})`);
    redrawEdges();
  }

  function onMouseUp(e) {
    if (_edgeDrag) {
      const target = document.elementFromPoint(e.clientX, e.clientY);
      const toId   = target?.getAttribute?.('data-node');
      const toPort = target?.getAttribute?.('data-port');

      if (toId && toPort === 'in' && toId !== _edgeDrag.fromId) {
        const dup = (_def.edges || []).some(ed => ed.from === _edgeDrag.fromId && ed.to === toId);
        if (!dup) { _def.edges.push({ from: _edgeDrag.fromId, to: toId }); markDirty(); }
        render();
        selectNode(_selected);
      } else {
        _edgeDrag.preview.remove();
      }
      _edgeDrag = null;
      return;
    }

    if (_drag && !_drag.pan) {
      markDirty();
      const h = _root.querySelector(`[data-id="${_drag.nodeId}"] .wf-node-handle`);
      if (h) h.style.cursor = 'grab';
    }
    _drag = null;
  }

  function onWheel(e) {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.91;
    _zoom = Math.max(0.15, Math.min(4, _zoom * factor));
    applyTransform();
  }

  function onKeyDown(e) {
    if (!_svg) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') &&
        document.activeElement === document.body &&
        _selected) {
      deleteSelected();
    }
  }

  // ── Selection & props ──────────────────────────────────────────────────────

  function selectNode(id) {
    _selected = id;
    // Update selection ring without full re-render
    _root.querySelectorAll('.wf-node').forEach(g => {
      const existing = g.querySelector('[stroke="#60a5fa"]');
      if (existing) existing.remove();
    });
    if (id) {
      const g = _root.querySelector(`[data-id="${id}"]`);
      if (g) {
        const ring = el('rect', {
          x: -3, y: -3, width: NODE_W + 6, height: NODE_H + 6,
          rx: CORNER + 2, ry: CORNER + 2,
          fill: 'none', stroke: '#60a5fa', 'stroke-width': 2.5,
        });
        g.insertBefore(ring, g.firstChild);
      }
    }
    refreshPropsPanel();
  }

  function refreshPropsPanel() {
    const panel = document.getElementById('wf-props-panel');
    if (!panel) return;
    const node = _selected ? nodeById(_selected) : null;
    if (node) {
      panel.innerHTML = (typeof WFForms !== 'undefined') ? WFForms.render(node, _def) : '';
    } else {
      panel.innerHTML = '<div class="wf-props-empty">Select a node to edit its properties.</div>';
    }
  }

  // ── Dirty tracking ─────────────────────────────────────────────────────────

  function markDirty() {
    _dirty = true;
    const btn = document.getElementById('wf-save-btn');
    if (btn) { btn.textContent = '● Save'; btn.classList.add('unsaved'); }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  function init(svgEl, workflowDef, onSaveFn) {
    destroy(); // detach old listeners
    _svg     = svgEl;
    _def     = JSON.parse(JSON.stringify(workflowDef));
    _onSave  = onSaveFn;
    _selected = null; _drag = null; _edgeDrag = null;
    _pan = { x: 40, y: 40 }; _zoom = 1; _dirty = false;

    render();
    fitView();
    refreshPropsPanel();

    _svg.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup',   onMouseUp);
    _svg.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);
  }

  function destroy() {
    if (!_svg) return;
    _svg.removeEventListener('mousedown', onMouseDown);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup',   onMouseUp);
    _svg.removeEventListener('wheel', onWheel);
    window.removeEventListener('keydown', onKeyDown);
    _svg = null;
  }

  function fitView() {
    if (!_def.nodes?.length) return;
    const xs = _def.nodes.map(n => n.position?.x ?? 0);
    const ys = _def.nodes.map(n => n.position?.y ?? 0);
    _pan.x = 60 - Math.min(...xs);
    _pan.y = 60 - Math.min(...ys);
    applyTransform();
  }

  function addNode(type) {
    const tc = NODE_TYPE[type] || NODE_TYPE.agent;
    const id  = type + '-' + Date.now().toString(36);
    const svgRect = _svg.getBoundingClientRect();
    const cx = (svgRect.width  / 2 - _pan.x) / _zoom;
    const cy = (svgRect.height / 2 - _pan.y) / _zoom;
    _def.nodes.push({
      id, type, label: tc.label,
      position: { x: Math.round(cx - NODE_W / 2), y: Math.round(cy - NODE_H / 2) },
      config: {},
    });
    render();
    selectNode(id);
    markDirty();
  }

  function deleteSelected() {
    if (!_selected) return;
    _def.nodes  = _def.nodes.filter(n => n.id !== _selected);
    _def.edges  = _def.edges.filter(e => e.from !== _selected && e.to !== _selected);
    _selected = null;
    render();
    refreshPropsPanel();
    markDirty();
  }

  function applyNodeProps() {
    if (!_selected) return;
    const node = nodeById(_selected);
    if (!node) return;
    if (typeof WFForms !== 'undefined') WFForms.apply(node);
    // Update label text in SVG without full re-render
    const g = _root?.querySelector(`[data-id="${node.id}"]`);
    if (g) {
      const lblEl = g.querySelector('.wf-node-label');
      if (lblEl) lblEl.textContent = (node.label || node.id).slice(0, 18);
    }
    markDirty();
  }

  function save() {
    if (!_onSave) return;
    _onSave(generateYaml(), _def);
    _dirty = false;
    const btn = document.getElementById('wf-save-btn');
    if (btn) { btn.textContent = 'Save'; btn.classList.remove('unsaved'); }
  }

  function updateNodeStatus(nodeId, status) {
    const node = nodeById(nodeId);
    if (node) { node._status = status; }
    // Re-render that one node
    if (!_root) return;
    const oldG = _root.querySelector(`[data-id="${nodeId}"]`);
    if (oldG) oldG.remove();
    renderNodeEl(nodeById(nodeId) || { id: nodeId, type: 'agent', position: { x: 0, y: 0 } });
  }

  function generateYaml() {
    const out = {
      version: 1,
      name: _def.name || '',
      description: _def.description || '',
      ..._def.projectPath ? { projectPath: _def.projectPath } : {},
      nodes: (_def.nodes || []).map(n => {
        const nn = { id: n.id, type: n.type, label: n.label, position: n.position };
        if (n.config && Object.keys(n.config).length) nn.config = n.config;
        return nn;
      }),
      edges: (_def.edges || []).map(e => ({ from: e.from, to: e.to, ...(e.label ? { label: e.label } : {}) })),
    };
    if (typeof jsyaml !== 'undefined') {
      return jsyaml.dump(out, { lineWidth: 120, quotingType: '"' });
    }
    // Fallback minimal serializer
    return yamlFallback(out);
  }

  function yamlFallback(obj) {
    function val(v, indent) {
      if (v === null || v === undefined) return 'null';
      if (typeof v === 'boolean') return String(v);
      if (typeof v === 'number') return String(v);
      if (typeof v === 'string') {
        if (v.includes('\n')) return '|\n' + v.split('\n').map(l => indent + '  ' + l).join('\n');
        return JSON.stringify(v);
      }
      if (Array.isArray(v)) {
        if (!v.length) return '[]';
        return '\n' + v.map(item => indent + '- ' + val(item, indent + '  ').replace(/^\n/, '')).join('\n');
      }
      if (typeof v === 'object') {
        const pairs = Object.entries(v).filter(([, vv]) => vv !== null && vv !== undefined && vv !== '');
        if (!pairs.length) return '{}';
        return '\n' + pairs.map(([k, vv]) => indent + k + ': ' + val(vv, indent + '  ')).join('\n');
      }
      return String(v);
    }
    return Object.entries(obj)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => k + ': ' + val(v, ''))
      .join('\n') + '\n';
  }

  function getDefinition() { return _def; }
  function isDirty()        { return _dirty; }

  return {
    init, destroy,
    addNode, deleteSelected, applyNodeProps,
    save, generateYaml, getDefinition, isDirty,
    updateNodeStatus, fitView,
  };

})();
