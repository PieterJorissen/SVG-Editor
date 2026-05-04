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
// numeric grammar in this file because every numeric leaf in chapter 4
// "Basic Data Types" (types.html) — <number>, <integer>, <length>,
// opacity, the items inside <list-of-points> — ultimately reduces to
// "an optionally signed decimal", which is also what the browser's
// attribute parser accepts. Each grammar below mirrors one clause of
// types.html and round-trips through this parser at the leaf.
const NUM = (s, fallback = 0) => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : fallback;
};

// Splits a length token into its number part and unit suffix. The
// shape matches the <length> EBNF in types.html §4.5.11; the browser
// parses the same form and keeps the unit so it can convert at render
// time.
const LENGTH_RE = /^\s*(-?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*([a-z%]*)\s*$/;

// Opaque text passed straight through. Covers everything the spec
// types as <string>, <CDATA>, <ID>, <IRI> and the various named tokens
// in types.html §4.5.4. The browser stores these as DOMStrings and
// only acts on them at use time, so the editor is free to do the same.
const STRING = {
  parse: (s) => s ?? '',
  serialise: (v) => v ?? '',
  default: '',
};

// A plain IEEE-754 float, draggable on either axis. The translate
// hook is the small but architecturally important seam: it lets
// `buildDragPlan` in view/overlay.js shift this attribute during a
// drag without ever knowing it is dealing with a number — the
// VALUE_TYPE name on the schema row is enough.
const NUMBER = {
  parse: (s) => NUM(s, 0),
  serialise: (v) => String(v),
  default: 0,
  axisAware: true,
  translate: (v, dx, dy, axis) => v + (axis === 'x' ? dx : axis === 'y' ? dy : 0),
};

// Whole-number variant of <number> (types.html §4.5.10), used by
// attributes like `tabindex`. The truncation at write time is the only
// non-obvious part: a fractional drag delta on an integer attribute
// would otherwise round-trip to nonsense, and silently widening to a
// float would surprise readers who later look the value up in the DTD.
const INTEGER = {
  parse: (s) => Math.trunc(NUM(s, 0)),
  serialise: (v) => String(Math.trunc(v)),
  default: 0,
  axisAware: true,
  translate: (v, dx, dy, axis) => Math.trunc(v + (axis === 'x' ? dx : axis === 'y' ? dy : 0)),
};

// A number paired with an optional CSS unit. Number and unit are kept
// separate so a drag adds to the number without disturbing the suffix:
// dragging "10mm" by 5 produces "15mm", not "15". types.html §4.5.11
// defines <length>; the browser resolves the unit (px, pt, em, %, ...)
// against the current viewport when it draws the element, which means
// values like "10mm" only become pixels at render time.
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

// types.html §4.5.6 says <coordinate> is identical in syntax to
// <length>, so the same grammar serves both. The browser likewise
// reuses one parser.
const COORDINATE = LENGTH;

// A colour token — a CSS name, `#rgb`, `#rrggbb`, `rgb(...)`, etc.
// Stored as a raw string and edited literally by the colour widget;
// the browser parses it into an sRGB triplet per types.html §4.5.5
// during painting.
const COLOR = {
  parse: (s) => s ?? '',
  serialise: (v) => v ?? '',
  default: '',
};

// A paint specification: either a colour, or a `url(#id)` pointing at
// a gradient or pattern, optionally followed by a fallback colour.
// Stored verbatim. The browser dereferences the URL at render time,
// walks the paint server (gradient stops, pattern children), and
// produces the pixels — types.html §4.5.13 plus painting.html.
const PAINT = COLOR;

// A scalar opacity, clamped into [0,1]. Out-of-range values are
// pulled back to the legal range here, matching what the browser does
// before it composites — types.html §4.5.12, applied during the group
// and object opacity step described in render.html.
const OPACITY = {
  parse: (s) => Math.max(0, Math.min(1, NUM(s, 1))),
  serialise: (v) => String(v),
  default: 1,
};

// A list of x,y pairs separated by whitespace or commas, used by
// `<polyline>` and `<polygon>`. types.html §4.5.15 calls this
// <list-of-points>; the browser parses it into an SVGPointList and
// strokes or fills the resulting polyline. The translate hook shifts
// every pair by (dx, dy), since both axes always move together for a
// list — the axis-aware mechanism only applies to scalar coordinates.
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

// Shifts the absolute-coordinate operands of an SVG path `d` string
// by (dx, dy). The walker tokenises commands and numbers, then leaves
// relative commands alone — they are deltas from the previous point
// and translating them would move the path twice. The one subtlety is
// the very first lowercase `m`: paths.html §8.3.2 says it is treated
// as absolute, and the closing block at the end of this function
// fixes that case up. The browser parses the same grammar (SVG 2
// deprecated SVGPathSegList, so direct DOM access to segments is gone
// in modern engines) and rasterises each command — line, curve,
// arc — per the per-command rules in paths.html §8.3.
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

// Wraps the path-data translator above as a regular grammar entry.
// Round-tripping is trivial — `d` is just a string — and the work
// lives in the walker; the browser parses the same grammar and
// rasterises the path.
const PATH_DATA = {
  parse: (s) => s ?? '',
  serialise: (v) => v ?? '',
  default: '',
  translate: (v, dx, dy, _axis) => translatePathData(v, dx, dy),
};

// A list of transform functions like `translate(...) rotate(...)`. A
// drag prepends a fresh `translate(dx dy)` rather than reaching in to
// rewrite an existing operation, so the user's earlier rotations and
// scales are preserved exactly. The browser composes the whole list
// left-to-right into the element's current transformation matrix
// (CTM) per coords.html §7.6 and applies it on every render.
const TRANSFORM_LIST = {
  parse: (s) => s ?? '',
  serialise: (v) => v ?? '',
  default: '',
  translate: (v, dx, dy, _axis) => {
    const t = `translate(${dx} ${dy})`;
    return v ? `${t} ${v}` : t;
  },
};

// A two-value enumeration spelled `true`/`false`. Distinct from a JS
// boolean because the wire format is the literal string; the spec
// models this as an enumeration in types.html §4.5 and the browser
// accepts only the two literals.
const BOOLEAN = {
  parse: (s) => s === 'true',
  serialise: (v) => (v ? 'true' : 'false'),
  default: false,
};

// Generic keyword grammar used for everything the spec calls an
// enumerated value (types.html §4.5). The allowed values are not
// fixed by the type — they live on the per-attribute schema row in
// rules/queries.js as `attrInfo.enumValues` — so this grammar is
// deliberately empty of validation and `getWidget` reads the list
// when it builds the dropdown.
const ENUMERATION = {
  parse: (s) => s ?? '',
  serialise: (v) => v ?? '',
  default: '',
};

// Registry: VALUE_TYPE name (as emitted by the schema generator)
// mapped to grammar. This is the seam that lets view/overlay.js drag
// any attribute without knowing its type — the schema yields a type
// name, that name indexes into this table, and the resulting grammar
// is enough to parse, translate, and write the value back. The
// browser keeps an equivalent dispatch table inside its attribute
// parser, hard-coded in C++.
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

// Lookup with a STRING fallback so unknown VALUE_TYPE names degrade
// gracefully into "edit it as text" rather than crashing.
export function getGrammar(typeName) {
  return GRAMMARS[typeName] || STRING;
}

// Probe used by `buildDragPlan` to decide whether an attribute's
// grammar can be translated at all before adding it to the plan.
export function hasOwnTranslate(typeName) {
  return !!GRAMMARS[typeName]?.translate;
}
