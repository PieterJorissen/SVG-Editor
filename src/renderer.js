import { SVG_NS, schemaOf, displayTagOf, isModelElement, namespaceOf } from './registry.js';

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

  setAttr(svgEl, name, value) {
    const ns = namespaceOf(name);
    if (ns) svgEl.setAttributeNS(ns, name, value);
    else svgEl.setAttribute(name, value);
  }

  removeAttr(svgEl, name) {
    const ns = namespaceOf(name);
    if (ns) svgEl.removeAttributeNS(ns, name);
    else svgEl.removeAttribute(name);
  }

  createSvgFor(modelEl) {
    const schema = schemaOf(modelEl);
    if (!schema) return null;
    const svgEl = document.createElementNS(SVG_NS, displayTagOf(modelEl));
    this.modelToSvg.set(modelEl, svgEl);
    svgEl.__model = modelEl;

    for (const name of modelEl.getAttributeNames()) {
      const v = modelEl.getAttribute(name);
      if (v != null && v !== '') this.setAttr(svgEl, name, v);
    }

    if (schema.contentText) {
      svgEl.textContent = modelEl.textContent || '';
    } else {
      for (const child of modelEl.children) {
        if (isModelElement(child)) {
          const childSvg = this.createSvgFor(child);
          if (childSvg) svgEl.appendChild(childSvg);
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
        if (v == null || v === '') this.removeAttr(svgEl, mut.attributeName);
        else this.setAttr(svgEl, mut.attributeName, v);
        if (target === this.modelRoot && (mut.attributeName === 'width' || mut.attributeName === 'height')) {
          needsResize = true;
        }
      } else if (mut.type === 'childList') {
        const parent = mut.target;
        if (!isModelElement(parent)) continue;
        const parentSvg = this.modelToSvg.get(parent);
        if (!parentSvg) continue;

        if (schemaOf(parent)?.contentText) {
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
          if (!newSvg) continue;
          const next = added.nextElementSibling;
          const nextSvg = next && isModelElement(next) ? this.modelToSvg.get(next) : null;
          if (nextSvg && nextSvg.parentNode === parentSvg) parentSvg.insertBefore(newSvg, nextSvg);
          else parentSvg.appendChild(newSvg);
        }
      } else if (mut.type === 'characterData') {
        let p = mut.target.parentNode;
        while (p && !this.modelToSvg.has(p)) p = p.parentNode;
        if (p && schemaOf(p)?.contentText) {
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
