import { ELEMENTS, ATTRIBUTE_GROUPS, ATTRIBUTES } from './schema.generated.js';
import { getType, hasOwnTranslate } from './types/index.js';

export const SVG_NS = 'http://www.w3.org/2000/svg';
export const XML_NS = 'http://www.w3.org/XML/1998/namespace';
export const XLINK_NS = 'http://www.w3.org/1999/xlink';

// Coordinate-axis convention by attribute name. SVG 1.1 names follow a
// regular pattern (x, x1, x2, cx, dx, fx, refX → x-axis; y-counterparts → y).
// This is grammar, not element-specific code, and lives at the registry layer.
const X_AXIS_ATTRS = new Set(['x', 'x1', 'x2', 'cx', 'dx', 'fx', 'refX']);
const Y_AXIS_ATTRS = new Set(['y', 'y1', 'y2', 'cy', 'dy', 'fy', 'refY']);

class EdElement extends HTMLElement {
  static schema = null;
}

const _classByTag = new Map();

function defineAll() {
  for (const [tag, schema] of Object.entries(ELEMENTS)) {
    const customTag = 'ed-' + tag;
    if (customElements.get(customTag)) continue;
    // Each element gets its own subclass so customElements.define receives a
    // unique constructor and the class carries its schema as a static.
    const Sub = class extends EdElement {};
    Sub.schema = schema;
    Object.defineProperty(Sub, 'name', { value: 'Ed_' + tag });
    customElements.define(customTag, Sub);
    _classByTag.set(tag, Sub);
  }
}

defineAll();

export function isModelElement(node) {
  return node instanceof EdElement;
}

export function schemaOf(modelElement) {
  return modelElement?.constructor?.schema ?? null;
}

export function tagOf(modelElement) {
  return schemaOf(modelElement)?.tag ?? '';
}

export function displayTagOf(modelElement) {
  return schemaOf(modelElement)?.displayTag ?? '';
}

export function attributesOf(modelElement) {
  const schema = schemaOf(modelElement);
  if (!schema) return [];
  const seen = new Set();
  const out = [];
  for (const groupName of schema.attributeGroups) {
    for (const a of (ATTRIBUTE_GROUPS[groupName] ?? [])) {
      if (!seen.has(a)) { seen.add(a); out.push(a); }
    }
  }
  for (const a of schema.ownAttrs) {
    if (!seen.has(a)) { seen.add(a); out.push(a); }
  }
  return out;
}

export function attrInfoOf(attrName) {
  return ATTRIBUTES[attrName] ?? { name: attrName, type: 'CDATA', animatable: false };
}

export function attrTypeOf(attrName) {
  const info = attrInfoOf(attrName);
  return getType(info.type, info);
}

export function namespaceOf(attrName) {
  const ns = attrInfoOf(attrName).namespace;
  if (ns === 'xml') return XML_NS;
  if (ns === 'xlink') return XLINK_NS;
  return null;
}

export function defaultOf(attrName) {
  return attrInfoOf(attrName).default;
}

export function isXAxis(attrName) { return X_AXIS_ATTRS.has(attrName); }
export function isYAxis(attrName) { return Y_AXIS_ATTRS.has(attrName); }
export function axisOf(attrName) {
  if (X_AXIS_ATTRS.has(attrName)) return 'x';
  if (Y_AXIS_ATTRS.has(attrName)) return 'y';
  return null;
}

export function hasTranslateForAttr(attrName) {
  return hasOwnTranslate(attrInfoOf(attrName).type) || axisOf(attrName) != null;
}

export function canHaveChild(parent, childTag) {
  const ps = schemaOf(parent);
  const cs = ELEMENTS[childTag];
  if (!ps || !cs) return false;
  const allowed = new Set(ps.contentCategories);
  for (const cat of cs.categories) if (allowed.has(cat)) return true;
  return false;
}

export function elementsAcceptedBy(parent) {
  const ps = schemaOf(parent);
  if (!ps) return [];
  const allowed = new Set(ps.contentCategories);
  const out = [];
  for (const [tag, sc] of Object.entries(ELEMENTS)) {
    for (const cat of sc.categories) {
      if (allowed.has(cat)) { out.push(tag); break; }
    }
  }
  return out.sort();
}

export function createModelElement(tag, attrs = {}) {
  if (!ELEMENTS[tag]) return null;
  const el = document.createElement('ed-' + tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === '') continue;
    const ns = namespaceOf(k);
    if (ns) el.setAttributeNS(ns, k, String(v));
    else el.setAttribute(k, String(v));
  }
  return el;
}

export function tagFromDisplay(displayTag) {
  return displayTag?.toLowerCase() ?? '';
}

export function elementListByCategory() {
  const out = new Map();
  for (const [tag, sc] of Object.entries(ELEMENTS)) {
    for (const cat of sc.categories) {
      if (!out.has(cat)) out.set(cat, []);
      out.get(cat).push(tag);
    }
  }
  return out;
}
