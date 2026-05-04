import { SVG_NS, defaultOf } from '../rules/index.js';
import { Document as EditorDocument } from '../doc/document.js';

export async function loadSvgFile(file) {
  const text = await file.text();
  const parsed = new DOMParser().parseFromString(text, 'image/svg+xml');
  const err = parsed.querySelector('parsererror');
  if (err) throw new Error('Invalid SVG: ' + err.textContent);
  if (parsed.documentElement.localName !== 'svg') throw new Error('Root is not <svg>');
  const svgRoot = window.document.adoptNode(parsed.documentElement);
  return new EditorDocument(svgRoot);
}

// Build a serialisable clone of the SVG, omitting attributes whose value
// equals the schema default.
function exportClone(node) {
  if (node.nodeType === 1) {
    const ns = node.namespaceURI || SVG_NS;
    const clone = window.document.createElementNS(ns, node.localName);
    for (const attr of node.attributes) {
      if (attr.value === defaultOf(attr.localName)) continue;
      if (attr.namespaceURI) clone.setAttributeNS(attr.namespaceURI, attr.name, attr.value);
      else clone.setAttribute(attr.name, attr.value);
    }
    for (const child of node.childNodes) {
      const cloned = exportClone(child);
      if (cloned) clone.appendChild(cloned);
    }
    return clone;
  }
  if (node.nodeType === 3) return window.document.createTextNode(node.nodeValue);
  return null;
}

export function exportSvg(doc, filename = 'drawing.svg') {
  const root = exportClone(doc.root);
  if (!root.getAttribute('xmlns')) root.setAttribute('xmlns', SVG_NS);
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    new XMLSerializer().serializeToString(root);
  const blob = new Blob([xml], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = window.document.createElement('a');
  a.href = url;
  a.download = filename;
  window.document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
