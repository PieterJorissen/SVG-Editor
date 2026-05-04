// Per-VALUE_TYPE widget factories. UI policy lives here, not in rules/.
// Each factory: (initialValue, onChange) -> HTMLElement.
// onChange is called with the new string value; the empty string means "clear".

const textInput = (value, onChange) => {
  const i = document.createElement('input');
  i.type = 'text';
  i.value = value ?? '';
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

const checkboxInput = (value, onChange) => {
  const i = document.createElement('input');
  i.type = 'checkbox';
  i.checked = value === 'true' || value === true;
  i.addEventListener('change', () => onChange(i.checked ? 'true' : 'false'));
  return i;
};

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

// Mapping VALUE_TYPE name -> widget factory.
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

export function getWidget(typeName, attrInfo) {
  if (typeName === 'enumeration') return enumerationInput(attrInfo?.enumValues);
  return WIDGETS[typeName] || textInput;
}
