import {
  schemaFor, displayTagFor, attributesOf, attrInfoOf, defaultOf,
} from '../rules/index.js';
import { getWidget } from '../widgets/index.js';

// Per-element attribute editor. Renders one row per attribute the
// schema declares for the current selection, with a widget chosen by
// VALUE_TYPE. Editing a row writes through Document.setAttribute, the
// browser re-parses the attribute and re-renders, and the panel reacts
// to the resulting change event.
//
// The lead chapter is attindex.html (Attribute Index) — that is the
// spec's master list of every attribute, its value type, default, and
// whether it is animatable. types.html §4 supplies the value-type
// definitions the widget factories edit. Note that several SVG
// "attributes" are also CSS presentation properties (styling.html §6.4
// covers the dual-surface design); the panel only edits the attribute
// surface, but the browser will read whichever wins per the cascade.
export class AttrPanel {
  // Captures the host (where rows go) and the Document, then subscribes
  // to selection changes (for when the user picks a different element)
  // and to attribute changes that target the current selection (so an
  // external mutation, like a drag in the overlay, refreshes the
  // displayed values).
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

  // Coalesces multiple events into one render per microtask. Same
  // motivation as in tree-panel.js: a single drag may rewrite several
  // attributes in quick succession, and the browser already batches
  // mutation observer notifications within a microtask.
  _schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => { this.scheduled = false; this._render(); });
  }

  // Walks the schema row for the selected element (attindex.html
  // expanded via attributesOf, so attribute groups like %coreAttrs and
  // %presentationAttrs are flattened in declaration order), then
  // instantiates the right widget for each entry. The widget is given
  // the live value from `getAttribute` and a callback that writes the
  // new string back through the Document — the browser then parses,
  // re-resolves geometry/paint per the relevant chapter and repaints.
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

    // Extra row for elements whose schema marks them as text-bearing
    // (`<text>`, `<title>`, `<desc>`, `<script>`). The browser stores
    // the text as child Text nodes; layout for `<text>` follows
    // text.html §10, while `<title>` and `<desc>` are non-rendered
    // metadata per struct.html §5.4 / §5.5. We surface a single
    // textarea bound to `el.textContent`.
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

  // Detaches both subscriptions when the panel is replaced (e.g. on
  // file load) so it does not keep reacting to events on a document
  // that is no longer mounted.
  dispose() {
    this.doc.removeEventListener('selectionchange', this._onSelectionChange);
    this.doc.removeEventListener('change', this._onChange);
  }
}
