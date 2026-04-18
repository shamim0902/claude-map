'use strict';

/* global WFCanvas, escapeHtml, escapeAttr */

// ─── WFForms — Node property editor for the workflow canvas ──────────────────

const WFForms = (() => {

  // Fields each node type exposes in its config
  const CONFIG_FIELDS = {
    input:     ['default'],
    agent:     ['prompt', 'projectPath'],
    skill:     ['skillName', 'args', 'projectPath'],
    condition: ['condition', 'trueTarget', 'falseTarget'],
    refiner:   ['maxIterations', 'checkPrompt', 'condition', 'refinePrompt'],
    output:    ['message'],
  };

  function esc(s)    { return typeof escapeHtml  !== 'undefined' ? escapeHtml(s)  : String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function attr(s)   { return typeof escapeAttr  !== 'undefined' ? escapeAttr(s)  : String(s ?? '').replace(/"/g, '&quot;'); }
  function input(id, value, placeholder) {
    return `<input class="wf-prop-input" id="wfp-${id}"
              value="${attr(value ?? '')}"
              placeholder="${attr(placeholder ?? '')}"
              oninput="WFCanvas.applyNodeProps()">`;
  }
  function textarea(id, value, rows, placeholder) {
    return `<textarea class="wf-prop-textarea" id="wfp-${id}" rows="${rows ?? 4}"
               placeholder="${attr(placeholder ?? '')}"
               oninput="WFCanvas.applyNodeProps()">${esc(value ?? '')}</textarea>`;
  }
  function row(label, field) {
    return `<div class="wf-prop-group"><label class="wf-prop-label">${label}</label>${field}</div>`;
  }

  // ── Type-specific form sections ────────────────────────────────────────────

  function fieldsFor(node) {
    const c = node.config || {};
    switch (node.type) {
      case 'input':
        return row('Default value', input('default', c.default, 'Optional starting value'));

      case 'agent':
        return [
          row('Prompt', textarea('prompt', c.prompt, 6, 'Claude prompt — use {{nodeId.output}} for context')),
          row('Project path', input('projectPath', c.projectPath, '~/projects/my-app')),
        ].join('');

      case 'skill':
        return [
          row('Skill name', input('skillName', c.skillName, 'my-skill (without .md)')),
          row('Arguments', input('args', c.args, '$ARGUMENTS replacement value')),
          row('Project path', input('projectPath', c.projectPath, '~/projects/my-app')),
        ].join('');

      case 'condition':
        return [
          row('Condition expression', input('condition', c.condition, "{{node.output}} contains 'LGTM'")),
          row('True → node ID', input('trueTarget', c.trueTarget, 'done')),
          row('False → node ID', input('falseTarget', c.falseTarget, 'plan')),
        ].join('');

      case 'refiner':
        return [
          row('Max iterations', `<input class="wf-prop-input" id="wfp-maxIterations" type="number" min="1" max="20" value="${attr(String(c.maxIterations ?? 3))}" oninput="WFCanvas.applyNodeProps()">`),
          row('Check prompt', textarea('checkPrompt', c.checkPrompt, 4, "Review and say 'LGTM' if good, else give improvements:\n{{prev.output}}")),
          row('Pass condition', input('condition', c.condition, "{{refiner.lastReview}} contains 'LGTM'")),
          row('Refine prompt', textarea('refinePrompt', c.refinePrompt, 4, "Apply these improvements:\n{{refiner.lastReview}}\n\nTo:\n{{prev.output}}")),
        ].join('');

      case 'output':
        return row('Message template', textarea('message', c.message, 4, 'Done! Result:\n{{lastNode.output}}'));

      default:
        return '';
    }
  }

  // ── Edge list for selected node ────────────────────────────────────────────

  function edgeList(node, def) {
    const incoming = (def.edges || []).filter(e => e.to   === node.id);
    const outgoing = (def.edges || []).filter(e => e.from === node.id);
    if (!incoming.length && !outgoing.length) return '';
    const rows = [
      ...incoming.map(e => `<div class="wf-edge-row"><span class="wf-edge-dir">← from</span> <span class="wf-edge-id">${esc(e.from)}</span></div>`),
      ...outgoing.map(e => `<div class="wf-edge-row"><span class="wf-edge-dir">→ to</span> <span class="wf-edge-id">${esc(e.to)}</span></div>`),
    ].join('');
    return `<div class="wf-prop-section-title">Connections <span style="font-size:10px;color:var(--text-muted)">(right-click edge to delete)</span></div>${rows}`;
  }

  // ── Public: render(node, def) → HTML string ────────────────────────────────

  function render(node, def) {
    const typeColors = {
      input: '#3b7dd8', agent: '#7c5cbf', skill: '#2a9d8f',
      condition: '#c8933a', refiner: '#c0604a', output: '#457b9d',
    };
    const color = typeColors[node.type] || '#555';
    return `
      <div class="wf-props-header">
        <span class="wf-props-type" style="background:${color}">${esc(node.type)}</span>
        <button class="btn-ghost wf-delete-btn" onclick="WFCanvas.deleteSelected()" title="Delete node (Del)">✕</button>
      </div>
      <div class="wf-props-body">
        <div class="wf-prop-group">
          <label class="wf-prop-label">ID <span style="font-size:10px;opacity:0.5">(read-only)</span></label>
          <input class="wf-prop-input" id="wfp-id" value="${attr(node.id)}" readonly style="opacity:0.5;cursor:default">
        </div>
        <div class="wf-prop-group">
          <label class="wf-prop-label">Label</label>
          ${input('label', node.label, node.type + ' node')}
        </div>
        ${fieldsFor(node)}
        ${def ? edgeList(node, def) : ''}
      </div>
    `;
  }

  // ── Public: apply(node) — reads form back into node ───────────────────────

  function apply(node) {
    const lbl = document.getElementById('wfp-label');
    if (lbl) node.label = lbl.value;

    const fields = CONFIG_FIELDS[node.type] || [];
    if (!node.config) node.config = {};
    for (const field of fields) {
      const el = document.getElementById('wfp-' + field);
      if (!el) continue;
      const v = el.type === 'number' ? (parseInt(el.value, 10) || 1) : el.value;
      if (v !== '' && v !== null) node.config[field] = v;
    }
  }

  return { render, apply };

})();
