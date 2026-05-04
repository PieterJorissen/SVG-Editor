import {
  schemaFor, displayTagFor, attributesOf, attrInfoOf, defaultOf,
} from '../rules/index.js';
import { getWidget } from '../widgets/index.js';

export class AttrPanel {
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

  _schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => { this.scheduled = false; this._render(); });
  }

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

  dispose() {
    this.doc.removeEventListener('selectionchange', this._onSelectionChange);
    this.doc.removeEventListener('change', this._onChange);
  }
}
