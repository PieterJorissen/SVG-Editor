import { classOf } from './registry.js';

export class AttrPanel {
  constructor(host) {
    this.host = host;
    this.model = null;
    this.scheduled = false;
    this.observer = null;
    this.suppress = false;
    this.render();
  }

  setModel(model) {
    if (this.observer) this.observer.disconnect();
    this.model = model;
    if (model) { 
    this.observer = new MutationObserver(() => {
    if (!this.suppress) this.schedule();
    });

      this.observer.observe(model, { attributes: true, characterData: true, childList: true, subtree: true });
    }
    this.render();
  }

  schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => { this.scheduled = false; this.render(); });
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
      input.addEventListener('input', () => {
        this.suppress = true;
        if (input.value === '') m.removeAttribute(name);
        else m.setAttribute(name, input.value);
        this.suppress = false;
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
      ta.addEventListener('input', () => { m.textContent = ta.value; });
      row.appendChild(lbl);
      row.appendChild(ta);
      this.host.appendChild(row);
    }
  }
}
