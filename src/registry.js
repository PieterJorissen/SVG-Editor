export const SVG_NS = 'http://www.w3.org/2000/svg';

class EdElement extends HTMLElement {
  static svgTag = '';
  static attrs = {};
  static childTags = [];
}

class EdSvg extends EdElement {
  static svgTag = 'svg';
  static attrs = {
    width: 800,
    height: 600,
    viewBox: '0 0 800 600',
  };
  static childTags = ['g', 'rect', 'circle', 'ellipse', 'line', 'polygon', 'polyline', 'path', 'text'];
}

class EdG extends EdElement {
  static svgTag = 'g';
  static attrs = { transform: '', fill: '', stroke: '', 'stroke-width': '', opacity: '' };
  static childTags = ['g', 'rect', 'circle', 'ellipse', 'line', 'polygon', 'polyline', 'path', 'text'];
}

class EdRect extends EdElement {
  static svgTag = 'rect';
  static attrs = {
    x: 0, y: 0, width: 100, height: 100, rx: 0, ry: 0,
    fill: '#4f8cff', stroke: '', 'stroke-width': '', opacity: '', transform: '',
  };
  static childTags = [];
}

class EdCircle extends EdElement {
  static svgTag = 'circle';
  static attrs = {
    cx: 0, cy: 0, r: 50,
    fill: '#ef4444', stroke: '', 'stroke-width': '', opacity: '', transform: '',
  };
  static childTags = [];
}

class EdEllipse extends EdElement {
  static svgTag = 'ellipse';
  static attrs = {
    cx: 0, cy: 0, rx: 60, ry: 40,
    fill: '#22c55e', stroke: '', 'stroke-width': '', opacity: '', transform: '',
  };
  static childTags = [];
}

class EdLine extends EdElement {
  static svgTag = 'line';
  static attrs = {
    x1: 0, y1: 0, x2: 100, y2: 100,
    stroke: '#000000', 'stroke-width': 2, opacity: '', transform: '',
  };
  static childTags = [];
}

class EdPolygon extends EdElement {
  static svgTag = 'polygon';
  static attrs = {
    points: '0,0 100,0 50,86',
    fill: '#a855f7', stroke: '', 'stroke-width': '', opacity: '', transform: '',
  };
  static childTags = [];
}

class EdPolyline extends EdElement {
  static svgTag = 'polyline';
  static attrs = {
    points: '0,0 50,50 100,0 150,50',
    fill: 'none', stroke: '#000000', 'stroke-width': 2, opacity: '', transform: '',
  };
  static childTags = [];
}

class EdPath extends EdElement {
  static svgTag = 'path';
  static attrs = {
    d: 'M 0 0 L 100 0 L 100 100 Z',
    fill: '#f59e0b', stroke: '', 'stroke-width': '', opacity: '', transform: '',
  };
  static childTags = [];
}

class EdText extends EdElement {
  static svgTag = 'text';
  static attrs = {
    x: 0, y: 0,
    'font-family': 'sans-serif', 'font-size': 16,
    fill: '#000000', stroke: '', 'stroke-width': '', opacity: '', transform: '',
    'text-anchor': '',
  };
  static childTags = [];
  static hasText = true;
}

export const REGISTRY = [
  EdSvg, EdG, EdRect, EdCircle, EdEllipse, EdLine,
  EdPolygon, EdPolyline, EdPath, EdText,
];

export const TAG_BY_SVG = {};
export const CLASS_BY_SVG = {};

for (const cls of REGISTRY) {
  const tag = 'ed-' + cls.svgTag;
  TAG_BY_SVG[cls.svgTag] = tag;
  CLASS_BY_SVG[cls.svgTag] = cls;
  if (!customElements.get(tag)) customElements.define(tag, cls);
}

export function isModelElement(node) {
  return node instanceof HTMLElement && !!node.constructor.svgTag;
}

export function classOf(modelEl) {
  return modelEl?.constructor;
}

export function createModelElement(svgTag, attrs = {}) {
  const tag = TAG_BY_SVG[svgTag];
  if (!tag) return null;
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v != null && v !== '') el.setAttribute(k, String(v));
  }
  return el;
}

export function canHaveChild(parent, childSvgTag) {
  const cls = classOf(parent);
  if (!cls) return false;
  return cls.childTags.includes(childSvgTag);
}
