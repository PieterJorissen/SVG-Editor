// queries.js is the editor's read-only view onto the SVG 1.1 DTD —
// content models, attribute groups, value types, namespaces — built
// on top of ../schema.generated.js (generated from svgdtd.html).
//
// Inputs:  element and attribute names from any caller
// Outputs: schema rows, attribute lists, namespace URIs, axis
//          classification, content-model checks
// Common bugs:
//   - insert menu missing a tag (`canHaveChild` content-model check)
//   - drag wrong direction (`isXAxis` / `isYAxis` classification)
//   - namespace dropped on round-trip (`namespaceOf` returns null)
//
// prev: src/rules/grammars.js  ·  next: src/rules/index.js

import { ELEMENTS, ATTRIBUTE_GROUPS, ATTRIBUTES } from '../schema.generated.js';
import { getGrammar } from './grammars.js';

// The SVG namespace URI. Every SVG element lives in this namespace,
// and the browser uses it to decide which parser, which DOM
// interface, and which renderer to apply — see struct.html §5.1
// "The 'svg' element". struct.html §5.10 covers `xml:lang` /
// `xml:space`; linking.html §17 covers `xlink:href` and the IRI
// dereferencing the browser does at render time. (SVG 2 superseded
// `xlink:href` with plain `href`, but the editor preserves whichever
// the input file used.)
export const SVG_NS = 'http://www.w3.org/2000/svg';
export const XML_NS = 'http://www.w3.org/XML/1998/namespace';
export const XLINK_NS = 'http://www.w3.org/1999/xlink';

// Attribute names that carry an x-axis coordinate, by SVG 1.1 naming
// convention. The DTD does not declare an axis explicitly; instead
// the spec uses regular naming (`x`, `cx`, `dx`, `fx`, `refX` →
// x-axis; y-counterparts → y-axis) and describes the geometric
// meaning per element. We encode the convention once here so
// `buildDragPlan` in view/overlay.js can pick the right delta. The
// browser uses the same convention internally when it computes the
// rendered position.
const X_AXIS_ATTRS = new Set(['x', 'x1', 'x2', 'cx', 'dx', 'fx', 'refX']);
const Y_AXIS_ATTRS = new Set(['y', 'y1', 'y2', 'cy', 'dy', 'fy', 'refY']);

// Cheap namespace check. The browser sets `namespaceURI` when it
// parses or constructs a node; comparing against SVG_NS is the
// canonical way to ask "is this an SVG element". Mixed-namespace
// content — `<foreignObject>` carrying HTML, MathML islands, etc. —
// is what makes this check load-bearing.
export function isSvgElement(node) {
  return !!(node && node.namespaceURI === SVG_NS);
}

// Looks up an element's DTD row by lower-cased tag name. The DTD is
// case-sensitive (svgdtd.html shows things like `feGaussianBlur` in
// camelCase), but the schema generator lower-cases its keys; we
// match that here. The browser preserves the original case in
// `localName`, so the canonical form survives.
export function schemaFor(localName) {
  if (!localName) return null;
  return ELEMENTS[String(localName).toLowerCase()] ?? null;
}

// Flattens an element's attribute groups (`%coreAttrs`,
// `%styleAttrs`, ...) into a single ordered list of attribute names.
// The DTD declares these groups via parameter entities, and the
// schema generator lifts them into ATTRIBUTE_GROUPS. The browser does
// the equivalent expansion when it validates the parsed attribute
// list, then exposes the result via `el.attributes`. Element-specific
// attributes (`ownAttrs`) are appended after the shared groups.
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

// One attribute's row from the DTD: its value type, default,
// namespace, enum members, animatable flag. attindex.html lists every
// attribute the spec defines and links each to its declaration site.
// The browser parses each attribute according to this row's type and
// silently ignores anything not declared. The CDATA fallback returned
// for unknown names mirrors the browser's "store as opaque text"
// behaviour for unrecognised attributes.
export function attrInfoOf(attrName) {
  return ATTRIBUTES[attrName] ?? { name: attrName, type: 'CDATA', animatable: false };
}

// Translates an attribute's spec type into the corresponding parse /
// serialise / translate grammar from grammars.js. The browser
// performs the same dispatch when it sees a `setAttribute` call.
export function attrTypeOf(attrName) {
  return getGrammar(attrInfoOf(attrName).type);
}

// Resolves the namespace URI of an attribute: `xml:lang` lives in
// XML_NS, `xlink:href` in XLINK_NS, everything else in the per-
// element default. The DTD encodes the prefix; the browser binds it
// to the URI when it parses, and exposes both via `attr.namespaceURI`.
// Returning null means "no explicit namespace" — `Document.setAttribute`
// then takes the unprefixed path.
export function namespaceOf(attrName) {
  const ns = attrInfoOf(attrName).namespace;
  if (ns === 'xml') return XML_NS;
  if (ns === 'xlink') return XLINK_NS;
  return null;
}

// Reports the schema default for an attribute. `#IMPLIED` attributes
// in the DTD have no default (returns undefined); fixed defaults
// appear in attindex.html. The browser likewise treats an absent
// attribute as the initial value when computing geometry or paint.
export function defaultOf(attrName) {
  return attrInfoOf(attrName).default;
}

// Tells `buildDragPlan` in view/overlay.js which screen-space delta
// (dx, dy, or nothing) an attribute should consume, based on its
// spec name. Used together with the value-type's translate hook in
// grammars.js.
export function isXAxis(attrName) { return X_AXIS_ATTRS.has(attrName); }
export function isYAxis(attrName) { return Y_AXIS_ATTRS.has(attrName); }
export function axisOf(attrName) {
  if (X_AXIS_ATTRS.has(attrName)) return 'x';
  if (Y_AXIS_ATTRS.has(attrName)) return 'y';
  return null;
}

// Asks whether the DTD's content model for `parent` admits `child`.
// The check is by category, matching how svgdtd.html expresses
// content models (e.g. "container content"); each element belongs to
// one or more categories, and a parent's allowed categories are
// stored in its row. The browser does not enforce content models at
// runtime — it will happily render an illegal child — so this query
// exists purely to keep the editor honest.
export function canHaveChild(parentLocalName, childLocalName) {
  const ps = schemaFor(parentLocalName);
  const cs = schemaFor(childLocalName);
  if (!ps || !cs) return false;
  const allowed = new Set(ps.contentCategories);
  for (const cat of cs.categories) if (allowed.has(cat)) return true;
  return false;
}

// Inverse query: every tag the DTD allows as a child of `parent`.
// Used to drive the insert-element dropdown in src/main.js so users
// only see tags that would be schema-valid in the current selection.
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

// Returns the canonical mixed-case form for display
// (`feGaussianBlur`, not `fegaussianblur`). The DTD and eltindex.html
// both list elements in their canonical case, and the browser
// preserves that case in `localName`, so we mostly just return the
// input — but the schema's `displayTag` lets us cover any quirk in
// one place.
export function displayTagFor(localName) {
  return schemaFor(localName)?.displayTag ?? localName ?? '';
}
