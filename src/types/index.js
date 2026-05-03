// Per-VALUE_TYPE registry. Each entry implements:
//   parse(s)     — string -> typed value
//   serialise(v) — typed value -> string
//   default      — the default typed value
//   widget(value, onChange) -> HTMLElement
//   translate?(value, dx, dy) — present only on geometry types whose value
//                               carries both axes (Points, PathData, TransformList).
//                               Scalar coordinate types (Length, Coordinate, Number)
//                               are translated by the registry.axisOf() helper, since
//                               the type alone cannot decide x vs y.
//
// All widgets emit on `change` (commit on blur), not `input`, so live drag
// edits don't fight a re-rendering attribute panel.

const NUM = (s, fallback = 0) => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : fallback;
};

const LENGTH_RE = /^\s*(-?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*([a-z%]*)\s*$/;

const textInput = (value, onChange, attrs = {}) => {
  const i = document.createElement('input');
  i.type = 'text';
  i.value = value ?? '';
  for (const [k, v] of Object.entries(attrs)) i.setAttribute(k, v);
  i.addEventListener('change', () => onChange(i.value));
  return i;
};

const textArea = (value, onChange) => {
  const t = document.createElement('textarea');
  t.value = value ?? '';
  t.rows = 3;
  t.addEventListener('change', () => onChange(t.value));
  return t;
};

const numberInput = (value, onChange, step = 'any') => {
  const i = document.createElement('input');
  i.type = 'number';
  i.step = String(step);
  i.value = value ?? '';
  i.addEventListener('change', () => onChange(i.value));
  return i;
};

const colorInput = (value, onChange) => {
  const wrap = document.createElement('span');
  wrap.style.display = 'flex';
  wrap.style.gap = '4px';
  const swatch = document.createElement('input');
  swatch.type = 'color';
  swatch.value = /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#000000';
  const text = document.createElement('input');
  text.type = 'text';
  text.value = value ?? '';
  text.style.flex = '1';
  swatch.addEventListener('change', () => { text.value = swatch.value; onChange(swatch.value); });
  text.addEventListener('change', () => {
    if (/^#[0-9a-f]{6}$/i.test(text.value)) swatch.value = text.value;
    onChange(text.value);
  });
  wrap.appendChild(swatch);
  wrap.appendChild(text);
  return wrap;
};

const STRING_TYPE = {
  parse: (s) => s ?? '',
  serialise: (v) => v ?? '',
  default: '',
  widget: textInput,
};

const NUMBER_TYPE = {
  parse: (s) => NUM(s, 0),
  serialise: (v) => String(v),
  default: 0,
  widget: (v, oc) => numberInput(v, oc),
};

const INTEGER_TYPE = {
  parse: (s) => Math.trunc(NUM(s, 0)),
  serialise: (v) => String(Math.trunc(v)),
  default: 0,
  widget: (v, oc) => numberInput(v, oc, 1),
};

const LENGTH_TYPE = {
  parse: (s) => {
    if (s == null || s === '') return { n: 0, unit: '' };
    const m = LENGTH_RE.exec(String(s));
    if (!m) return { n: NUM(s, 0), unit: '' };
    return { n: parseFloat(m[1]), unit: m[2] || '' };
  },
  serialise: ({ n, unit }) => `${n}${unit || ''}`,
  default: { n: 0, unit: '' },
  widget: textInput,
};

// Coordinate is structurally identical to Length in SVG 1.1.
const COORDINATE_TYPE = LENGTH_TYPE;

const COLOR_TYPE = {
  parse: (s) => s ?? '',
  serialise: (v) => v ?? '',
  default: '',
  widget: colorInput,
};

const PAINT_TYPE = COLOR_TYPE;

const OPACITY_TYPE = {
  parse: (s) => Math.max(0, Math.min(1, NUM(s, 1))),
  serialise: (v) => String(v),
  default: 1,
  widget: (v, oc) => numberInput(v, oc, 0.01),
};

const POINTS_TYPE = {
  parse: (s) => {
    if (!s) return [];
    const nums = String(s).trim().split(/[\s,]+/).filter(Boolean).map(parseFloat);
    const pts = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
    return pts;
  },
  serialise: (pts) => pts.map(([x, y]) => `${x},${y}`).join(' '),
  default: [],
  translate: (pts, dx, dy) => pts.map(([x, y]) => [x + dx, y + dy]),
  widget: textInput,
};

// Path-data is kept as opaque string. Translate prepends a relative move using
// a leading absolute Mx,y followed by translated subsequent commands when the
// path begins with absolute M; for everything else we wrap with a transform.
// Implementation: walk and shift only absolute-coordinate commands' operand pairs.
function translatePathData(d, dx, dy) {
  if (!d) return d;
  // Token regex: command letter or signed number.
  const tokens = String(d).match(/[MmLlHhVvCcSsQqTtAaZz]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g);
  if (!tokens) return d;
  let cmd = '';
  let absoluteFirstM = false;
  let i = 0;
  const out = [];
  // SVG path command operand patterns (per command, args per coordinate set).
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
    // Read one operand set.
    const set = tokens.slice(i, i + shape.length);
    if (set.length < shape.length) { out.push(...tokens.slice(i)); break; }
    for (let j = 0; j < shape.length; j++) {
      let n = parseFloat(set[j]);
      if (isAbs && shape[j] === 'x') n += dx;
      else if (isAbs && shape[j] === 'y') n += dy;
      out.push(String(n));
    }
    i += shape.length;
    // Implicit-repeat: M switches to L, others repeat themselves.
    if (cmd === 'M') cmd = 'L';
    else if (cmd === 'm') cmd = 'l';
  }
  // Relative paths: translate only the first 'm' if present, since subsequent
  // relative coords are deltas from the previous point.
  if (!absoluteFirstM && tokens[0]?.toLowerCase() === 'm') {
    // Already handled above for absolute branch; for lowercase initial m the
    // first pair is treated as absolute by the SVG spec.
    const idx = out.indexOf('m');
    if (idx >= 0 && idx + 2 < out.length) {
      out[idx + 1] = String(parseFloat(out[idx + 1]) + dx);
      out[idx + 2] = String(parseFloat(out[idx + 2]) + dy);
    }
  }
  return out.join(' ');
}

const PATH_DATA_TYPE = {
  parse: (s) => s ?? '',
  serialise: (v) => v ?? '',
  default: '',
  translate: (v, dx, dy) => translatePathData(v, dx, dy),
  widget: textArea,
};

const TRANSFORM_LIST_TYPE = {
  parse: (s) => s ?? '',
  serialise: (v) => v ?? '',
  default: '',
  translate: (v, dx, dy) => {
    const t = `translate(${dx} ${dy})`;
    return v ? `${t} ${v}` : t;
  },
  widget: textInput,
};

const enumerationType = (values) => ({
  parse: (s) => s ?? '',
  serialise: (v) => v ?? '',
  default: values?.[0] ?? '',
  widget: (val, onChange) => {
    const sel = document.createElement('select');
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = '—';
    sel.appendChild(blank);
    for (const v of values || []) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = v;
      sel.appendChild(o);
    }
    sel.value = val ?? '';
    sel.addEventListener('change', () => onChange(sel.value));
    return sel;
  },
});

const TYPES = {
  // Pass-through string-like.
  CDATA: STRING_TYPE,
  string: STRING_TYPE,
  ID: STRING_TYPE,
  ContentType: STRING_TYPE,
  LinkTarget: STRING_TYPE,
  LanguageCode: STRING_TYPE,
  LanguageCodes: STRING_TYPE,
  MediaDesc: STRING_TYPE,
  Script: { ...STRING_TYPE, widget: textArea },
  Text: { ...STRING_TYPE, widget: textArea },
  FeatureList: STRING_TYPE,
  ExtensionList: STRING_TYPE,
  EnableBackgroundValue: STRING_TYPE,
  ClipFillRule: STRING_TYPE,
  ClipValue: STRING_TYPE,
  PreserveAspectRatioSpec: STRING_TYPE,
  ViewBoxSpec: STRING_TYPE,
  StrokeDashArrayValue: STRING_TYPE,
  StrokeDashOffsetValue: LENGTH_TYPE,
  StrokeMiterLimitValue: NUMBER_TYPE,
  StrokeWidthValue: LENGTH_TYPE,

  // URI-like.
  URI: STRING_TYPE,
  IRI: STRING_TYPE,

  // Numeric scalars.
  Number: NUMBER_TYPE,
  Integer: INTEGER_TYPE,
  Numbers: STRING_TYPE,
  Lengths: STRING_TYPE,
  NumberOptionalNumber: STRING_TYPE,
  NumberOrPercentage: STRING_TYPE,

  // Geometry scalars (translation handled by axisOf, not by type).
  Length: LENGTH_TYPE,
  Coordinate: COORDINATE_TYPE,

  // Color / paint.
  Color: COLOR_TYPE,
  SVGColor: COLOR_TYPE,
  Paint: PAINT_TYPE,
  OpacityValue: OPACITY_TYPE,

  // Compound geometry — own translate.
  Points: POINTS_TYPE,
  PathData: PATH_DATA_TYPE,
  TransformList: TRANSFORM_LIST_TYPE,

  Boolean: {
    parse: (s) => s === 'true',
    serialise: (v) => (v ? 'true' : 'false'),
    default: false,
    widget: (val, onChange) => {
      const i = document.createElement('input');
      i.type = 'checkbox';
      i.checked = val === 'true' || val === true;
      i.addEventListener('change', () => onChange(i.checked ? 'true' : 'false'));
      return i;
    },
  },

  enumeration: enumerationType(),
};

export function getType(typeName, attrInfo) {
  if (typeName === 'enumeration' && attrInfo?.enumValues) {
    return enumerationType(attrInfo.enumValues);
  }
  return TYPES[typeName] || STRING_TYPE;
}

export function hasOwnTranslate(typeName) {
  const t = TYPES[typeName];
  return !!(t && t.translate);
}
