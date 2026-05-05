// tree-panel.js renders a read-only mirror of the SVG document tree
// in the side panel and lets the user click a row to select that
// element. The tree mirrors the structural model from struct.html
// chapter 5; we walk the live `el.children` rather than maintaining
// our own graph.
//
// Inputs:  the Document (selection + change); rules/queries.js for
//          element-name casing and per-element category
// Outputs: a nested HTML <ul> with one row per SVG element
// Common bugs:
//   - tag shown in wrong case (eltindex.html canonical name lookup)
//   - tree doesn't refresh after a delete (change subscription)
//   - clicking a row doesn't select (data-mid mapping in `_render`)
//
// prev: src/view/attr-panel.js  ·  next: src/doc/document.js

import { isSvgElement, schemaFor, displayTagFor } from '../rules/index.js';

// One-line summary appended next to each row so the tree shows more
// than just tag names. The value picked depends on the element's
// schema category:
//   - text-bearing elements show the first 16 characters of their
//     literal text content;
//   - shapes show their primary geometry attribute (width×height for
//     rects, `r=` for circles, `points` count for polylines) per
//     shapes.html §9;
//   - gradients show their `<stop>` count per pservers.html §13.
// All the underlying values are already exposed by the live DOM;
// this function only chooses which one to surface.
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
  // Captures the host (where the list goes) and the Document, hooks
  // up the change subscription, and binds a single click delegate
  // that walks up to the nearest row label and resolves it to an
  // element via `idMap`. Setting `doc.selection` fires
  // `selectionchange`, which `_schedule` uses to re-render with the
  // new highlight.
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
  // microtask. Same motivation as in attr-panel.js: a single drag may
  // rewrite several attributes in quick succession, and the browser
  // already batches mutation observer notifications within a
  // microtask.
  _schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => { this.scheduled = false; this._render(); });
  }

  // Walks the live SVG DOM under the document root and emits a
  // matching nested `<ul>`. Each row gets a numeric id stored on its
  // label via `data-mid`; the click handler maps that id back through
  // `this.idMap` to the actual SVG element. We rely entirely on the
  // browser's `el.children` and `el.localName` — the structural
  // relationships defined in struct.html §5 are already materialised
  // in the DOM, so the tree never holds state beyond the id map.
  // `displayTagFor` from rules/queries.js gives the canonical
  // case-preserved name (`feGaussianBlur`, not `fegaussianblur`).
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
