// attr-panel.js renders the editable attribute list for the
// currently selected element. One row per attribute the schema
// declares for the element, with a widget chosen by VALUE_TYPE.
//
// Inputs:  the Document (selection + change); rules/queries.js for
//          schema; widgets/index.js for the right control type
// Outputs: rows of label + widget, plus a textarea for text-bearing
//          elements
// Common bugs:
//   - row missing for a known attribute (rules/queries.js schema row)
//   - widget shows the wrong control (widgets/index.js dispatch by type)
//   - panel doesn't refresh after a drag (change-event subscription)
//
// prev: src/view/overlay.js  ·  next: src/view/tree-panel.js

import {
  schemaFor, displayTagFor, attributesOf, attrInfoOf, defaultOf,
} from '../rules/index.js';
import { getWidget } from '../widgets/index.js';

export class AttrPanel {
  // Captures the host (where rows go) and the Document, then
  // subscribes to selection changes (for when the user picks a
  // different element) and to attribute changes that touch the
  // current selection (so an external mutation, like a drag from
  // view/overlay.js, refreshes the displayed values). attindex.html
  // is the master list of attributes and types behind the schema
  // rows; types.html §4 supplies the value-type definitions the
  // widgets edit. Several SVG attributes can also be set as CSS
  // properties (styling.html §6.4 covers the dual surface); the
  // panel only edits the attribute side, but the browser will use
  // whichever value wins once CSS rules and inline styles are
  // resolved.
  constructor(host, doc) {
    this.host = host;
    this.doc = doc;
    this.scheduled = false;

    this._onSelectionChange = () => this._schedule();
    this._onChange = (e) => {
      // Re-render when an attribute on the current selection changes.
      const sel = doc.selection;
      if (!sel) return;
      for (const m of e.detail) {
        if (m.target === sel || m.target.parentNode === sel) { this._schedule(); break; }
      }
    };
    doc.addEventListener('selectionchange', this._onSelectionChange);
    doc.addEventListener('change', this._onChange);
    this._render();
  }

  // Coalesces selection and change events into one render per
  // microtask. The browser's MutationObserver already batches DOM
  // mutations within a microtask; lining up with that batching means
  // a single drag that rewrites several attributes still produces one
  // panel repaint, not several.
  _schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => { this.scheduled = false; this._render(); });
  }

  // REVIEW(annotation): block is 15 lines (vs. 9-line soft guidance);
  // covers two distinct concerns. Split into separate blocks above
  // attribute rows and the text-content row?
  // Walks the schema row for the selected element via `attributesOf`
  // from rules/queries.js — that flattens attribute groups like
  // %coreAttrs and %presentationAttrs into a single ordered list — and
  // instantiates the right widget for each entry through `getWidget`
  // from widgets/index.js. The widget is given the live value from
  // `el.getAttribute` and a callback that writes the new string back
  // through `doc.setAttribute`; the browser then parses, re-resolves
  // geometry or paint per the relevant chapter, and repaints.
  // `defaultOf` from rules/queries.js fills the placeholder so an
  // empty input shows the spec default rather than blank.
  //
  // Elements whose schema marks them as text-bearing get a final
  // textarea bound to `el.textContent`. text.html §10 covers the
  // layout for `<text>`; struct.html §5.4 / §5.5 say that `<title>`
  // and `<desc>` are non-rendered metadata.
  _render() {
    const el = this.doc.selection;
    if (!el) {
      this.host.innerHTML = '<h3>Attributes</h3><div class="empty">Nothing selected</div>';
      return;
    }
    this.host.innerHTML = '';
    const heading = window.document.createElement('h3');
    heading.textContent = `<${displayTagFor(el.localName)}>`;
    this.host.appendChild(heading);

    for (const name of attributesOf(el.localName)) {
      const row = window.document.createElement('div');
      row.className = 'row';
      const label = window.document.createElement('label');
      label.textContent = name;
      const info = attrInfoOf(name);
      label.title = `${name} : ${info.type}`;
      row.appendChild(label);

      const widgetFactory = getWidget(info.type, info);
      const currentValue = el.getAttribute(name) ?? '';
      const widget = widgetFactory(currentValue, (newValue) => {
        this.doc.setAttribute(el, name, newValue);
      });
      widget.addEventListener('keydown', (e) => e.stopPropagation(), true);

      const placeholder = defaultOf(name);
      if (placeholder != null) {
        const inner = widget.matches?.('input,textarea')
          ? widget
          : widget.querySelector?.('input,textarea');
        if (inner && !inner.value) inner.placeholder = String(placeholder);
      }
      row.appendChild(widget);
      this.host.appendChild(row);
    }

    if (schemaFor(el.localName)?.contentText) {
      const row = window.document.createElement('div');
      row.className = 'row';
      const label = window.document.createElement('label');
      label.textContent = 'text';
      const ta = window.document.createElement('textarea');
      ta.value = el.textContent || '';
      ta.addEventListener('keydown', (e) => e.stopPropagation(), true);
      ta.addEventListener('change', () => { this.doc.setText(el, ta.value); });
      row.appendChild(label);
      row.appendChild(ta);
      this.host.appendChild(row);
    }
  }

  // Detaches both subscriptions when the panel is replaced — for
  // example on file load, when `bootstrap` in src/main.js spins up a
  // fresh AttrPanel against a new Document.
  dispose() {
    this.doc.removeEventListener('selectionchange', this._onSelectionChange);
    this.doc.removeEventListener('change', this._onChange);
  }
}
