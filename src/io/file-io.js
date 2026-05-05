// file-io.js loads an SVG file from disk into an editor Document and
// serialises a Document back out to an `image/svg+xml` Blob the user
// can download.
//
// Inputs:  a File from a `<input type="file">`, or a live Document
// Outputs: a fresh EditorDocument on load; a downloaded blob on export
// Common bugs:
//   - exported file looks different from canvas (default-equal omission)
//   - load fails silently on malformed XML (the parsererror sentinel)
//   - xlink: attributes lost on round-trip (namespace handling below)
//
// prev: src/main.js  ·  next: src/view/canvas.js

import { SVG_NS, defaultOf } from '../rules/index.js';
import { Document as EditorDocument } from '../doc/document.js';

// Reads a File, parses it as SVG via the browser's DOMParser, and
// hands the resulting tree to a fresh EditorDocument. DOMParser
// implements XML 1.0 with namespaces and either returns a fully-formed
// SVG document tree or, on a syntax error, a synthetic `parsererror`
// element nested somewhere inside the result; we surface that as a
// thrown error rather than letting half-parsed garbage reach the
// editor. `adoptNode` reparents the parsed root onto the live page so
// its lifecycle is tied to this document; the parsed sub-tree
// continues to be governed by struct.html §5 (structure), shapes.html
// §9 (geometry), and paths.html §8 (paths) as the browser renders it.
export async function loadSvgFile(file) {
  const text = await file.text();
  const parsed = new DOMParser().parseFromString(text, 'image/svg+xml');
  const err = parsed.querySelector('parsererror');
  if (err) throw new Error('Invalid SVG: ' + err.textContent);
  if (parsed.documentElement.localName !== 'svg') throw new Error('Root is not <svg>');
  const svgRoot = window.document.adoptNode(parsed.documentElement);
  return new EditorDocument(svgRoot);
}

// Builds a serialisable clone of the SVG, omitting attributes whose
// value equals the schema default looked up via `defaultOf` from
// rules/queries.js. Default-equal omission keeps the output minimal
// and matches the spirit of conform.html §2.3.1 ("Conforming SVG
// Generator"): the file we emit must still parse to the same
// rendering, but redundant attributes are dropped so the result is
// smaller and easier to read. Attributes in a non-default namespace
// (`xml:lang`, `xlink:href`, ...) are preserved with their namespace
// URI so XMLSerializer later emits the correct prefix.
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

// Serialises the document and triggers a download. We re-add the
// `xmlns="http://www.w3.org/2000/svg"` attribute on the root if it
// was stripped during cloning — struct.html §5.1.1 requires the SVG
// namespace declaration on the outermost element of a standalone SVG
// document. The Blob carries the registered `image/svg+xml` media
// type from mimereg.html so the browser, the OS file dialog, and any
// downstream tool recognise the file. The XML declaration is optional
// in XML 1.0 but conventional for standalone SVG. The ObjectURL is
// revoked on the next tick once the click has fired, so the blob is
// not held longer than the click handler needs it.
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
