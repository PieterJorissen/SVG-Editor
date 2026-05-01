import { classOf } from './registry.js';

const POS_ATTRS = {
  rect: ['x', 'y'],
  text: ['x', 'y'],
  circle: ['cx', 'cy'],
  ellipse: ['cx', 'cy'],
};

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

  onDown(e) {
    e.preventDefault();
    const model = this.hitTest(e.clientX, e.clientY);
    this.select(model);

    if (!model || classOf(model).svgTag === 'svg') return;

    const cls = classOf(model);
    const drag = {
      model,
      startX: e.clientX,
      startY: e.clientY,
      pointerId: e.pointerId,
    };

    const posAttrs = POS_ATTRS[cls.svgTag];
    if (posAttrs) {
      const [ax, ay] = posAttrs;
      drag.mode = 'xy';
      drag.ax = ax;
      drag.ay = ay;
      drag.origX = parseFloat(model.getAttribute(ax) ?? '0') || 0;
      drag.origY = parseFloat(model.getAttribute(ay) ?? '0') || 0;
    } else if (cls.svgTag === 'line') {
      drag.mode = 'line';
      drag.x1 = parseFloat(model.getAttribute('x1') ?? '0') || 0;
      drag.y1 = parseFloat(model.getAttribute('y1') ?? '0') || 0;
      drag.x2 = parseFloat(model.getAttribute('x2') ?? '0') || 0;
      drag.y2 = parseFloat(model.getAttribute('y2') ?? '0') || 0;
    } else {
      drag.mode = 'transform';
      drag.origTransform = model.getAttribute('transform') || '';
    }

    this.drag = drag;
    this.host.setPointerCapture(e.pointerId);
  }

  onMove(e) {
    if (!this.drag) return;
    const dxClient = e.clientX - this.drag.startX;
    const dyClient = e.clientY - this.drag.startY;
    const [dx, dy] = this.clientDeltaToSvg(dxClient, dyClient);
    const m = this.drag.model;

    if (this.drag.mode === 'xy') {
      m.setAttribute(this.drag.ax, String(this.drag.origX + dx));
      m.setAttribute(this.drag.ay, String(this.drag.origY + dy));
    } else if (this.drag.mode === 'line') {
      m.setAttribute('x1', String(this.drag.x1 + dx));
      m.setAttribute('y1', String(this.drag.y1 + dy));
      m.setAttribute('x2', String(this.drag.x2 + dx));
      m.setAttribute('y2', String(this.drag.y2 + dy));
    } else if (this.drag.mode === 'transform') {
      const base = this.drag.origTransform;
      const t = `translate(${dx} ${dy})`;
      m.setAttribute('transform', base ? `${t} ${base}` : t);
    }

    this.refreshOutline();
  }

  onUp(e) {
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
      const [, , vbW, vbH] = vbAttr.split(/[\s,]+/).map(Number);
      if (rect.width > 0 && rect.height > 0) {
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
    const m = this.selected;
    if (!m || classOf(m).svgTag === 'svg') {
      this.outline.hidden = true;
      return;
    }
    const svgEl = this.renderer.svgFor(m);
    if (!svgEl || typeof svgEl.getBoundingClientRect !== 'function') {
      this.outline.hidden = true;
      return;
    }
    const r = svgEl.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) {
      this.outline.hidden = true;
      return;
    }
    const hostR = this.host.getBoundingClientRect();
    this.outline.hidden = false;
    this.outline.style.left = (r.left - hostR.left) + 'px';
    this.outline.style.top = (r.top - hostR.top) + 'px';
    this.outline.style.width = r.width + 'px';
    this.outline.style.height = r.height + 'px';
  }
}
