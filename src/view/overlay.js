// Selection and drag overlay. Captures pointer events on a transparent
// layer above the SVG, hit-tests, and rewrites coordinate attributes
// through the document during a drag.
//
// Inputs:  pointer events; rules/queries.js + rules/grammars.js
// Outputs: doc.selection, doc.setAttribute, outline positioning
// Common bugs:
//   - drag does nothing (buildDragPlan returned empty)
//   - drag moves wrong direction (axis classification in queries.js)
//   - outline misaligned (viewBox math in _clientDeltaToSvg)
//
// prev: (set at end of Phase C)  ·  next: (set at end of Phase C)

import {
  isSvgElement, attributesOf, attrTypeOf, isXAxis, isYAxis,
} from '../rules/index.js';

export class Overlay {
  // Ties the overlay to a host (event surface), an outline element, and
  // the document. The document's selection and change events are the
  // overlay's only inward-facing inputs once construction is done.
  constructor(host, outline, doc) {
    this.host = host;
    this.outline = outline;
    this.doc = doc;
    this.drag = null;

    this._onDown = (e) => this._onPointerDown(e);
    this._onMove = (e) => this._onPointerMove(e);
    this._onUp = (e) => this._onPointerUp(e);
    this._refresh = () => this.refreshOutline();
    this._onSelectionChange = () => this.refreshOutline();
    this._onDocChange = () => this.refreshOutline();

    host.addEventListener('pointerdown', this._onDown);
    host.addEventListener('pointermove', this._onMove);
    host.addEventListener('pointerup', this._onUp);
    host.addEventListener('pointercancel', this._onUp);
    window.addEventListener('resize', this._refresh);
    doc.addEventListener('selectionchange', this._onSelectionChange);
    doc.addEventListener('change', this._onDocChange);
  }

  // Symmetric teardown of every listener constructor attaches.
  dispose() {
    this.host.removeEventListener('pointerdown', this._onDown);
    this.host.removeEventListener('pointermove', this._onMove);
    this.host.removeEventListener('pointerup', this._onUp);
    this.host.removeEventListener('pointercancel', this._onUp);
    window.removeEventListener('resize', this._refresh);
    this.doc.removeEventListener('selectionchange', this._onSelectionChange);
    this.doc.removeEventListener('change', this._onDocChange);
  }

  // Briefly disables host pointer-events so elementFromPoint sees the
  // SVG underneath. The browser implements hit testing per
  // interact.html §16.4 — pointer-events and visibility decide whether
  // a shape responds to the pointer.
  hitTest(clientX, clientY) {
    const prev = this.host.style.pointerEvents;
    this.host.style.pointerEvents = 'none';
    const target = window.document.elementFromPoint(clientX, clientY);
    this.host.style.pointerEvents = prev;
    if (!isSvgElement(target)) return null;
    return target;
  }

  // Walks the schema attributes and asks each grammar whether it is
  // translatable. Axis-aware grammars get classified by name into the
  // x/y bucket; elements with no translatable attributes fall back to
  // prepending `translate(dx dy)` onto `transform` (coords.html §7.6).
  buildDragPlan(el) {
    const plan = [];
    let hasTransform = false;
    for (const name of attributesOf(el.localName)) {
      const grammar = attrTypeOf(name);
      if (!grammar.translate) continue;
      if (grammar.axisAware) {
        if (isXAxis(name)) plan.push({ name, axis: 'x' });
        else if (isYAxis(name)) plan.push({ name, axis: 'y' });
      } else if (name === 'transform') {
        hasTransform = true;
      } else {
        plan.push({ name, axis: null });
      }
    }
    if (plan.length === 0 && hasTransform) plan.push({ name: 'transform', axis: null });
    return plan;
  }

  // Pointer-down: hit-test, set selection, capture the pointer so
  // subsequent moves arrive even when the cursor leaves the SVG
  // (interact.html §16.6). The original attribute values are snapshot
  // so each move recomputes from the start, not incrementally.
  _onPointerDown(e) {
    e.preventDefault();
    const target = this.hitTest(e.clientX, e.clientY);
    this.doc.selection = target ?? this.doc.root;

    if (!target || target === this.doc.root) return;

    const plan = this.buildDragPlan(target);
    if (plan.length === 0) return;

    const origValues = new Map();
    for (const step of plan) origValues.set(step.name, target.getAttribute(step.name) ?? '');

    this.drag = {
      target, plan, origValues,
      startX: e.clientX, startY: e.clientY, pointerId: e.pointerId,
    };
    this.host.setPointerCapture(e.pointerId);
  }

  // For each planned attribute: parse the original, translate by the
  // user-space delta, serialise back to a string, write through the
  // document. The browser repaints because setAttribute mutates the
  // live SVG DOM — there is no separate render call.
  _onPointerMove(e) {
    if (!this.drag) return;
    const dxClient = e.clientX - this.drag.startX;
    const dyClient = e.clientY - this.drag.startY;
    const [dx, dy] = this._clientDeltaToSvg(dxClient, dyClient);
    const { target, plan, origValues } = this.drag;

    for (const step of plan) {
      const grammar = attrTypeOf(step.name);
      const orig = origValues.get(step.name);
      const moved = grammar.translate(grammar.parse(orig), dx, dy, step.axis);
      this.doc.setAttribute(target, step.name, grammar.serialise(moved));
    }
    this.refreshOutline();
  }

  // Releases pointer capture and clears the drag state.
  // `pointercancel` is treated identically (interact.html §16.5 covers
  // the lifecycle).
  _onPointerUp(_e) {
    if (!this.drag) return;
    try { this.host.releasePointerCapture(this.drag.pointerId); } catch {}
    this.drag = null;
  }

  // Inverts the viewport-to-user mapping: the screen-pixel delta is
  // scaled by viewBox-extent / rendered-extent on each axis. Without a
  // viewBox the SVG is in 1:1 user-units-to-pixels, and the delta
  // passes through unchanged (coords.html §7.10).
  _clientDeltaToSvg(dxClient, dyClient) {
    const svg = this.doc.root;
    const rect = svg.getBoundingClientRect();
    const vbAttr = svg.getAttribute('viewBox');
    if (vbAttr) {
      const parts = vbAttr.split(/[\s,]+/).map(Number);
      const vbW = parts[2];
      const vbH = parts[3];
      if (rect.width > 0 && rect.height > 0 && Number.isFinite(vbW) && Number.isFinite(vbH)) {
        return [dxClient * (vbW / rect.width), dyClient * (vbH / rect.height)];
      }
    }
    return [dxClient, dyClient];
  }

  // Tracks the dashed outline against the selection's bounding box.
  // `getBoundingClientRect` returns post-CTM, post-viewBox screen
  // coordinates (coords.html §7.6 / §7.10), so the outline is
  // pixel-accurate without us redoing the matrix math.
  refreshOutline() {
    const target = this.doc.selection;
    if (!target || target === this.doc.root || !isSvgElement(target)) {
      this.outline.hidden = true;
      return;
    }
    if (typeof target.getBoundingClientRect !== 'function') {
      this.outline.hidden = true;
      return;
    }
    const bounds = target.getBoundingClientRect();
    if (bounds.width === 0 && bounds.height === 0) {
      this.outline.hidden = true;
      return;
    }
    const hostRect = this.host.getBoundingClientRect();
    this.outline.hidden = false;
    this.outline.style.left = (bounds.left - hostRect.left) + 'px';
    this.outline.style.top = (bounds.top - hostRect.top) + 'px';
    this.outline.style.width = bounds.width + 'px';
    this.outline.style.height = bounds.height + 'px';
  }
}
