import {
  schemaOf, displayTagOf, attributesOf, attrTypeOf, attrInfoOf, defaultOf,
} from './registry.js';

export class AttrPanel {
  constructor(host) {
    this.host = host;
    this.model = null;
    this.scheduled = false;
    this.observer = null;
    this.render();
  }

  setModel(modelElement) {
    if (this.observer) this.observer.disconnect();
    this.model = modelElement;
    if (modelElement) {
      this.observer = new MutationObserver(() => this.schedule());
      this.observer.observe(modelElement, {
        attributes: true,
        characterData: true,
        childList: true,
        subtree: true,
      });
    }
    this.render();
  }

  schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => { this.scheduled = false; this.render(); });
  }

  render() {
    const modelElement = this.model;
    if (!modelElement) {
      this.host.innerHTML = '<h3>Attributes</h3><div class="empty">Nothing selected</div>';
      return;
    }
    this.host.innerHTML = '';
    const heading = document.createElement('h3');
    heading.textContent = `<${displayTagOf(modelElement)}>`;
    this.host.appendChild(heading);

    for (const name of attributesOf(modelElement)) {
      const row = document.createElement('div');
      row.className = 'row';
      const label = document.createElement('label');
      label.textContent = name;
      label.title = `${name} : ${attrInfoOf(name).type}`;
      row.appendChild(label);

      const type = attrTypeOf(name);
      const currentValue = modelElement.getAttribute(name) ?? '';
      const widget = type.widget(currentValue, (newValue) => {
        if (newValue === '' || newValue == null) modelElement.removeAttribute(name);
        else modelElement.setAttribute(name, String(newValue));
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

    if (schemaOf(modelElement)?.contentText) {
      const row = document.createElement('div');
      row.className = 'row';
      const label = document.createElement('label');
      label.textContent = 'text';
      const ta = document.createElement('textarea');
      ta.value = modelElement.textContent || '';
      ta.addEventListener('keydown', (e) => e.stopPropagation(), true);
      ta.addEventListener('change', () => { modelElement.textContent = ta.value; });
      row.appendChild(label);
      row.appendChild(ta);
      this.host.appendChild(row);
    }
  }
}
