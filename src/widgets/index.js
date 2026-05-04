// One widget factory per VALUE_TYPE from SVG 1.1 chapter 4 "Basic Data
// Types" (types.html). Each factory returns a fresh HTMLElement that
// edits a single attribute value: it takes the current string,
// constructs a control wired to fire `onChange(newValue)` when the user
// commits, and lets the attr-panel forward the new string into
// `doc.setAttribute(...)`. The browser then re-parses that string with
// the corresponding grammar from grammars.js.
//
// UI policy lives here, not in rules/. Each factory has signature
//   (initialValue, onChange) -> HTMLElement
// and `onChange` is called with the new string value; the empty string
// means "clear" so the document falls back to the spec default.

// Plain single-line text field, used for everything the spec models as a
// raw <string>, <CDATA>, <ID>, <IRI> etc. (types.html §4.5.4 and
// neighbours). The browser stores these as opaque DOMStrings; the
// widget gives the user direct access to the literal value.
const textInput = (value, onChange) => {
  const i = document.createElement('input');
  i.type = 'text';
  i.value = value ?? '';
  i.addEventListener('change', () => onChange(i.value));
  return i;
};

// Multi-line text area, used where the value is naturally multi-line —
// `<script>` content (script.html §18) and path `d` strings
// (paths.html §8.3). Same passthrough semantics as `textInput`.
const textArea = (value, onChange) => {
  const t = document.createElement('textarea');
  t.value = value ?? '';
  t.rows = 3;
  t.addEventListener('change', () => onChange(t.value));
  return t;
};

// Numeric stepper for the spec's <number> (types.html §4.5.16) and
// <integer> (§4.5.10). The browser parses the same float-token grammar
// when it later reads the attribute back; the optional `step` argument
// just changes the spinner increment in the UI.
const numberInput = (value, onChange, step = 'any') => {
  const i = document.createElement('input');
  i.type = 'number';
  i.step = String(step);
  i.value = value ?? '';
  i.addEventListener('change', () => onChange(i.value));
  return i;
};

// Compound widget for <color>, <SVGColor> and <paint> (types.html
// §4.5.5 / §4.5.13). The native `<input type="color">` only accepts
// `#rrggbb`, so we pair it with a free-form text field that can carry
// named colours, `rgb(...)` notation, or a `url(#id)` paint reference.
// The browser later resolves whichever form survives — for paint
// references it dereferences the IRI to a paint server (painting.html),
// for colours it converts to sRGB.
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

// Editor for the boolean enumeration (`true` / `false`) used by a
// handful of attributes such as `externalResourcesRequired`. The widget
// emits the literal `"true"` or `"false"` string the browser expects.
const checkboxInput = (value, onChange) => {
  const i = document.createElement('input');
  i.type = 'checkbox';
  i.checked = value === 'true' || value === true;
  i.addEventListener('change', () => onChange(i.checked ? 'true' : 'false'));
  return i;
};

// Factory-of-factories for keyword enumerations like `stroke-linecap`
// or `fill-rule`. The allowed values come from the per-attribute row in
// attindex.html (lifted into our schema as `attrInfo.enumValues`); the
// blank `—` option lets the user clear the attribute, which the browser
// reads as the spec default.
const enumerationInput = (values) => (value, onChange) => {
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
  sel.value = value ?? '';
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
};

// Lookup table from VALUE_TYPE name (as emitted by the schema
// generator) to widget factory. Keys here mirror the keys in
// grammars.js's GRAMMARS table, so the widget for a given attribute
// always edits exactly the form the corresponding grammar expects.
const WIDGETS = {
  CDATA: textInput,
  string: textInput,
  ID: textInput,
  ContentType: textInput,
  LinkTarget: textInput,
  LanguageCode: textInput,
  LanguageCodes: textInput,
  MediaDesc: textInput,
  Script: textArea,
  Text: textArea,
  FeatureList: textInput,
  ExtensionList: textInput,
  EnableBackgroundValue: textInput,
  ClipFillRule: textInput,
  ClipValue: textInput,
  PreserveAspectRatioSpec: textInput,
  ViewBoxSpec: textInput,
  StrokeDashArrayValue: textInput,
  StrokeDashOffsetValue: textInput,
  StrokeMiterLimitValue: (v, oc) => numberInput(v, oc),
  StrokeWidthValue: textInput,

  URI: textInput,
  IRI: textInput,

  Number: (v, oc) => numberInput(v, oc),
  Integer: (v, oc) => numberInput(v, oc, 1),
  Numbers: textInput,
  Lengths: textInput,
  NumberOptionalNumber: textInput,
  NumberOrPercentage: textInput,

  Length: textInput,
  Coordinate: textInput,

  Color: colorInput,
  SVGColor: colorInput,
  Paint: colorInput,
  OpacityValue: (v, oc) => numberInput(v, oc, 0.01),

  Points: textInput,
  PathData: textArea,
  TransformList: textInput,

  Boolean: checkboxInput,
};

// Resolves a VALUE_TYPE name + attribute info to a factory. The
// `enumeration` case is special because the allowed-values list lives
// on the per-attribute row, not the type, so we close over it here and
// return a configured factory. Anything unrecognised falls back to a
// plain text field — same fail-safe philosophy the browser uses when it
// encounters an unknown attribute.
export function getWidget(typeName, attrInfo) {
  if (typeName === 'enumeration') return enumerationInput(attrInfo?.enumValues);
  return WIDGETS[typeName] || textInput;
}
