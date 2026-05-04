import { SVG_NS, namespaceOf } from '../rules/index.js';

// Thin wrapper around a real SVGSVGElement. The browser already provides
// the SVG DOM described in svgdom.html (chapter B "Document Object
// Model") — every element, every attribute, every paint server is
// reachable as a regular DOM node. This class adds three things that
// the bare SVG DOM does not:
//
//   1. A typed selection that view modules can subscribe to.
//   2. A dirty flag for save/export state.
//   3. A normalised `change` event so panels do not each have to attach
//      their own MutationObserver.
//
// We also funnel attribute writes through here so we can pick the right
// namespace (xml:, xlink:, none) per the rules in struct.html §5.10 and
// linking.html §17 — the browser will store either side correctly, but
// `setAttribute` and `setAttributeNS` produce subtly different DOM
// nodes, and consumers downstream (XMLSerializer, querySelector) care.
export class Document extends EventTarget {
  // Constructs a Document over an existing SVG root element. The browser
  // has already parsed the root according to struct.html §5.1.1 and
  // hooked it into the live DOM; we attach a MutationObserver so any
  // subsequent change — ours or otherwise — produces a single, batched
  // `change` notification that view code can react to.
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

  // Reading the current selection is a plain getter; setting it fires a
  // `selectionchange` CustomEvent so the overlay, tree and attribute
  // panels can refresh in lockstep. The browser does not maintain an
  // SVG-level selection itself — there is no SVG analogue of HTML's
  // text caret — so this is editor-internal state.
  get selection() { return this._selection; }
  set selection(el) {
    if (el === this._selection) return;
    this._selection = el;
    this.dispatchEvent(new CustomEvent('selectionchange', { detail: el }));
  }

  // Tracks whether the document has unsaved changes. Set automatically
  // by the mutation observer below; cleared by file-io after a
  // successful export.
  get dirty() { return this._dirty; }
  markClean() { this._dirty = false; }

  // Namespace-aware setter. Empty strings clear the attribute so the
  // browser falls back to the spec default — most attributes default to
  // an unset state per attindex.html, and a removed attribute is the
  // same as never having had one. xml:lang / xml:space go through
  // setAttributeNS(XML_NS, ...) and xlink:href through
  // setAttributeNS(XLINK_NS, ...) so XMLSerializer later emits the
  // right prefix.
  setAttribute(el, name, value) {
    if (value == null || value === '') { this.removeAttribute(el, name); return; }
    const ns = namespaceOf(name);
    if (ns) el.setAttributeNS(ns, name, String(value));
    else el.setAttribute(name, String(value));
  }

  // Namespace-aware remover. Same NS logic as the setter — without it
  // an `xlink:href` removed via plain `removeAttribute` would leave the
  // namespaced attribute in place and confuse later serialisation.
  removeAttribute(el, name) {
    const ns = namespaceOf(name);
    if (ns) el.removeAttributeNS(ns, name);
    else el.removeAttribute(name);
  }

  // Edits the textual content of an element — used for `<text>`,
  // `<title>`, `<desc>` and `<script>`. The browser normalises
  // child text nodes when `textContent` is assigned per the DOM spec;
  // visually the text is laid out per text.html §10.
  setText(el, text) { el.textContent = text ?? ''; }

  // Constructs a new SVG element in the SVG namespace and pre-sets any
  // initial attributes through this same wrapper, so the namespace
  // logic above applies. The browser will recognise the namespaced
  // node as an SVG element only because we used `createElementNS` with
  // SVG_NS — `createElement` (no NS) would produce an HTMLUnknownElement
  // that does not render.
  createElement(localName, attrs = {}) {
    const el = window.document.createElementNS(SVG_NS, localName);
    for (const [k, v] of Object.entries(attrs)) this.setAttribute(el, k, v);
    return el;
  }

  // Tree mutators delegated straight to the DOM. The browser handles
  // the actual insertion / removal — including reparenting concerns and
  // mutation-observer notifications — so there is nothing for us to do
  // beyond invoking the standard methods.
  appendChild(parent, child) { parent.appendChild(child); return child; }
  remove(el) { el.remove(); }

  // Re-broadcasts MutationObserver records as a single `change` event.
  // The browser already coalesces mutations within a microtask and
  // delivers them as a batch; we just forward the batch and flip the
  // dirty flag in one place.
  _onMutations(muts) {
    this._dirty = true;
    this.dispatchEvent(new CustomEvent('change', { detail: muts }));
  }

  // Detaches the observer when the document is replaced (e.g. file
  // load) so it does not keep firing against a now-unmounted root.
  dispose() { this._observer.disconnect(); }
}
