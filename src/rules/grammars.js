// Per-VALUE_TYPE grammars: parse / serialise / default / translate.
// Pure data and pure functions. No DOM, no widgets — those live in src/widgets/.
//
//   parse(s)                    — string -> typed value
//   serialise(v)                — typed value -> string
//   default                     — typed default
//   axisAware                   — true if translate honours the `axis` argument
//   translate?(v, dx, dy, axis) — for compound types (Points, PathData,
//                                 TransformList) axis is ignored — both
//                                 deltas apply. For scalar coordinate types
//                                 (Length, Coordinate, Number) axis ∈
//                                 {'x','y',null} selects which delta to add;
//                                 null leaves the value unchanged.
//
// Each grammar in this file mirrors one clause of SVG 1.1 chapter 4 "Basic
// Data Types" (types.html). The browser carries an equivalent table inside
// its attribute parser; we only need round-trip parse/serialise plus a
// translate hook so dragging a shape can rewrite the value in place.

// Reads a float with a finite-number guard. The same float-token rule
// appears throughout the chapter-4 grammars — every numeric leaf in the
// spec ultimately reduces to "an optionally signed decimal", which is what
// the browser's attribute parser also accepts.
const NUM = (s, fallback = 0) => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : fallback;
};

// Splits a length token into its number part and unit suffix. The shape
// matches the <length> EBNF in types.html §4.5.11; the browser parses the
// same form and remembers the unit so it can convert at render time.
const LENGTH_RE = /^\s*(-?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*([a-z%]*)\s*$/;

// Opaque text passed straight through. Covers everything the spec calls a
// <string>, <CDATA> or named token (types.html §4.5.4); the browser stores
// these as a DOMString and never interprets them.
const STRING = {
  parse: (s) => s ?? '',
  serialise: (v) => v ?? '',
  default: '',
};

// A plain float, draggable on either axis. The spec's <number>
// (types.html §4.5.16) is just an IEEE-754 value; the browser parses it
// and feeds it directly into geometry.
const NUMBER = {
  parse: (s) => NUM(s, 0),
  serialise: (v) => String(v),
  default: 0,
  axisAware: true,
  translate: (v, dx, dy, axis) => v + (axis === 'x' ? dx : axis === 'y' ? dy : 0),
};

// Whole-number variant of <number>, used by attributes like `tabindex`.
// The spec defines <integer> in types.html §4.5.10; the browser truncates
// non-integers when parsing.
const INTEGER = {
  parse: (s) => Math.trunc(NUM(s, 0)),
  serialise: (v) => String(Math.trunc(v)),
  default: 0,
  axisAware: true,
  translate: (v, dx, dy, axis) => Math.trunc(v + (axis === 'x' ? dx : axis === 'y' ? dy : 0)),
};

// A number paired with an optional CSS unit. We keep number and unit
// separate so a drag adds to the number without disturbing the suffix.
// types.html §4.5.11 defines <length>; the browser resolves the unit
// (px, pt, em, %, …) against the current viewport when it draws the
// element, so a value like "10mm" only becomes pixels at render time.
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

// types.html §4.5.6 says <coordinate> is identical in syntax to <length>,
// so the same grammar serves both. The browser likewise reuses one parser.
const COORDINATE = LENGTH;

// A colour token — a name, `#rgb`, `#rrggbb`, `rgb(...)`, etc. We keep it
// as a raw string and let the colour widget edit it. The browser parses
// it into an sRGB triplet per types.html §4.5.5 and uses it during
// painting.
const COLOR = {
  parse: (s) => s ?? '',
  serialise: (v) => v ?? '',
  default: '',
};

// A paint specification: either a colour, or a `url(#id)` pointing at a
// gradient or pattern, optionally followed by a fallback colour. We store
// it verbatim. The browser dereferences the URL at render time, walks
// the paint server (gradient stops, pattern children), and produces the
// pixels — types.html §4.5.13 plus painting.html.
const PAINT = COLOR;

// A scalar opacity, clamped into [0,1]. Out-of-range values are pulled
// back to the legal range here, matching what the browser does before it
// composites — types.html §4.5.12, applied during the group/object
// opacity step described in render.html.
const OPACITY = {
  parse: (s) => Math.max(0, Math.min(1, NUM(s, 1))),
  serialise: (v) => String(v),
  default: 1,
};

// A list of x,y pairs separated by whitespace or commas. Used by
// <polyline> and <polygon>. types.html §4.5.15 calls this
// <list-of-points>; the browser parses it into an SVGPointList and
// strokes/fills the resulting polyline.
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

// Shifts the absolute-coordinate operands of an SVG path `d` string by
// (dx, dy). Walks the command tokens, leaves relative commands alone
// because they are deltas from the previous point, but treats the very
// first lowercase `m` as absolute since that is what the SVG path grammar
// actually says (paths.html §8.3.2). The browser parses the same grammar
// into an SVGPathSegList and rasterises each command — line, curve, arc —
// according to the per-command rules in paths.html §8.3.
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

// Wraps the path-data translator as a regular grammar entry. Round-tripping
// is trivial — `d` is just a string — and translate defers to the walker
// above. The browser parses the same grammar and rasterises the path.
const PATH_DATA = {
  parse: (s) => s ?? '',
  serialise: (v) => v ?? '',
  default: '',
  translate: (v, dx, dy, _axis) => translatePathData(v, dx, dy),
};

// A list of transform functions like `translate(...) rotate(...)`.
// Drag prepends a `translate(dx dy)` so the element shifts in user space
// without clobbering whatever transforms were already there. The browser
// composes the list into the element's current transformation matrix
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

// A two-value enumeration spelled `true` / `false`. The spec models this
// as a tiny enumeration in types.html §4.5; the browser accepts only the
// two literals.
const BOOLEAN = {
  parse: (s) => s === 'true',
  serialise: (v) => (v ? 'true' : 'false'),
  default: false,
};

// Generic keyword grammar — the allowed values come from the schema's
// per-attribute enum list. types.html §4.5 covers enumerated values; the
// browser matches the input against the list and rejects anything else.
const ENUMERATION = {
  parse: (s) => s ?? '',
  serialise: (v) => v ?? '',
  default: '',
};

// The lookup table from VALUE_TYPE name (as emitted by the schema
// generator) to grammar. The browser keeps an equivalent dispatch table
// hard-coded inside its attribute parser.
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

// Looks up a grammar by VALUE_TYPE name, falling back to STRING for
// anything the generator hasn't classified.
export function getGrammar(typeName) {
  return GRAMMARS[typeName] || STRING;
}

// Tells drag planning whether a translate hook exists for this type.
export function hasOwnTranslate(typeName) {
  return !!GRAMMARS[typeName]?.translate;
}
