import { isSvgElement, schemaFor, displayTagFor } from '../rules/index.js';

function meta(el) {
  const schema = schemaFor(el.localName);
  if (!schema) return '';
  const cats = schema.categories;
  if (schema.contentText) {
    const txt = (el.textContent || '').trim();
    if (txt) return JSON.stringify(txt.slice(0, 16));
  }
  if (cats.includes('Shape')) {
    const w = el.getAttribute('width');
    const h = el.getAttribute('height');
    if (w != null && h != null) return `${w}×${h}`;
    const r = el.getAttribute('r');
    if (r != null) return `r=${r}`;
    const rx = el.getAttribute('rx');
    const ry = el.getAttribute('ry');
    if (rx != null && ry != null) return `${rx}×${ry}`;
    const points = el.getAttribute('points');
    if (points) {
      const nums = points.trim().split(/[\s,]+/).filter(Boolean).length;
      return `${Math.floor(nums / 2)} pts`;
    }
    return '';
  }
  if (cats.includes('Gradient')) {
    let stops = 0;
    for (const c of el.children) if (isSvgElement(c) && c.localName === 'stop') stops++;
    return stops ? `${stops} stops` : '';
  }
  return '';
}

export class TreePanel {
  constructor(host, doc) {
    this.host = host;
    this.doc = doc;
    this.idMap = new Map();
    this.scheduled = false;

    this._onChange = () => this._schedule();
    this._onSelectionChange = () => this._schedule();
    doc.addEventListener('change', this._onChange);
    doc.addEventListener('selectionchange', this._onSelectionChange);

    host.addEventListener('click', (e) => {
      const labelEl = e.target.closest('[data-mid]');
      if (!labelEl) return;
      const el = this.idMap.get(labelEl.dataset.mid);
      if (el) doc.selection = el;
    });

    this._render();
  }

  _schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => { this.scheduled = false; this._render(); });
  }

  _render() {
    this.idMap = new Map();
    let n = 0;
    const buildLi = (el) => {
      const id = String(n++);
      this.idMap.set(id, el);
      const li = window.document.createElement('li');
      const label = window.document.createElement('span');
      label.className = 'tree-label';
      label.dataset.mid = id;
      const tag = window.document.createElement('span');
      tag.className = 'tag';
      tag.textContent = '<' + displayTagFor(el.localName) + '>';
      label.appendChild(tag);

      const metaText = meta(el);
      if (metaText) {
        const metaSpan = window.document.createElement('span');
        metaSpan.className = 'meta';
        metaSpan.textContent = metaText;
        label.appendChild(metaSpan);
      }
      if (el === this.doc.selection) label.classList.add('sel');
      li.appendChild(label);

      const children = Array.from(el.children).filter(isSvgElement);
      if (children.length) {
        const ul = window.document.createElement('ul');
        for (const child of children) ul.appendChild(buildLi(child));
        li.appendChild(ul);
      }
      return li;
    };
    const ul = window.document.createElement('ul');
    ul.appendChild(buildLi(this.doc.root));
    this.host.replaceChildren(ul);
  }

  dispose() {
    this.doc.removeEventListener('change', this._onChange);
    this.doc.removeEventListener('selectionchange', this._onSelectionChange);
  }
}
