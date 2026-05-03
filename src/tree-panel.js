import { schemaOf, displayTagOf, isModelElement } from './registry.js';

// Category-driven label metadata. The set of categories an element belongs to
// is the only structural input — never the tag.
function meta(modelElement) {
  const schema = schemaOf(modelElement);
  if (!schema) return '';
  const cats = schema.categories;
  if (schema.contentText) {
    const txt = (modelElement.textContent || '').trim();
    if (txt) return JSON.stringify(txt.slice(0, 16));
  }
  if (cats.includes('Shape')) {
    const w = modelElement.getAttribute('width');
    const h = modelElement.getAttribute('height');
    if (w != null && h != null) return `${w}×${h}`;
    const r = modelElement.getAttribute('r');
    if (r != null) return `r=${r}`;
    const rx = modelElement.getAttribute('rx');
    const ry = modelElement.getAttribute('ry');
    if (rx != null && ry != null) return `${rx}×${ry}`;
    const points = modelElement.getAttribute('points');
    if (points) return `${points.trim().split(/\s+/).length} pts`;
    return '';
  }
  if (cats.includes('Gradient')) {
    let stops = 0;
    for (const c of modelElement.children) {
      if (isModelElement(c) && schemaOf(c)?.tag === 'stop') stops++;
    }
    return stops ? `${stops} stops` : '';
  }
  return '';
}

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
      const labelEl = e.target.closest('[data-mid]');
      if (!labelEl) return;
      const modelElement = this.idMap.get(labelEl.dataset.mid);
      if (modelElement && this.onSelect) this.onSelect(modelElement);
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
    const buildLi = (modelElement) => {
      const id = String(n++);
      this.idMap.set(id, modelElement);
      const li = document.createElement('li');
      const label = document.createElement('span');
      label.className = 'tree-label';
      label.dataset.mid = id;
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = '<' + displayTagOf(modelElement) + '>';
      label.appendChild(tag);

      const metaText = meta(modelElement);
      if (metaText) {
        const metaSpan = document.createElement('span');
        metaSpan.className = 'meta';
        metaSpan.textContent = metaText;
        label.appendChild(metaSpan);
      }
      if (modelElement === this.selected) label.classList.add('sel');
      li.appendChild(label);

      const children = Array.from(modelElement.children).filter(isModelElement);
      if (children.length) {
        const ul = document.createElement('ul');
        for (const child of children) ul.appendChild(buildLi(child));
        li.appendChild(ul);
      }
      return li;
    };
    const ul = document.createElement('ul');
    ul.appendChild(buildLi(this.modelRoot));
    this.host.replaceChildren(ul);
  }

  setSelected(modelElement) {
    this.selected = modelElement;
    this.render();
  }

  dispose() {
    this.observer.disconnect();
  }
}
