import {
  SVG_NS, XLINK_NS,
  schemaOf, displayTagOf, namespaceOf, defaultOf,
  isModelElement, createModelElement, tagFromDisplay,
} from './registry.js';
import { ELEMENTS } from './schema.generated.js';

const skipped = [];

function applyAttribute(modelEl, name, value) {
  if (value == null) return;
  if (name === 'xmlns' || name.startsWith('xmlns:')) return;
  const ns = namespaceOf(name);
  if (ns) modelEl.setAttributeNS(ns, name, value);
  else modelEl.setAttribute(name, value);
}

export function svgDomToModel(svgEl) {
  const tag = tagFromDisplay(svgEl.localName || svgEl.tagName);
  const schema = ELEMENTS[tag];
  if (!schema) {
    skipped.push(tag);
    return null;
  }
  const modelEl = createModelElement(tag);
  if (!modelEl) {
    skipped.push(tag);
    return null;
  }
  for (const attr of svgEl.attributes) {
    applyAttribute(modelEl, attr.name, attr.value);
  }
  if (schema.contentText) {
    modelEl.textContent = svgEl.textContent || '';
  } else {
    for (const child of svgEl.children) {
      const childModel = svgDomToModel(child);
      if (childModel) modelEl.appendChild(childModel);
    }
  }
  return modelEl;
}

export async function loadSvgFile(file) {
  const text = await file.text();
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error('Invalid SVG: ' + err.textContent);
  const root = doc.documentElement;
  if ((root.localName || root.tagName).toLowerCase() !== 'svg') {
    throw new Error('Root element is not <svg>');
  }
  skipped.length = 0;
  const model = svgDomToModel(root);
  if (skipped.length) {
    // eslint-disable-next-line no-console
    console.warn('[file-io] skipped unknown SVG tags:', [...new Set(skipped)]);
  }
  return model;
}

export function modelToSvgDom(modelEl, isRoot = false) {
  const schema = schemaOf(modelEl);
  if (!schema) return null;
  const svgEl = document.createElementNS(SVG_NS, displayTagOf(modelEl));
  if (isRoot) {
    svgEl.setAttribute('xmlns', SVG_NS);
    if (subtreeUsesXLink(modelEl)) svgEl.setAttribute('xmlns:xlink', XLINK_NS);
  }
  for (const name of modelEl.getAttributeNames()) {
    const value = modelEl.getAttribute(name);
    if (value == null || value === '') continue;
    if (defaultOf(name) === value) continue;
    const ns = namespaceOf(name);
    if (ns) svgEl.setAttributeNS(ns, name, value);
    else svgEl.setAttribute(name, value);
  }
  if (schema.contentText) {
    svgEl.textContent = modelEl.textContent || '';
  } else {
    for (const child of modelEl.children) {
      if (!isModelElement(child)) continue;
      const childSvg = modelToSvgDom(child, false);
      if (childSvg) svgEl.appendChild(childSvg);
    }
  }
  return svgEl;
}

function subtreeUsesXLink(modelEl) {
  for (const name of modelEl.getAttributeNames()) {
    if (namespaceOf(name) === XLINK_NS) return true;
  }
  for (const child of modelEl.children) {
    if (isModelElement(child) && subtreeUsesXLink(child)) return true;
  }
  return false;
}

export function exportSvg(modelRoot, filename = 'drawing.svg') {
  const root = modelToSvgDom(modelRoot, true);
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    new XMLSerializer().serializeToString(root);
  const blob = new Blob([xml], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
