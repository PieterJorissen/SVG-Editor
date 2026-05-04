// Schema queries on top of the generated SVG 1.1 tables. Pure data and
// pure functions — no DOM mutations — so this module can run in plain
// Node and be reasoned about without a browser.
//
// The data backing these queries comes from the SVG 1.1 DTD as published
// in svgdtd.html (Document Type Definition). Each element's attributes,
// content model and category memberships are derived from the DTD's
// `<!ELEMENT>`, `<!ATTLIST>` and parameter-entity declarations and folded
// into ELEMENTS / ATTRIBUTE_GROUPS / ATTRIBUTES at build time. The
// browser carries an equivalent table inside its parser, but does not
// expose it to JS, which is why we mirror the DTD here.
import { ELEMENTS, ATTRIBUTE_GROUPS, ATTRIBUTES } from '../schema.generated.js';
import { getGrammar } from './grammars.js';

// The SVG namespace URI. Every SVG element lives in this namespace, and
// the browser uses it to decide which parser, which DOM interface and
// which renderer to apply — see the namespace discussion in struct.html
// §5.1 and the root-element rules in struct.html §5.1.1.
export const SVG_NS = 'http://www.w3.org/2000/svg';
// The XML namespace, used for `xml:lang`, `xml:space` and friends. The
// browser binds these to the namespaced attributes per the XML 1.0 spec
// referenced from struct.html §5.10.
export const XML_NS = 'http://www.w3.org/XML/1998/namespace';
// The XLink namespace. Required for `xlink:href` on <use>, <a>,
// gradients, etc.; the browser dereferences these references at render
// time per linking.html §17.
export const XLINK_NS = 'http://www.w3.org/1999/xlink';

// Attribute names that carry an x-axis coordinate, by SVG 1.1 naming
// convention. The DTD doesn't declare an axis explicitly; instead the
// spec uses regular naming (`x`, `cx`, `dx`, `fx`, `refX`, ...) and
// describes the geometric meaning per element. We encode the convention
// once here so drag planning can pick the right delta. The browser uses
// the same convention internally when it computes the rendered position.
const X_AXIS_ATTRS = new Set(['x', 'x1', 'x2', 'cx', 'dx', 'fx', 'refX']);
// y-axis counterpart — same convention, same source.
const Y_AXIS_ATTRS = new Set(['y', 'y1', 'y2', 'cy', 'dy', 'fy', 'refY']);

// Cheap namespace check. The browser sets `namespaceURI` when it parses
// or constructs a node; comparing against SVG_NS is the canonical way
// to ask "is this an SVG element". struct.html §5.1 explains why mixed
// namespaces exist inside an SVG document (foreignObject, MathML, ...).
export function isSvgElement(node) {
  return !!(node && node.namespaceURI === SVG_NS);
}

// Looks up an element's DTD row by lower-cased tag name. The DTD is
// case-sensitive (svgdtd.html shows things like `feGaussianBlur` in
// camelCase) but we lower-case before lookup because the schema
// generator normalises keys, and the DOM has already preserved the
// original case in `localName`.
export function schemaFor(localName) {
  if (!localName) return null;
  return ELEMENTS[String(localName).toLowerCase()] ?? null;
}

// Flattens an element's attribute groups (e.g. %coreAttrs, %styleAttrs)
// into a single ordered list of attribute names. The DTD declares the
// groups via parameter entities and the schema generator lifts them
// into ATTRIBUTE_GROUPS. The browser does the equivalent expansion when
// it validates the parsed attribute list, then exposes the result via
// `el.attributes`.
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

// One attribute's row from the DTD: its value type, default, namespace,
// enum members, animatable flag. attindex.html lists every attribute the
// spec defines and links each to its declaration site. The browser
// parses each attribute according to this row's type and silently
// ignores anything not declared.
export function attrInfoOf(attrName) {
  return ATTRIBUTES[attrName] ?? { name: attrName, type: 'CDATA', animatable: false };
}

// Translates an attribute's spec type into the corresponding parse /
// serialise / translate grammar from grammars.js. The browser performs
// the same dispatch when it sees a setAttribute call.
export function attrTypeOf(attrName) {
  return getGrammar(attrInfoOf(attrName).type);
}

// Resolves the namespace URI of an attribute — `xml:lang` lives in
// XML_NS, `xlink:href` in XLINK_NS, everything else in the per-element
// default. The DTD encodes the prefix; the browser binds it to the URI
// when it parses, and exposes both via `attr.namespaceURI`.
export function namespaceOf(attrName) {
  const ns = attrInfoOf(attrName).namespace;
  if (ns === 'xml') return XML_NS;
  if (ns === 'xlink') return XLINK_NS;
  return null;
}

// Reports the schema default for an attribute. `#IMPLIED` attributes in
// the DTD have no default (returns undefined); fixed defaults appear in
// attindex.html. The browser likewise treats an absent attribute as the
// initial value when computing geometry or paint.
export function defaultOf(attrName) {
  return attrInfoOf(attrName).default;
}

// Tells drag planning which screen-space delta (dx / dy / nothing) an
// attribute should consume, based on its spec name. Used together with
// the value-type's translate hook in grammars.js.
export function isXAxis(attrName) { return X_AXIS_ATTRS.has(attrName); }
export function isYAxis(attrName) { return Y_AXIS_ATTRS.has(attrName); }
export function axisOf(attrName) {
  if (X_AXIS_ATTRS.has(attrName)) return 'x';
  if (Y_AXIS_ATTRS.has(attrName)) return 'y';
  return null;
}

// Asks whether the DTD's content model for `parent` admits `child`.
// The check is by category, matching how svgdtd.html expresses content
// models (e.g. "Container content"); each element belongs to one or
// more categories and a parent's allowed categories are stored in its
// row. The browser does not enforce content models at runtime — it
// will happily render an illegal child — so this query exists purely to
// keep the editor honest.
export function canHaveChild(parentLocalName, childLocalName) {
  const ps = schemaFor(parentLocalName);
  const cs = schemaFor(childLocalName);
  if (!ps || !cs) return false;
  const allowed = new Set(ps.contentCategories);
  for (const cat of cs.categories) if (allowed.has(cat)) return true;
  return false;
}

// Inverse query: every tag the DTD allows as a child of `parent`. Used
// to drive the insert-element dropdown so users only see tags that
// would be schema-valid in the current selection.
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

// Returns the canonical mixed-case form for display ("feGaussianBlur"
// not "fegaussianblur"). The DTD and eltindex.html both list elements
// in their canonical case, and the browser preserves that case in
// `localName`, so we mostly just return the input — but the schema's
// `displayTag` lets us cover any quirk in one place.
export function displayTagFor(localName) {
  return schemaFor(localName)?.displayTag ?? localName ?? '';
}
