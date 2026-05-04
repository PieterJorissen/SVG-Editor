import { ELEMENTS, ATTRIBUTE_GROUPS, ATTRIBUTES } from '../schema.generated.js';
import { getGrammar } from './grammars.js';

export const SVG_NS = 'http://www.w3.org/2000/svg';
export const XML_NS = 'http://www.w3.org/XML/1998/namespace';
export const XLINK_NS = 'http://www.w3.org/1999/xlink';

// Coordinate-axis convention by attribute name. SVG 1.1 names follow a
// regular pattern (x, x1, x2, cx, dx, fx, refX → x-axis; y-counterparts → y).
// Pure rule, encoded once here.
const X_AXIS_ATTRS = new Set(['x', 'x1', 'x2', 'cx', 'dx', 'fx', 'refX']);
const Y_AXIS_ATTRS = new Set(['y', 'y1', 'y2', 'cy', 'dy', 'fy', 'refY']);

export function isSvgElement(node) {
  return !!(node && node.namespaceURI === SVG_NS);
}

export function schemaFor(localName) {
  if (!localName) return null;
  return ELEMENTS[String(localName).toLowerCase()] ?? null;
}

export function attributesOf(localName) {
  const schema = schemaFor(localName);
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
  return getGrammar(attrInfoOf(attrName).type);
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

export function canHaveChild(parentLocalName, childLocalName) {
  const ps = schemaFor(parentLocalName);
  const cs = schemaFor(childLocalName);
  if (!ps || !cs) return false;
  const allowed = new Set(ps.contentCategories);
  for (const cat of cs.categories) if (allowed.has(cat)) return true;
  return false;
}

export function elementsAcceptedBy(parentLocalName) {
  const ps = schemaFor(parentLocalName);
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

export function displayTagFor(localName) {
  return schemaFor(localName)?.displayTag ?? localName ?? '';
}
