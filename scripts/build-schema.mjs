#!/usr/bin/env node
// scripts/build-schema.mjs
// Generates src/schema.generated.js from the W3C SVG 1.1 spec bundled in vendor/.
//
// Inputs:
//   vendor/REC-SVG11-20110816/svgdtd.html   (DTD: content models, attribute groups, attribute types/defaults)
//   vendor/REC-SVG11-20110816/eltindex.html (canonical element list)
//   vendor/REC-SVG11-20110816/attindex.html (per-attribute element list + animatability)
//
// Output: src/schema.generated.js (committed; never parsed at runtime).

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SPEC = join(ROOT, 'vendor', 'REC-SVG11-20110816');

const decode = (s) => s
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&amp;/g, '&');

// Strip HTML tags but keep text — used on spec index pages.
const stripTags = (s) => s.replace(/<[^>]+>/g, '');

const readSpec = (name) => readFileSync(join(SPEC, name), 'utf8');

// ---------- 1. Element list (eltindex.html) ----------
function extractElements() {
  const html = readSpec('eltindex.html');
  const out = [];
  const re = /<span class="element-name">[‘’']?([^<‘’']+)[‘’']?<\/span>/g;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return Array.from(new Set(out));
}

// ---------- 2. attindex.html: attribute -> element list + animatability ----------
function extractAttIndex() {
  const html = readSpec('attindex.html');
  const rows = [];
  const rowRe = /<tr>(.*?)<\/tr>/gs;
  let r;
  while ((r = rowRe.exec(html))) {
    const row = r[1];
    if (!/attr-name/.test(row)) continue;
    const cells = [...row.matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map((m) => m[1]);
    if (cells.length < 2) continue;
    const attrName = (cells[0].match(/<span class="attr-name">[‘’']?([^<‘’']+)[‘’']?<\/span>/) || [])[1];
    if (!attrName) continue;
    const elements = [...cells[1].matchAll(/<span class="element-name">[‘’']?([^<‘’']+)[‘’']?<\/span>/g)].map((m) => m[1]);
    const animatable = /✓|✓/.test(cells[2] || '');
    rows.push({ attr: attrName, elements, animatable });
  }
  return rows;
}

// ---------- 3. DTD parsing ----------
function loadDTD() {
  const html = readSpec('svgdtd.html');
  // The DTD is HTML-encoded; decode it. Whole-file decode is fine — we only look for DTD shapes.
  return decode(stripTags(html));
}

// First declaration wins: standard XML/DTD parameter-entity rule.
function extractEntities(dtd) {
  const map = new Map();
  const re = /<!ENTITY\s+%\s+([A-Za-z0-9._-]+)\s+("([^"]*)"|'([^']*)')\s*>/g;
  let m;
  while ((m = re.exec(dtd))) {
    if (!map.has(m[1])) map.set(m[1], m[3] ?? m[4] ?? '');
  }
  return map;
}

// Categories: <!ENTITY % SVG.<X>.class "... %SVG.<E>.qname; ..."> defines membership.
function extractCategories(entities) {
  const categoryToElements = new Map();
  for (const [name, value] of entities) {
    const m = name.match(/^SVG\.([A-Za-z0-9_-]+)\.class$/);
    if (!m) continue;
    const cat = m[1];
    const els = [...value.matchAll(/%SVG\.([A-Za-z0-9_-]+)\.qname;/g)].map((x) => x[1]);
    categoryToElements.set(cat, Array.from(new Set(els)));
  }
  // Skip degenerate "extra" categories that the DTD reserves as user-extensible empty hooks.
  for (const k of [...categoryToElements.keys()]) {
    if (/\.extra$/.test(k) || categoryToElements.get(k).length === 0) {
      categoryToElements.delete(k);
    }
  }
  return categoryToElements;
}

// Per-element content categories: from <!ENTITY % SVG.<E>.content "...%SVG.<C>.class;..."> declarations.
function extractContentModels(entities, validCategories) {
  const map = new Map();
  for (const [name, value] of entities) {
    const m = name.match(/^SVG\.([A-Za-z0-9_-]+)\.content$/);
    if (!m) continue;
    const el = m[1];
    const cats = [...value.matchAll(/%SVG\.([A-Za-z0-9_-]+)\.class;/g)]
      .map((x) => x[1])
      .filter((c) => validCategories.has(c));
    map.set(el, Array.from(new Set(cats)));
  }
  return map;
}

// Elements whose content includes #PCDATA — text-bearing.
function extractTextElements(entities) {
  const set = new Set();
  for (const [name, value] of entities) {
    const m = name.match(/^SVG\.([A-Za-z0-9_-]+)\.content$/);
    if (!m) continue;
    if (/#PCDATA/.test(value)) set.add(m[1]);
  }
  return set;
}

// Attribute declarations inside an entity value or ATTLIST body.
// Lines look like:   name TYPE DEFAULT
//   TYPE  := %X.datatype; | (a|b|c) | CDATA | NMTOKEN | NMTOKENS | IDREF | IDREFS | ID
//   DEFAULT := #IMPLIED | #REQUIRED | #FIXED "v" | "v"
function parseAttrDecls(body) {
  // Strip comments and conditional markers.
  body = body.replace(/<!--[\s\S]*?-->/g, '');
  // Remove referenced groups (handled separately).
  body = body.replace(/%SVG\.[A-Za-z0-9_.-]+\.attrib;/g, '');
  const out = [];
  // Tokenise greedily — DTD is whitespace-tolerant.
  // Strategy: match name + type + default in a forgiving regex.
  const re = /([A-Za-z_][A-Za-z0-9._:-]*)\s+(%[A-Za-z0-9._-]+;|\([^)]+\)|CDATA|NMTOKENS?|IDREFS?|ID|ENTITY|ENTITIES|NUMBER)\s+(#IMPLIED|#REQUIRED|#FIXED\s+(?:"[^"]*"|'[^']*')|"[^"]*"|'[^']*')/g;
  let m;
  while ((m = re.exec(body))) {
    const name = m[1];
    const rawType = m[2];
    const rawDefault = m[3];
    let type, enumValues;
    if (rawType.startsWith('%')) {
      const t = rawType.match(/%([A-Za-z0-9._-]+);/)[1];
      type = t.replace(/\.datatype$/, '');
    } else if (rawType.startsWith('(')) {
      type = 'enumeration';
      enumValues = rawType.slice(1, -1).split('|').map((s) => s.trim());
    } else {
      type = rawType;
    }
    let def;
    if (rawDefault === '#IMPLIED') def = undefined;
    else if (rawDefault === '#REQUIRED') def = undefined;
    else if (rawDefault.startsWith('#FIXED')) def = rawDefault.match(/"([^"]*)"|'([^']*)'/)?.slice(1).find(Boolean);
    else def = rawDefault.match(/"([^"]*)"|'([^']*)'/)?.slice(1).find(Boolean);
    const required = rawDefault === '#REQUIRED';
    out.push({ name, type, enumValues, default: def, required });
  }
  return out;
}

// Attribute groups: <!ENTITY % SVG.<G>.attrib "..."> — value contains attribute decls
// and may transitively reference other %SVG.<sub>.attrib; entities.
function extractAttributeGroups(entities) {
  const groups = new Map(); // groupName -> { attrs: AttrRef[], includes: groupName[] }
  for (const [name, value] of entities) {
    const m = name.match(/^SVG\.([A-Za-z0-9_-]+)\.attrib$/);
    if (!m) continue;
    const g = m[1];
    const includes = [...value.matchAll(/%SVG\.([A-Za-z0-9_-]+)\.attrib;/g)].map((x) => x[1]);
    const attrs = parseAttrDecls(value);
    groups.set(g, { attrs, includes });
  }
  return groups;
}

// Flatten group inclusions; each group ends up with its full attribute list.
function flattenGroups(groups) {
  const flat = new Map();
  const stack = new Set();
  function visit(name) {
    if (flat.has(name)) return flat.get(name);
    if (stack.has(name)) return [];
    stack.add(name);
    const entry = groups.get(name);
    if (!entry) { stack.delete(name); flat.set(name, []); return []; }
    const acc = new Map();
    for (const inc of entry.includes) {
      for (const a of visit(inc)) acc.set(a.name, a);
    }
    for (const a of entry.attrs) acc.set(a.name, a);
    stack.delete(name);
    const arr = [...acc.values()];
    flat.set(name, arr);
    return arr;
  }
  for (const k of groups.keys()) visit(k);
  return flat;
}

// ATTLIST blocks: <!ATTLIST %SVG.<E>.qname; ...body... >
// Body contains both group references and inline attribute declarations.
function extractElementAttlists(dtd) {
  const map = new Map(); // element -> { groups: string[], own: AttrRef[] }
  const re = /<!ATTLIST\s+%SVG\.([A-Za-z0-9_-]+)\.qname;\s*([\s\S]*?)>/g;
  let m;
  while ((m = re.exec(dtd))) {
    const el = m[1];
    const body = m[2];
    const groups = [...body.matchAll(/%SVG\.([A-Za-z0-9_-]+)\.attrib;/g)].map((x) => x[1]);
    const own = parseAttrDecls(body);
    if (!map.has(el)) {
      map.set(el, { groups, own });
    } else {
      // Merge — DTD allows multiple ATTLIST blocks per element.
      const e = map.get(el);
      e.groups = Array.from(new Set([...e.groups, ...groups]));
      const seen = new Set(e.own.map((a) => a.name));
      for (const a of own) if (!seen.has(a.name)) e.own.push(a);
    }
  }
  return map;
}

// Namespaced attributes — known set per the spec.
function namespaceFor(name) {
  if (name === 'xml:lang' || name === 'xml:space' || name === 'xml:base') return 'xml';
  if (name.startsWith('xlink:')) return 'xlink';
  return undefined;
}

// ---------- 4. Compose schema ----------
function build() {
  const elementNames = extractElements();
  const dtd = loadDTD();
  const entities = extractEntities(dtd);

  const categoriesMap = extractCategories(entities); // category -> elements
  const validCategories = new Set(categoriesMap.keys());
  const contentMap = extractContentModels(entities, validCategories); // element -> categories
  const textElements = extractTextElements(entities);
  const attlists = extractElementAttlists(dtd);
  const groups = extractAttributeGroups(entities);
  const flatGroups = flattenGroups(groups);

  // Element -> categories (invert categoriesMap).
  const elementCategories = new Map();
  for (const [cat, els] of categoriesMap) {
    for (const el of els) {
      if (!elementCategories.has(el)) elementCategories.set(el, []);
      elementCategories.get(el).push(cat);
    }
  }

  // attindex cross-reference for animatability + canonical attribute list.
  const attIdx = extractAttIndex();
  const animatable = new Map(attIdx.map((r) => [r.attr, r.animatable]));
  const attrToElements = new Map(attIdx.map((r) => [r.attr, r.elements]));

  // Build ATTRIBUTES — union from groups + own + attindex.
  const ATTRIBUTES = {};
  function recordAttr(decl) {
    const existing = ATTRIBUTES[decl.name];
    if (existing) {
      // Prefer entries with a real default / type.
      if (existing.type === 'CDATA' && decl.type !== 'CDATA') existing.type = decl.type;
      if (existing.default == null && decl.default != null) existing.default = decl.default;
      if (decl.enumValues && !existing.enumValues) existing.enumValues = decl.enumValues;
      return;
    }
    const ns = namespaceFor(decl.name);
    ATTRIBUTES[decl.name] = {
      name: decl.name,
      ...(ns ? { namespace: ns } : {}),
      type: decl.type || 'CDATA',
      ...(decl.enumValues ? { enumValues: decl.enumValues } : {}),
      ...(decl.default != null ? { default: decl.default } : {}),
      animatable: !!animatable.get(decl.name),
    };
  }

  for (const [, g] of groups) for (const a of g.attrs) recordAttr(a);
  for (const [, e] of attlists) for (const a of e.own) recordAttr(a);
  // Surface attindex-only attributes (presentation attrs declared via CSS, etc.).
  for (const r of attIdx) {
    if (!ATTRIBUTES[r.attr]) {
      const ns = namespaceFor(r.attr);
      ATTRIBUTES[r.attr] = {
        name: r.attr,
        ...(ns ? { namespace: ns } : {}),
        type: 'CDATA',
        animatable: !!r.animatable,
      };
    }
  }

  // ATTRIBUTE_GROUPS export — names referenced by elements.
  const ATTRIBUTE_GROUPS = {};
  for (const [name, attrs] of flatGroups) ATTRIBUTE_GROUPS[name] = attrs.map((a) => a.name);

  // ELEMENTS export.
  const ELEMENTS = {};
  for (const displayTag of elementNames) {
    const tag = displayTag.toLowerCase();
    const attlist = attlists.get(displayTag) || { groups: [], own: [] };
    const cats = elementCategories.get(displayTag) || [];
    const content = contentMap.get(displayTag) || [];
    ELEMENTS[tag] = {
      tag,
      displayTag,
      categories: cats,
      contentCategories: content,
      contentText: textElements.has(displayTag),
      attributeGroups: attlist.groups,
      ownAttrs: attlist.own.map((a) => a.name),
    };
  }

  // CATEGORIES — sorted, deterministic.
  const CATEGORIES = [...categoriesMap.keys()].sort();

  // VALUE_TYPES — every type name actually referenced.
  const valueTypes = new Set();
  for (const a of Object.values(ATTRIBUTES)) valueTypes.add(a.type);
  const VALUE_TYPES = [...valueTypes].sort();

  return { ELEMENTS, ATTRIBUTE_GROUPS, ATTRIBUTES, CATEGORIES, VALUE_TYPES };
}

function emit(schema) {
  const { ELEMENTS, ATTRIBUTE_GROUPS, ATTRIBUTES, CATEGORIES, VALUE_TYPES } = schema;
  const json = (x) => JSON.stringify(x, null, 2);
  const banner = `// AUTOGENERATED by scripts/build-schema.mjs — DO NOT EDIT BY HAND.\n` +
                 `// Source: vendor/REC-SVG11-20110816/{svgdtd,attindex,eltindex}.html\n`;
  return banner +
    `export const ELEMENTS = ${json(ELEMENTS)};\n\n` +
    `export const ATTRIBUTE_GROUPS = ${json(ATTRIBUTE_GROUPS)};\n\n` +
    `export const ATTRIBUTES = ${json(ATTRIBUTES)};\n\n` +
    `export const CATEGORIES = ${json(CATEGORIES)};\n\n` +
    `export const VALUE_TYPES = ${json(VALUE_TYPES)};\n`;
}

const schema = build();
const out = emit(schema);
const outPath = join(ROOT, 'src', 'schema.generated.js');
writeFileSync(outPath, out);

// Brief stats to stderr.
process.stderr.write(
  `[schema] elements=${Object.keys(schema.ELEMENTS).length}` +
  ` attributes=${Object.keys(schema.ATTRIBUTES).length}` +
  ` groups=${Object.keys(schema.ATTRIBUTE_GROUPS).length}` +
  ` categories=${schema.CATEGORIES.length}` +
  ` types=${schema.VALUE_TYPES.length}\n`
);
