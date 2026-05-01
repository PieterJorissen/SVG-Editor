import { SVG_NS, classOf, isModelElement } from './registry.js';

export class Renderer {
  constructor(modelRoot, host) {
    this.modelRoot = modelRoot;
    this.host = host;
    this.modelToSvg = new WeakMap();
    this.svgRoot = null;
    this.build();

    this.observer = new MutationObserver((muts) => this.onMutations(muts));
    this.observer.observe(modelRoot, {
      childList: true,
      attributes: true,
      subtree: true,
      characterData: true,
    });
  }

  build() {
    this.svgRoot = this.createSvgFor(this.modelRoot);
    this.host.replaceChildren(this.svgRoot);
    this.syncHostSize();
  }

  syncHostSize() {
    const w = this.modelRoot.getAttribute('width') || 800;
    const h = this.modelRoot.getAttribute('height') || 600;
    this.host.style.width = w + 'px';
    this.host.style.height = h + 'px';
  }

  createSvgFor(modelEl) {
    const cls = classOf(modelEl);
    const svgEl = document.createElementNS(SVG_NS, cls.svgTag);
    this.modelToSvg.set(modelEl, svgEl);
    svgEl.__model = modelEl;

    for (const name of modelEl.getAttributeNames()) {
      const v = modelEl.getAttribute(name);
      if (v != null && v !== '') svgEl.setAttribute(name, v);
    }
    for (const [name, def] of Object.entries(cls.attrs)) {
      if (!modelEl.hasAttribute(name) && def !== '' && def != null) {
        svgEl.setAttribute(name, String(def));
      }
    }

    if (cls.hasText) {
      svgEl.textContent = modelEl.textContent || '';
    } else {
      for (const child of modelEl.children) {
        if (isModelElement(child)) {
          svgEl.appendChild(this.createSvgFor(child));
        }
      }
    }

    return svgEl;
  }

  onMutations(muts) {
    let needsResize = false;
    for (const mut of muts) {
      if (mut.type === 'attributes') {
        const target = mut.target;
        if (!isModelElement(target)) continue;
        const svgEl = this.modelToSvg.get(target);
        if (!svgEl) continue;
        const v = target.getAttribute(mut.attributeName);
        if (v == null || v === '') svgEl.removeAttribute(mut.attributeName);
        else svgEl.setAttribute(mut.attributeName, v);
        if (target === this.modelRoot && (mut.attributeName === 'width' || mut.attributeName === 'height')) {
          needsResize = true;
        }
      } else if (mut.type === 'childList') {
        const parent = mut.target;
        if (!isModelElement(parent)) continue;
        const parentSvg = this.modelToSvg.get(parent);
        if (!parentSvg) continue;

        if (classOf(parent).hasText) {
          parentSvg.textContent = parent.textContent || '';
          continue;
        }

        for (const removed of mut.removedNodes) {
          if (!isModelElement(removed)) continue;
          const svgEl = this.modelToSvg.get(removed);
          if (svgEl && svgEl.parentNode) svgEl.parentNode.removeChild(svgEl);
        }
        for (const added of mut.addedNodes) {
          if (!isModelElement(added)) continue;
          const newSvg = this.createSvgFor(added);
          const next = added.nextElementSibling;
          const nextSvg = next && isModelElement(next) ? this.modelToSvg.get(next) : null;
          if (nextSvg && nextSvg.parentNode === parentSvg) parentSvg.insertBefore(newSvg, nextSvg);
          else parentSvg.appendChild(newSvg);
        }
      } else if (mut.type === 'characterData') {
        let p = mut.target.parentNode;
        while (p && !this.modelToSvg.has(p)) p = p.parentNode;
        if (p && classOf(p)?.hasText) {
          this.modelToSvg.get(p).textContent = p.textContent || '';
        }
      }
    }
    if (needsResize) this.syncHostSize();
  }

  svgFor(modelEl) {
    return this.modelToSvg.get(modelEl);
  }

  dispose() {
    this.observer.disconnect();
  }
}
