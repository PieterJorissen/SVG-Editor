// widgets/index.js maps SVG VALUE_TYPE names to HTML control
// factories. attr-panel.js calls `getWidget` for each attribute row,
// and the returned factory builds the right control. Each VALUE_TYPE
// here corresponds to a clause of types.html chapter 4.
//
// Inputs:  a VALUE_TYPE name; the per-attribute schema row from
//          rules/queries.js (for enum value lists)
// Outputs: an HTMLElement that fires `onChange(newValue)` when the
//          user commits a new value
// Common bugs:
//   - wrong control for an attribute (WIDGETS map missing entry)
//   - enum dropdown empty (`attrInfo.enumValues` missing)
//   - colour swatch resets to black (#rrggbb-only validation)
//
// prev: src/doc/edit-session.js  ·  next: src/rules/grammars.js

// Plain single-line text field, used for everything the spec models
// as raw text — `<string>`, `<CDATA>`, `<ID>`, `<IRI>` (types.html
// §4.5.4 and neighbours). The browser stores these as opaque
// DOMStrings; the widget gives the user direct access to the literal.
const textInput = (value, onChange) => {
  const i = document.createElement('input');
  i.type = 'text';
  i.value = value ?? '';
  i.addEventListener('change', () => onChange(i.value));
  return i;
};

// Multi-line area, used for naturally multi-line values: path `d`
// strings (paths.html §8.3) and `<script>` content (script.html §18).
// Same passthrough semantics as `textInput`.
const textArea = (value, onChange) => {
  const t = document.createElement('textarea');
  t.value = value ?? '';
  t.rows = 3;
  t.addEventListener('change', () => onChange(t.value));
  return t;
};

// Numeric stepper for the spec's <number> (types.html §4.5.16) and
// <integer> (§4.5.10). The browser later parses the same float-token
// grammar when it reads the attribute back; the optional `step`
// argument only changes the UI spinner increment.
const numberInput = (value, onChange, step = 'any') => {
  const i = document.createElement('input');
  i.type = 'number';
  i.step = String(step);
  i.value = value ?? '';
  i.addEventListener('change', () => onChange(i.value));
  return i;
};

// Compound widget for <color>, <SVGColor>, and <paint> (types.html
// §4.5.5 / §4.5.13). The native `<input type="color">` only accepts
// `#rrggbb`, so we pair it with a free-form text field that can
// carry named colours, `rgb(...)` notation, or a `url(#id)` paint
// reference. The browser later resolves whichever form survives —
// for paint references it dereferences the IRI to a paint server
// (painting.html); for colours it converts to sRGB.
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

// Editor for the boolean enumeration (`true`/`false`) used by a
// handful of attributes such as `externalResourcesRequired`. The
// widget emits the literal `"true"` or `"false"` string the browser
// expects on the wire.
const checkboxInput = (value, onChange) => {
  const i = document.createElement('input');
  i.type = 'checkbox';
  i.checked = value === 'true' || value === true;
  i.addEventListener('change', () => onChange(i.checked ? 'true' : 'false'));
  return i;
};

// Factory-of-factories for keyword enumerations like `stroke-linecap`
// or `fill-rule`. The allowed values come from the per-attribute row
// in attindex.html (lifted into our schema as `attrInfo.enumValues`);
// the blank `—` option lets the user clear the attribute, which the
// browser then reads as the spec default.
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
// generator) to widget factory. The keys here mirror the keys in
// rules/grammars.js's GRAMMARS table, so the widget for a given
// attribute always edits exactly the form the corresponding grammar
// expects.
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

// Resolves a VALUE_TYPE name and attribute info to a factory. The
// `enumeration` case is special because the allowed-values list lives
// on the per-attribute row, not the type, so we close over it here
// and return a configured factory. Anything unrecognised falls back
// to a plain text field — the same fail-safe philosophy the browser
// uses when it encounters an unknown attribute.
export function getWidget(typeName, attrInfo) {
  if (typeName === 'enumeration') return enumerationInput(attrInfo?.enumValues);
  return WIDGETS[typeName] || textInput;
}
