import { isSvgElement, schemaFor, displayTagFor } from '../rules/index.js';

// Read-only mirror of the SVG document tree, rendered as a nested HTML
// list in the side panel. Each row shows the canonical element tag name
// (case preserved per eltindex.html — "feGaussianBlur", not
// "fegaussianblur") plus a short per-element summary. Clicking a row
// selects the corresponding SVG element via the Document.
//
// The tree mirrors the structural model defined in struct.html chapter
// 5: every SVG element parents a sub-tree of children that the browser
// already exposes as a live DOM tree. We do not maintain our own
// graph; we simply walk `el.children` whenever the document changes.

// One-line summary of an element's most distinctive attribute. Picks
// per-category fields:
//   - shapes (rect / circle / ellipse / polyline) get geometry hints
//     from the value-bearing attribute the spec gives that shape — see
//     shapes.html §9 for the per-shape attribute lists;
//   - gradients get their stop count from pservers.html §13 (a
//     gradient's children are <stop> elements);
//   - text-bearing elements show their literal text content.
// The browser already exposes all this via the live attributes — we are
// only choosing which one to surface.
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
  // Captures the host (where the list goes) and the Document, hooks up
  // the change subscription, and binds a single click handler that
  // walks up to the nearest row label. The click delegates to
  // `doc.selection`, which fires `selectionchange` for every panel
  // that cares — including this one, which then re-renders to flip
  // the highlight.
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

  // Coalesces multiple change/selection events into one render per
  // microtask. The browser's MutationObserver already batches DOM
  // mutations within a microtask; this just makes sure that when
  // several attributes change in quick succession (for example during
  // a drag) we still only repaint the tree once per frame.
  _schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => { this.scheduled = false; this._render(); });
  }

  // Walks the live SVG DOM under the document root and emits a
  // matching nested `<ul>`. Each row gets a short numeric id stored on
  // the label via `data-mid`; the click handler maps that back to the
  // element in `this.idMap`. We rely entirely on the browser's
  // `el.children` and `el.localName` — the structural relationships
  // defined in struct.html §5 are already materialised in the DOM.
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

  // Detaches the document subscriptions so a disposed tree does not
  // keep re-rendering after the document is replaced.
  dispose() {
    this.doc.removeEventListener('change', this._onChange);
    this.doc.removeEventListener('selectionchange', this._onSelectionChange);
  }
}
