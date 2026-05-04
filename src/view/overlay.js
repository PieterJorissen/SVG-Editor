// Selection and drag overlay. Captures pointer events on a transparent
// HTML layer above the SVG, hit-tests against the SVG underneath, and
// during a drag rewrites coordinate attributes through the document
// so the browser re-renders the shape on every frame.
//
// Inputs:  pointer events; rules/queries.js for schema and axis;
//          rules/grammars.js for translate hooks
// Outputs: doc.selection updates, doc.setAttribute writes, outline
//          rectangle positioning
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
  // Captures references to the host (event surface), the outline
  // element (the dashed rectangle around the selected element), and
  // the document, then subscribes to pointer events so the browser
  // delivers them through the standard DOM event loop described in
  // interact.html §16 "User Interaction". coords.html §7 is the
  // partner chapter: the screen-pixel deltas a pointer reports must
  // be converted to user-space deltas using the SVG's current
  // viewport-to-user transform, and that conversion lives in
  // `_clientDeltaToSvg` below. The document's `selectionchange` and
  // `change` events trigger outline refreshes when geometry shifts.
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

  // Symmetric teardown of every listener the constructor attaches.
  // Called from `bootstrap` in src/main.js when the document is
  // replaced (e.g. after a file load) so a disposed overlay does not
  // keep refs to its host or leak pointer captures.
  dispose() {
    this.host.removeEventListener('pointerdown', this._onDown);
    this.host.removeEventListener('pointermove', this._onMove);
    this.host.removeEventListener('pointerup', this._onUp);
    this.host.removeEventListener('pointercancel', this._onUp);
    window.removeEventListener('resize', this._refresh);
    this.doc.removeEventListener('selectionchange', this._onSelectionChange);
    this.doc.removeEventListener('change', this._onDocChange);
  }

  // Resolves the SVG element under a screen point. The overlay sits
  // on top of the SVG, so for a moment we disable its pointer-events
  // and ask the browser for the topmost element via
  // `document.elementFromPoint`. The browser implements hit testing
  // per interact.html §16.4, including the `pointer-events` and
  // `visibility` rules that decide whether a shape responds at all.
  // Anything that isn't an SVG element (HTML chrome, the overlay
  // itself, transparent regions) returns null and the caller falls
  // back to selecting the document root.
  hitTest(clientX, clientY) {
    const prev = this.host.style.pointerEvents;
    this.host.style.pointerEvents = 'none';
    const target = window.document.elementFromPoint(clientX, clientY);
    this.host.style.pointerEvents = prev;
    if (!isSvgElement(target)) return null;
    return target;
  }

  // Decides which attributes a drag should rewrite for a given
  // element. Walks the schema's attribute list and asks each
  // grammar whether it has a translate hook; for axis-aware grammars
  // it picks `x` or `y` based on the spec's naming convention encoded
  // in rules/queries.js (`x`, `cx`, `dx`, `fx`, `refX` → x-axis;
  // y-counterparts → y-axis). If the element has no translatable
  // coordinate attributes but does carry `transform`, the plan falls
  // back to prepending a `translate(dx dy)` per coords.html §7.6 — so
  // a `<g>` whose only positioning is a transform list still drags.
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

  // Pointer-down: hit-test, set the document selection, and — if the
  // hit is a drag-eligible element — capture the pointer so subsequent
  // moves arrive on this host even when the cursor leaves the SVG
  // (interact.html §16.6 covers pointer capture). The original
  // attribute values are snapshotted into `origValues` so each
  // subsequent move recomputes from the start position rather than
  // accumulating drift across moves.
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

  // Pointer-move: convert the screen delta into a user-space delta,
  // then for each attribute in the drag plan parse the original,
  // translate by the delta through the grammar from
  // rules/grammars.js, serialise back, and write through the document.
  // The browser repaints because `setAttribute` mutated the live SVG
  // DOM — there is no separate render call. Geometry chapters
  // (shapes.html, paths.html, text.html) handle the re-resolution.
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

  // Pointer-up or cancel: release pointer capture and clear the drag
  // state. The browser dispatches `pointercancel` whenever it
  // forcibly takes the pointer away (e.g. tab loses focus); both
  // events end the drag identically per the lifecycle in
  // interact.html §16.5.
  _onPointerUp(_e) {
    if (!this.drag) return;
    try { this.host.releasePointerCapture(this.drag.pointerId); } catch {}
    this.drag = null;
  }

  // Converts a client-pixel delta into a user-space delta on the root
  // SVG. If the SVG has a `viewBox`, the conversion uses the ratio
  // viewBox-extent over rendered-extent on each axis — exactly the
  // inverse of the viewport-to-user mapping the browser computes per
  // coords.html §7.10 ("preserveAspectRatio" + "viewBox"). Without a
  // `viewBox` the SVG renders at one user unit per CSS pixel, so the
  // delta passes through unchanged. The numerical guards on width and
  // height keep a degenerate viewBox from producing NaN coordinates.
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

  // Repositions the dashed outline so it tracks the selection's
  // bounding box. `getBoundingClientRect` returns post-CTM,
  // post-viewBox screen coordinates — the browser composes the full
  // ancestor transform stack (coords.html §7.6) and the viewport
  // mapping (coords.html §7.10) before returning the rect — so the
  // outline ends up pixel-accurate in screen space without any
  // matrix math here. Selecting the root, an element with no
  // bounding box, or a zero-sized element hides the outline.
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
