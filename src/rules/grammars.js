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

const NUM = (s, fallback = 0) => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : fallback;
};

const LENGTH_RE = /^\s*(-?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*([a-z%]*)\s*$/;

const STRING = {
  parse: (s) => s ?? '',
  serialise: (v) => v ?? '',
  default: '',
};

const NUMBER = {
  parse: (s) => NUM(s, 0),
  serialise: (v) => String(v),
  default: 0,
  axisAware: true,
  translate: (v, dx, dy, axis) => v + (axis === 'x' ? dx : axis === 'y' ? dy : 0),
};

const INTEGER = {
  parse: (s) => Math.trunc(NUM(s, 0)),
  serialise: (v) => String(Math.trunc(v)),
  default: 0,
  axisAware: true,
  translate: (v, dx, dy, axis) => Math.trunc(v + (axis === 'x' ? dx : axis === 'y' ? dy : 0)),
};

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

const COORDINATE = LENGTH;

const COLOR = {
  parse: (s) => s ?? '',
  serialise: (v) => v ?? '',
  default: '',
};

const PAINT = COLOR;

const OPACITY = {
  parse: (s) => Math.max(0, Math.min(1, NUM(s, 1))),
  serialise: (v) => String(v),
  default: 1,
};

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

// Translate the absolute-coordinate operands of an SVG path `d` string.
// Walks command tokens, shifts x/y operands of absolute commands by (dx,dy).
// Relative commands are deltas from the previous point and are not shifted,
// except for an initial lowercase `m` whose first pair is treated as absolute
// per the SVG path grammar.
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

const PATH_DATA = {
  parse: (s) => s ?? '',
  serialise: (v) => v ?? '',
  default: '',
  translate: (v, dx, dy, _axis) => translatePathData(v, dx, dy),
};

const TRANSFORM_LIST = {
  parse: (s) => s ?? '',
  serialise: (v) => v ?? '',
  default: '',
  translate: (v, dx, dy, _axis) => {
    const t = `translate(${dx} ${dy})`;
    return v ? `${t} ${v}` : t;
  },
};

const BOOLEAN = {
  parse: (s) => s === 'true',
  serialise: (v) => (v ? 'true' : 'false'),
  default: false,
};

const ENUMERATION = {
  parse: (s) => s ?? '',
  serialise: (v) => v ?? '',
  default: '',
};

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

export function getGrammar(typeName) {
  return GRAMMARS[typeName] || STRING;
}

export function hasOwnTranslate(typeName) {
  return !!GRAMMARS[typeName]?.translate;
}
