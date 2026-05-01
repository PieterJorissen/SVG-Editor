import { classOf, isModelElement } from './registry.js';

export class TreePanel {
  constructor(host, modelRoot, onSelect) {
    this.host = host;
    this.modelRoot = modelRoot;
    this.onSelect = onSelect;
    this.selected = null;
    this.idMap = new Map();
    this.scheduled = false;

    this.observer = new MutationObserver(() => this.schedule());
    this.observer.observe(modelRoot, {
      childList: true,
      attributes: true,
      subtree: true,
      characterData: true,
    });

    host.addEventListener('click', (e) => {
      const el = e.target.closest('[data-mid]');
      if (!el) return;
      const m = this.idMap.get(el.dataset.mid);
      if (m && this.onSelect) this.onSelect(m);
    });

    this.render();
  }

  schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      this.render();
    });
  }

  render() {
    this.idMap = new Map();
    let n = 0;
    const buildLi = (model) => {
      const id = String(n++);
      this.idMap.set(id, model);
      const cls = classOf(model);
      const li = document.createElement('li');
      const label = document.createElement('span');
      label.className = 'tree-label';
      label.dataset.mid = id;
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = '<' + cls.svgTag + '>';
      label.appendChild(tag);

      const meta = this.metaFor(model);
      if (meta) {
        const m = document.createElement('span');
        m.className = 'meta';
        m.textContent = meta;
        label.appendChild(m);
      }
      if (model === this.selected) label.classList.add('sel');
      li.appendChild(label);

      const kids = Array.from(model.children).filter(isModelElement);
      if (kids.length) {
        const ul = document.createElement('ul');
        for (const k of kids) ul.appendChild(buildLi(k));
        li.appendChild(ul);
      }
      return li;
    };
    const ul = document.createElement('ul');
    ul.appendChild(buildLi(this.modelRoot));
    this.host.replaceChildren(ul);
  }

  metaFor(model) {
    const cls = classOf(model);
    switch (cls.svgTag) {
      case 'rect': return `${model.getAttribute('width') ?? ''}×${model.getAttribute('height') ?? ''}`;
      case 'circle': return `r=${model.getAttribute('r') ?? ''}`;
      case 'ellipse': return `${model.getAttribute('rx') ?? ''}×${model.getAttribute('ry') ?? ''}`;
      case 'text': return JSON.stringify((model.textContent || '').slice(0, 16));
      default: return '';
    }
  }

  setSelected(model) {
    this.selected = model;
    this.render();
  }

  dispose() {
    this.observer.disconnect();
  }
}
