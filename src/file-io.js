import { SVG_NS, TAG_BY_SVG, classOf, isModelElement } from './registry.js';

export function svgDomToModel(svgEl) {
  const tag = svgEl.tagName.toLowerCase();
  const customTag = TAG_BY_SVG[tag];
  if (!customTag) return null;
  const el = document.createElement(customTag);
  for (const a of svgEl.attributes) {
    if (a.name === 'xmlns' || a.name.startsWith('xmlns:')) continue;
    el.setAttribute(a.name, a.value);
  }
  const cls = el.constructor;
  if (cls.hasText) {
    el.textContent = svgEl.textContent || '';
  } else {
    for (const child of svgEl.children) {
      const cm = svgDomToModel(child);
      if (cm) el.appendChild(cm);
    }
  }
  return el;
}

export async function loadSvgFile(file) {
  const text = await file.text();
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error('Invalid SVG: ' + err.textContent);
  const root = doc.documentElement;
  if (root.tagName.toLowerCase() !== 'svg') throw new Error('Root element is not <svg>');
  return svgDomToModel(root);
}

export function modelToSvgDom(model) {
  const cls = classOf(model);
  const el = document.createElementNS(SVG_NS, cls.svgTag);
  for (const name of model.getAttributeNames()) {
    const v = model.getAttribute(name);
    if (v != null && v !== '') el.setAttribute(name, v);
  }
  if (cls.hasText) {
    el.textContent = model.textContent || '';
  } else {
    for (const child of model.children) {
      if (isModelElement(child)) el.appendChild(modelToSvgDom(child));
    }
  }
  return el;
}

export function exportSvg(modelRoot, filename = 'drawing.svg') {
  const root = modelToSvgDom(modelRoot);
  if (!root.getAttribute('xmlns')) root.setAttribute('xmlns', SVG_NS);
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
