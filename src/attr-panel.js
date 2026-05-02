
import { classOf } from './registry.js';

export class AttrPanel {
  constructor(host) {
    this.host = host;
    this.model = null;
    this.scheduled = false;
    this.observer = null;
    this.render();
  }

  setModel(model) {
    if (this.observer) this.observer.disconnect();
    this.model = model;
    if (model) {
      this.observer = new MutationObserver(() => {
        this.schedule();
      });
      this.observer.observe(model, { attributes: true, characterData: true, childList: true, subtree: true });
    }
    this.render();
  }

  schedule() {
    this.render();
  }

  render() {
    const m = this.model;
    if (!m) {
      this.host.innerHTML = '<h3>Attributes</h3><div class="empty">Nothing selected</div>';
      return;
    }
    const cls = classOf(m);
    this.host.innerHTML = '';
    const h = document.createElement('h3');
    h.textContent = `<${cls.svgTag}>`;
    this.host.appendChild(h);

    for (const [name, def] of Object.entries(cls.attrs)) {
      const row = document.createElement('div');
      row.className = 'row';
      const lbl = document.createElement('label');
      lbl.textContent = name;
      const input = document.createElement('input');
      input.type = 'text';
      input.value = m.getAttribute(name) ?? '';
      input.placeholder = def === '' ? '' : String(def);
      input.addEventListener('keydown', (e) => {
        e.stopPropagation(); // hard-block global selection/key handlers while editing
      });
      input.addEventListener('input', () => {
        if (input.value === '') m.removeAttribute(name);
        else m.setAttribute(name, input.value);
      });
      row.appendChild(lbl);
      row.appendChild(input);
      this.host.appendChild(row);
    }

    if (cls.hasText) {
      const row = document.createElement('div');
      row.className = 'row';
      const lbl = document.createElement('label');
      lbl.textContent = 'text';
      const ta = document.createElement('textarea');
      ta.value = m.textContent || '';
      ta.addEventListener('keydown', (e) => {
        e.stopPropagation(); // hard-block global selection/key handlers while editing
      });
      ta.addEventListener('input', () => {
        m.textContent = ta.value;
      });
      row.appendChild(lbl);
      row.appendChild(ta);
      this.host.appendChild(row);
    }
  }
}
