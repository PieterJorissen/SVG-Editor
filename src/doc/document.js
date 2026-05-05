// document.js wraps a real SVGSVGElement and adds three things on
// top of the browser's native SVG DOM: a typed selection that view
// modules can subscribe to, a dirty flag for save/export state, and
// a single `change` event that fans out batched MutationObserver
// records.
//
// Inputs:  an SVGSVGElement; per-attribute writes from any view module
// Outputs: live mutations on the SVG DOM; `change` and
//          `selectionchange` events
// Common bugs:
//   - attribute clears unexpectedly (empty-string → removeAttribute)
//   - xlink:href ends up unprefixed (namespace dispatch in setAttribute)
//   - tree panel doesn't repaint (observer disconnected too early)
//
// prev: src/view/tree-panel.js  ·  next: src/doc/edit-session.js

import { SVG_NS, namespaceOf } from '../rules/index.js';

export class Document extends EventTarget {
  // Wraps the SVG root (already parsed by the browser per
  // struct.html §5.1.1) and attaches a MutationObserver so any
  // subsequent change — ours or otherwise — produces a single,
  // batched `change` notification view code can react to. Selection
  // is editor-internal state because the browser does not maintain an
  // SVG-level selection (no SVG analogue of HTML's text caret).
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

  // Reading is a plain getter; setting fires `selectionchange` so the
  // overlay, tree, and attribute panels can refresh in lockstep.
  get selection() { return this._selection; }
  set selection(el) {
    if (el === this._selection) return;
    this._selection = el;
    this.dispatchEvent(new CustomEvent('selectionchange', { detail: el }));
  }

  // Tracks unsaved-changes state. Set automatically by `_onMutations`
  // below; cleared by io/file-io.js after a successful export.
  get dirty() { return this._dirty; }
  markClean() { this._dirty = false; }

  // Namespace-aware setter. An empty value clears the attribute so
  // the browser falls back to the spec default — most attributes
  // default to an unset state per attindex.html, and a removed
  // attribute is the same as never having had one. `xml:lang` /
  // `xml:space` route through XML_NS and `xlink:href` through
  // XLINK_NS so XMLSerializer later emits the right prefix on export.
  // (SVG 2 superseded `xlink:href` with plain `href`; both still work
  // in modern browsers, but the round-trip preserves whichever the
  // input file used.)
  setAttribute(el, name, value) {
    if (value == null || value === '') { this.removeAttribute(el, name); return; }
    const ns = namespaceOf(name);
    if (ns) el.setAttributeNS(ns, name, String(value));
    else el.setAttribute(name, String(value));
  }

  // Namespace-aware remover. Same NS dispatch as `setAttribute` — an
  // `xlink:href` removed via plain `removeAttribute` would leave the
  // namespaced attribute in place and later confuse XMLSerializer.
  removeAttribute(el, name) {
    const ns = namespaceOf(name);
    if (ns) el.removeAttributeNS(ns, name);
    else el.removeAttribute(name);
  }

  // Edits the textual content of an element — `<text>`, `<title>`,
  // `<desc>`, `<script>`. The browser normalises child text nodes
  // when `textContent` is assigned per the DOM spec; visible layout
  // for `<text>` follows text.html §10.
  setText(el, text) { el.textContent = text ?? ''; }

  // Constructs a new SVG element in the SVG namespace and pre-sets
  // any initial attributes through this same wrapper, so the
  // namespace logic above applies. `createElement` (no NS) would
  // produce an HTMLUnknownElement that does not render — only
  // `createElementNS(SVG_NS, ...)` produces a node the browser
  // recognises as SVG.
  createElement(localName, attrs = {}) {
    const el = window.document.createElementNS(SVG_NS, localName);
    for (const [k, v] of Object.entries(attrs)) this.setAttribute(el, k, v);
    return el;
  }

  // Tree mutators delegated straight to the DOM. The browser handles
  // the actual insertion or removal — including reparenting concerns
  // and mutation-observer notifications — so there is nothing for the
  // editor to do beyond invoking the standard methods.
  appendChild(parent, child) { parent.appendChild(child); return child; }
  remove(el) { el.remove(); }

  // Re-broadcasts MutationObserver records as a single `change`
  // event. The browser already coalesces mutations within a
  // microtask and delivers them as a batch; we just forward the
  // batch and flip the dirty flag in one place. Listeners read
  // `e.detail` to scan the records.
  _onMutations(muts) {
    this._dirty = true;
    this.dispatchEvent(new CustomEvent('change', { detail: muts }));
  }

  // Detaches the observer when the document is replaced (e.g. file
  // load) so it does not keep firing against a now-unmounted root.
  dispose() { this._observer.disconnect(); }
}
