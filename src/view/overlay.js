import {
  isSvgElement, attributesOf, attrTypeOf, isXAxis, isYAxis,
} from '../rules/index.js';

// Selection + drag overlay. The overlay is a transparent HTML layer on
// top of the rendered SVG; it captures pointer events, decides which
// SVG element was hit, and — while the user drags — rewrites the
// element's coordinate attributes so the browser re-renders it at the
// new position on every frame.
//
// The lead chapter is interact.html (chapter 16 "User Interaction"),
// which defines pointer-event dispatch, the `pointer-events` property
// and how hit testing chooses a target. coords.html §7 is the partner
// chapter: the screen-pixel deltas a pointer reports must be converted
// to user-space deltas using the SVG's current viewport-to-user
// transform, and that conversion (the viewBox mapping) is defined in
// coords.html §7.10.
export class Overlay {
  // Captures references to the host (event surface), the outline box
  // (the dashed rectangle around the selected element) and the
  // Document. Subscribes to pointer events so the browser delivers
  // them through the standard DOM event loop described in
  // interact.html §16.5; the document's `selectionchange` and `change`
  // events trigger outline refreshes when geometry shifts.
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

  // Symmetric teardown — detaches every listener attached above so a
  // disposed overlay neither keeps refs to its host nor leaks event
  // handlers when a new document replaces the current one.
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
  // on top of the SVG so we briefly disable its hit-testing
  // (`pointerEvents = 'none'`) and ask the browser for the topmost
  // element via `document.elementFromPoint`. The browser implements
  // hit testing per interact.html §16.4, including the
  // `pointer-events` and `visibility` rules that decide whether a
  // shape responds to the pointer.
  hitTest(clientX, clientY) {
    const prev = this.host.style.pointerEvents;
    this.host.style.pointerEvents = 'none';
    const target = window.document.elementFromPoint(clientX, clientY);
    this.host.style.pointerEvents = prev;
    if (!isSvgElement(target)) return null;
    return target;
  }

  // Decides which attributes a drag should rewrite for a given
  // element. Walks the element's schema attribute list and asks each
  // grammar (from grammars.js) whether it has a translate hook; for
  // axis-aware grammars it picks `x` or `y` based on the spec's naming
  // convention encoded in queries.js. If the element has no
  // translatable attributes but does carry `transform`, the plan falls
  // back to prepending a `translate(dx dy)` per coords.html §7.6.
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
  // moves fire on the host even if the cursor leaves the SVG. Pointer
  // capture and the implicit-capture rules are described in
  // interact.html §16.6.
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

  // Pointer-move: convert the screen delta to a user-space delta, then
  // for each planned attribute parse → translate → serialise through
  // its grammar and write the new string via Document.setAttribute.
  // The browser parses the new value, re-resolves geometry per the
  // owning element chapter (shapes.html, paths.html, text.html, ...)
  // and repaints; the outline follows along by listening to the
  // document's `change` event.
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

  // Pointer-up / cancel: release pointer capture and clear the drag
  // state. The browser dispatches `pointercancel` whenever it
  // forcibly takes the pointer away (e.g. tab loses focus); we treat
  // it the same as `pointerup` per the lifecycle in interact.html
  // §16.5.
  _onPointerUp(_e) {
    if (!this.drag) return;
    try { this.host.releasePointerCapture(this.drag.pointerId); } catch {}
    this.drag = null;
  }

  // Converts a client-pixel delta into a user-space delta on the root
  // SVG. If the SVG has a `viewBox`, the conversion uses the ratio
  // viewBox-extent / rendered-extent — exactly the inverse of the
  // viewport-to-user mapping the browser computes per coords.html
  // §7.10 ("preserveAspectRatio" + "viewBox"). Without a `viewBox`
  // the SVG is in 1:1 user-units-to-pixels mode so the delta passes
  // through unchanged.
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
  // bounding box. We use `getBoundingClientRect`, which the browser
  // computes after applying the full ancestor CTM and viewBox
  // transforms (coords.html §7.6 / §7.10) — so the outline ends up
  // pixel-accurate in screen space without us having to redo the
  // matrix math.
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
