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
// Spec: SVG 1.1 §4 Basic Data Types — vendor/REC-SVG11-20110816/types.html
// Each VALUE_TYPE here mirrors a clause in §4. The browser parses the same
// grammar when an attribute is set, then resolves it during rendering; we
// only need round-trip parse/serialise plus a translate hook for drag.

// Float parser with finite-number guard.
// Browser: applies the same float-token rule throughout §4 grammars.
const NUM = (s, fallback = 0) => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : fallback;
};

// Splits a length token into number + unit suffix.
// Browser: parses the same form per §4.5.11 <length> EBNF.
const LENGTH_RE = /^\s*(-?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*([a-z%]*)\s*$/;

// Opaque CDATA passthrough.
// Browser: stores attribute as a DOMString (§4.5.4 <string>).
const STRING = {
  parse: (s) => s ?? '',
  serialise: (v) => v ?? '',
  default: '',
};

// Plain float, drag-translatable on either axis.
// Browser: parses to IEEE-754 number per §4.5.16 <number>.
const NUMBER = {
  parse: (s) => NUM(s, 0),
  serialise: (v) => String(v),
  default: 0,
  axisAware: true,
  translate: (v, dx, dy, axis) => v + (axis === 'x' ? dx : axis === 'y' ? dy : 0),
};

// Whole-number variant.
// Browser: parses per §4.5.10 <integer>.
const INTEGER = {
  parse: (s) => Math.trunc(NUM(s, 0)),
  serialise: (v) => String(Math.trunc(v)),
  default: 0,
  axisAware: true,
  translate: (v, dx, dy, axis) => Math.trunc(v + (axis === 'x' ? dx : axis === 'y' ? dy : 0)),
};

// Number paired with optional CSS unit suffix.
// Browser: resolves to user units against the current viewport per §4.5.11
// <length> (px/pt/em/% etc. converted at render time).
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

// Same grammar as <length>, used where the spec calls it a coordinate.
// Browser: §4.5.6 <coordinate> is defined as identical to <length>.
const COORDINATE = LENGTH;

// Colour token (named, #rgb, #rrggbb, rgb(), etc.).
// Browser: resolves to sRGB triplet per §4.5.5 <color>.
const COLOR = {
  parse: (s) => s ?? '',
  serialise: (v) => v ?? '',
  default: '',
};

// Either a colour or a paint-server reference (url(#id) [fallback]).
// Browser: dereferences the IRI to a paint server at render time per §4.5.13
// <paint> + chapter painting.html.
const PAINT = COLOR;

// Float clamped to [0,1].
// Browser: clamps and applies during compositing per §4.5.12 <opacity-value>
// + render.html group opacity rules.
const OPACITY = {
  parse: (s) => Math.max(0, Math.min(1, NUM(s, 1))),
  serialise: (v) => String(v),
  default: 1,
};

// Whitespace/comma-separated x,y pairs.
// Browser: parses to an SVGPointList per §4.5.15 <list-of-points>; consumed
// by <polyline>/<polygon>.
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

// Translates the absolute-coordinate operands of an SVG path `d` string.
// Walks command tokens, shifts x/y operands of absolute commands by (dx,dy).
// Relative commands are deltas from the previous point and are not shifted,
// except for an initial lowercase `m` whose first pair is treated as absolute
// per the SVG path grammar.
// Spec: §8.3 path data BNF (paths.html). The browser parses the same grammar
// into an SVGPathSegList (deprecated in SVG 2 but still consumed) and rasterises
// per §8.3.x command semantics.
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

// Path `d` value.
// Browser: parses §8.3 grammar and rasterises commands per their stated semantics.
const PATH_DATA = {
  parse: (s) => s ?? '',
  serialise: (v) => v ?? '',
  default: '',
  translate: (v, dx, dy, _axis) => translatePathData(v, dx, dy),
};

// Sequence of transform functions (translate/rotate/scale/matrix/...).
// Browser: composes into the element's CTM per §7.6 <transform-list>
// (coords.html) and applies during rendering.
// Drag prepends a translate(dx dy) so the element shifts in user space.
const TRANSFORM_LIST = {
  parse: (s) => s ?? '',
  serialise: (v) => v ?? '',
  default: '',
  translate: (v, dx, dy, _axis) => {
    const t = `translate(${dx} ${dy})`;
    return v ? `${t} ${v}` : t;
  },
};

// Boolean attribute (`true` / `false`).
// Browser: enforced as an enumeration on the few attributes that take it
// (§4.5 enumerated values).
const BOOLEAN = {
  parse: (s) => s === 'true',
  serialise: (v) => (v ? 'true' : 'false'),
  default: false,
};

// Generic keyword type — caller supplies the allowed set via attrInfo.
// Browser: matches against the per-attribute keyword list (§4.5 enumerated).
const ENUMERATION = {
  parse: (s) => s ?? '',
  serialise: (v) => v ?? '',
  default: '',
};

// Registry: VALUE_TYPE name (as emitted by the schema generator) -> grammar.
// Browser: equivalent table is hard-coded into the C++ attribute parser.
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

// Lookup by VALUE_TYPE name; falls back to STRING.
export function getGrammar(typeName) {
  return GRAMMARS[typeName] || STRING;
}

// Probe used by drag planning to know whether a translate hook exists.
export function hasOwnTranslate(typeName) {
  return !!GRAMMARS[typeName]?.translate;
}
