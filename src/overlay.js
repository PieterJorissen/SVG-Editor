import {
  schemaOf, attributesOf, attrTypeOf, axisOf, isXAxis, isYAxis,
} from './registry.js';

export class Overlay {
  constructor(host, outline, renderer, onSelect) {
    this.host = host;
    this.outline = outline;
    this.renderer = renderer;
    this.onSelect = onSelect;
    this.selected = null;
    this.drag = null;

    this._onDown = (e) => this.onDown(e);
    this._onMove = (e) => this.onMove(e);
    this._onUp = (e) => this.onUp(e);
    this._refresh = () => this.refreshOutline();

    host.addEventListener('pointerdown', this._onDown);
    host.addEventListener('pointermove', this._onMove);
    host.addEventListener('pointerup', this._onUp);
    host.addEventListener('pointercancel', this._onUp);

    window.addEventListener('resize', this._refresh);
    this.renderer.host.addEventListener('scroll', this._refresh, true);
  }

  dispose() {
    this.host.removeEventListener('pointerdown', this._onDown);
    this.host.removeEventListener('pointermove', this._onMove);
    this.host.removeEventListener('pointerup', this._onUp);
    this.host.removeEventListener('pointercancel', this._onUp);
    window.removeEventListener('resize', this._refresh);
    this.renderer.host.removeEventListener('scroll', this._refresh, true);
  }

  hitTest(clientX, clientY) {
    const prev = this.host.style.pointerEvents;
    this.host.style.pointerEvents = 'none';
    const target = document.elementFromPoint(clientX, clientY);
    this.host.style.pointerEvents = prev;
    if (!target) return null;
    let cur = target;
    while (cur && !cur.__model) cur = cur.parentNode;
    return cur ? cur.__model : null;
  }

  // Build a drag plan: a list of { name, axis } telling onMove which
  // attributes to translate and (for axis-aware types) along which axis.
  // Falls back to translating the `transform` attribute when nothing else
  // is translatable.
  buildDragPlan(model) {
    const plan = [];
    let hasTransform = false;
    for (const name of attributesOf(model)) {
      const type = attrTypeOf(name);
      if (!type.translate) continue;
      if (type.axisAware) {
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

  onDown(e) {
    e.preventDefault();
    const target = this.hitTest(e.clientX, e.clientY);
    this.select(target);

    if (!target || schemaOf(target)?.tag === 'svg') return;

    const plan = this.buildDragPlan(target);
    if (plan.length === 0) return;

    const origValues = new Map();
    for (const step of plan) {
      origValues.set(step.name, target.getAttribute(step.name) ?? '');
    }

    this.drag = {
      target,
      plan,
      origValues,
      startX: e.clientX,
      startY: e.clientY,
      pointerId: e.pointerId,
    };
    this.host.setPointerCapture(e.pointerId);
  }

  onMove(e) {
    if (!this.drag) return;
    const dxClient = e.clientX - this.drag.startX;
    const dyClient = e.clientY - this.drag.startY;
    const [dx, dy] = this.clientDeltaToSvg(dxClient, dyClient);
    const { target, plan, origValues } = this.drag;

    for (const step of plan) {
      const type = attrTypeOf(step.name);
      const orig = origValues.get(step.name);
      const parsed = type.parse(orig);
      const moved = type.translate(parsed, dx, dy, step.axis);
      target.setAttribute(step.name, type.serialise(moved));
    }

    this.refreshOutline();
  }

  onUp(_e) {
    if (!this.drag) return;
    try { this.host.releasePointerCapture(this.drag.pointerId); } catch {}
    this.drag = null;
  }

  clientDeltaToSvg(dxClient, dyClient) {
    const svg = this.renderer.svgRoot;
    if (!svg) return [dxClient, dyClient];
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

  select(model) {
    this.selected = model;
    this.refreshOutline();
    if (this.onSelect) this.onSelect(model);
  }

  refreshOutline() {
    const target = this.selected;
    if (!target || schemaOf(target)?.tag === 'svg') {
      this.outline.hidden = true;
      return;
    }
    const svgEl = this.renderer.svgFor(target);
    if (!svgEl || typeof svgEl.getBoundingClientRect !== 'function') {
      this.outline.hidden = true;
      return;
    }
    const bounds = svgEl.getBoundingClientRect();
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
