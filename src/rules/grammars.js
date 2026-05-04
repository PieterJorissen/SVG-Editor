// Per-VALUE_TYPE grammars: parse, serialise, translate.
//
// Inputs:  attribute strings + (dx, dy) deltas from view/overlay.js
// Outputs: parsed values and translated strings for setAttribute
// Common bugs:
//   - drag moves the wrong attribute (translate hook absent, axis wrong)
//   - asymmetric parse/serialise round-trip
//   - units lost after a drag
//
// prev: (set at end of Phase C)  ·  next: (set at end of Phase C)

// Float parser with a finite-number guard. Used as the leaf of every
// numeric grammar in this file because every numeric leaf in SVG 1.1
// (types.html §4) ultimately reduces to a signed decimal.
const NUM = (s, fallback = 0) => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : fallback;
};

// Splits a length token into number and unit suffix; the shape comes
// straight from the <length> EBNF in types.html §4.5.11.
const LENGTH_RE = /^\s*(-?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*([a-z%]*)\s*$/;

// Opaque text. Stored, not interpreted. Covers everything the spec
// types as <string>, <CDATA>, <ID>, <IRI> in types.html §4.5.4 — the
// browser holds these as DOMStrings and only acts on them at use time.
const STRING = {
  parse: (s) => s ?? '',
  serialise: (v) => v ?? '',
  default: '',
};

// IEEE-754 float, draggable on either axis. The translate hook is what
// lets view/overlay.js shift this attribute during a drag without
// knowing the type itself — the registry below is the seam.
const NUMBER = {
  parse: (s) => NUM(s, 0),
  serialise: (v) => String(v),
  default: 0,
  axisAware: true,
  translate: (v, dx, dy, axis) => v + (axis === 'x' ? dx : axis === 'y' ? dy : 0),
};

// Whole-number variant of NUMBER (types.html §4.5.10). The truncation
// at write time matters: a fractional drag delta on an integer
// attribute would otherwise round-trip to nonsense.
const INTEGER = {
  parse: (s) => Math.trunc(NUM(s, 0)),
  serialise: (v) => String(Math.trunc(v)),
  default: 0,
  axisAware: true,
  translate: (v, dx, dy, axis) => Math.trunc(v + (axis === 'x' ? dx : axis === 'y' ? dy : 0)),
};

// Number paired with an optional CSS unit (types.html §4.5.11). Unit is
// preserved across translate so a drag of `10mm` stays in mm; the
// browser resolves the unit against the viewport at render time.
const LENGTH = {
  parse: (s) => {
    if (s == null || s === '') return { n: 0, unit: '' };
    const m = LENGTH_RE.exec(String(s));
    if (!m) return { n: NUM(s, 0), unit: '' };
    return { n: parseFloat(m[1]), unit: m[2] || '' };
  },
  serialise: ({ n, unit }) => `${n}${unit || ''}`,
  default: { n: 0, unit: '' },
  axisAware: true,
  translate: ({ n, unit }, dx, dy, axis) => ({
    n: n + (axis === 'x' ? dx : axis === 'y' ? dy : 0),
    unit,
  }),
};

// types.html §4.5.6 calls <coordinate> identical in syntax to <length>,
// so the same grammar serves both.
const COORDINATE = LENGTH;

// A colour token (types.html §4.5.5) stored as a raw string. The
// colour widget edits the literal; the browser parses it to sRGB at
// render time.
const COLOR = {
  parse: (s) => s ?? '',
  serialise: (v) => v ?? '',
  default: '',
};

// Colour, or a `url(#id)` paint server reference (types.html §4.5.13).
// Stored verbatim; the browser dereferences the URL at render and
// walks the gradient or pattern to produce pixels.
const PAINT = COLOR;

// Float clamped to [0,1]. Out-of-range input is pulled back here, the
// same way the browser clamps before compositing per render.html.
const OPACITY = {
  parse: (s) => Math.max(0, Math.min(1, NUM(s, 1))),
  serialise: (v) => String(v),
  default: 1,
};

// Whitespace/comma-separated x,y pairs (types.html §4.5.15) used by
// <polyline> and <polygon>. The translate hook shifts every pair by
// (dx, dy); the browser parses the same form into an SVGPointList.
const POINTS = {
  parse: (s) => {
    if (!s) return [];
    const nums = String(s).trim().split(/[\s,]+/).filter(Boolean).map(parseFloat);
    const pts = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
    return pts;
  },
  serialise: (pts) => pts.map(([x, y]) => `${x},${y}`).join(' '),
  default: [],
  translate: (pts, dx, dy, _axis) => pts.map(([x, y]) => [x + dx, y + dy]),
};

// Shifts only the absolute-coordinate operands of a path `d` string,
// so relative segments stay relative. The first lowercase `m` is
// treated as absolute per paths.html §8.3.2. The browser parses the
// same grammar (SVG 2 deprecated SVGPathSegList) and rasterises.
function translatePathData(d, dx, dy) {
  if (!d) return d;
  const tokens = String(d).match(/[MmLlHhVvCcSsQqTtAaZz]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g);
  if (!tokens) return d;
  let cmd = '';
  let absoluteFirstM = false;
  let i = 0;
  const out = [];
  const commandShapes = {
    M: ['x', 'y'], L: ['x', 'y'], H: ['x'], V: ['y'],
    C: ['x', 'y', 'x', 'y', 'x', 'y'], S: ['x', 'y', 'x', 'y'],
    Q: ['x', 'y', 'x', 'y'], T: ['x', 'y'],
    A: ['', '', '', '', '', 'x', 'y'],
  };
  while (i < tokens.length) {
    const t = tokens[i];
    if (/^[A-Za-z]$/.test(t)) {
      cmd = t;
      out.push(t);
      if (cmd === 'M') absoluteFirstM = true;
      i++;
      continue;
    }
    const upper = cmd.toUpperCase();
    const isAbs = cmd === upper;
    const shape = commandShapes[upper];
    if (!shape) { out.push(t); i++; continue; }
    const set = tokens.slice(i, i + shape.length);
    if (set.length < shape.length) { out.push(...tokens.slice(i)); break; }
    for (let j = 0; j < shape.length; j++) {
      let n = parseFloat(set[j]);
      if (isAbs && shape[j] === 'x') n += dx;
      else if (isAbs && shape[j] === 'y') n += dy;
      out.push(String(n));
    }
    i += shape.length;
    if (cmd === 'M') cmd = 'L';
    else if (cmd === 'm') cmd = 'l';
  }
  if (!absoluteFirstM && tokens[0]?.toLowerCase() === 'm') {
    const idx = out.indexOf('m');
    if (idx >= 0 && idx + 2 < out.length) {
      out[idx + 1] = String(parseFloat(out[idx + 1]) + dx);
      out[idx + 2] = String(parseFloat(out[idx + 2]) + dy);
    }
  }
  return out.join(' ');
}

// Wraps the path-data translator as a regular grammar entry. The `d`
// string round-trips unchanged; only translate carries logic.
const PATH_DATA = {
  parse: (s) => s ?? '',
  serialise: (v) => v ?? '',
  default: '',
  translate: (v, dx, dy, _axis) => translatePathData(v, dx, dy),
};

// A `transform="..."` value (coords.html §7.6). Drag prepends a fresh
// `translate(dx dy)` rather than rewriting existing transforms — the
// browser composes the whole list left-to-right into the CTM.
const TRANSFORM_LIST = {
  parse: (s) => s ?? '',
  serialise: (v) => v ?? '',
  default: '',
  translate: (v, dx, dy, _axis) => {
    const t = `translate(${dx} ${dy})`;
    return v ? `${t} ${v}` : t;
  },
};

// Two-value enumeration spelled `true`/`false`. Distinct from a JS
// boolean because the wire format is the literal string.
const BOOLEAN = {
  parse: (s) => s === 'true',
  serialise: (v) => (v ? 'true' : 'false'),
  default: false,
};

// Generic keyword grammar; allowed values come from the per-attribute
// schema row in queries.js (`attrInfo.enumValues`), not from the type.
const ENUMERATION = {
  parse: (s) => s ?? '',
  serialise: (v) => v ?? '',
  default: '',
};

// Registry: VALUE_TYPE name → grammar. The seam that lets overlay drag
// any attribute without knowing its type — the type-name from the
// schema indexes into this table, and the resulting grammar is enough
// to shift the value safely.
const GRAMMARS = {
  CDATA: STRING,
  string: STRING,
  ID: STRING,
  ContentType: STRING,
  LinkTarget: STRING,
  LanguageCode: STRING,
  LanguageCodes: STRING,
  MediaDesc: STRING,
  Script: STRING,
  Text: STRING,
  FeatureList: STRING,
  ExtensionList: STRING,
  EnableBackgroundValue: STRING,
  ClipFillRule: STRING,
  ClipValue: STRING,
  PreserveAspectRatioSpec: STRING,
  ViewBoxSpec: STRING,
  StrokeDashArrayValue: STRING,
  StrokeDashOffsetValue: LENGTH,
  StrokeMiterLimitValue: NUMBER,
  StrokeWidthValue: LENGTH,

  URI: STRING,
  IRI: STRING,

  Number: NUMBER,
  Integer: INTEGER,
  Numbers: STRING,
  Lengths: STRING,
  NumberOptionalNumber: STRING,
  NumberOrPercentage: STRING,

  Length: LENGTH,
  Coordinate: COORDINATE,

  Color: COLOR,
  SVGColor: COLOR,
  Paint: PAINT,
  OpacityValue: OPACITY,

  Points: POINTS,
  PathData: PATH_DATA,
  TransformList: TRANSFORM_LIST,

  Boolean: BOOLEAN,
  enumeration: ENUMERATION,
};

// Lookup with a STRING fallback so unknown types degrade gracefully.
export function getGrammar(typeName) {
  return GRAMMARS[typeName] || STRING;
}

// Probe used by drag planning to know whether a translate hook exists
// for this type before adding it to the plan.
export function hasOwnTranslate(typeName) {
  return !!GRAMMARS[typeName]?.translate;
}
