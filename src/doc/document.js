import { SVG_NS, namespaceOf } from '../rules/index.js';

// Thin wrapper around a real SVGSVGElement. Owns selection, dirty flag and a
// MutationObserver that re-broadcasts as a `change` CustomEvent. All editor
// mutations should go through setAttribute/removeAttribute/createElement etc.
// so consumers can subscribe in one place.
export class Document extends EventTarget {
  constructor(svgRoot) {
    super();
    this.root = svgRoot;
    this._selection = svgRoot;
    this._dirty = false;
    this._observer = new MutationObserver((muts) => this._onMutations(muts));
    this._observer.observe(svgRoot, {
      childList: true, attributes: true, subtree: true, characterData: true,
    });
  }

  get selection() { return this._selection; }
  set selection(el) {
    if (el === this._selection) return;
    this._selection = el;
    this.dispatchEvent(new CustomEvent('selectionchange', { detail: el }));
  }

  get dirty() { return this._dirty; }
  markClean() { this._dirty = false; }

  setAttribute(el, name, value) {
    if (value == null || value === '') { this.removeAttribute(el, name); return; }
    const ns = namespaceOf(name);
    if (ns) el.setAttributeNS(ns, name, String(value));
    else el.setAttribute(name, String(value));
  }

  removeAttribute(el, name) {
    const ns = namespaceOf(name);
    if (ns) el.removeAttributeNS(ns, name);
    else el.removeAttribute(name);
  }

  setText(el, text) { el.textContent = text ?? ''; }

  createElement(localName, attrs = {}) {
    const el = window.document.createElementNS(SVG_NS, localName);
    for (const [k, v] of Object.entries(attrs)) this.setAttribute(el, k, v);
    return el;
  }

  appendChild(parent, child) { parent.appendChild(child); return child; }
  remove(el) { el.remove(); }

  _onMutations(muts) {
    this._dirty = true;
    this.dispatchEvent(new CustomEvent('change', { detail: muts }));
  }

  dispose() { this._observer.disconnect(); }
}
