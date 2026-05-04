import { SVG_NS, defaultOf } from '../rules/index.js';
import { Document as EditorDocument } from '../doc/document.js';

// Document I/O: parse an external SVG file into an editor Document, and
// serialise an editor Document back to an `image/svg+xml` Blob the user
// can download. The chapter that governs this side of the editor is
// conform.html (chapter 2 "Conformance Criteria") — specifically
// §2.3.1, the "Conforming SVG Generator" class — which says that an
// SVG produced by a generator must be a Conforming SVG Document. The
// cross-refs are struct.html §5.1.1 (the required outer <svg> with the
// SVG namespace) and mimereg.html (the registered `image/svg+xml`
// media type our blob carries).

// Reads a File from a `<input type="file">` and parses it as SVG. The
// browser's DOMParser implements XML 1.0 with namespaces and produces
// a fully-formed SVG document tree if successful, or a synthetic
// `parsererror` element if the file is malformed. We adopt the parsed
// root into the editor's document so its lifecycle (insertion,
// removal) is owned by the live page; the parsed sub-tree continues
// to be governed by struct.html §5 (structure), shapes.html §9
// (shape elements), paths.html §8 (paths), etc., as the browser
// renders it.
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
// value equals the schema default. Default-equal omission keeps the
// output minimal and matches the spirit of conform.html §2.3.1's
// "Conforming SVG Generator" class — the document we emit must still
// parse to the same rendering, but we drop redundant attributes so the
// file is smaller and easier to read. attindex.html supplies the
// per-attribute defaults we compare against.
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
// type defined in mimereg.html so the browser, the OS file dialog,
// and any downstream tool recognise the file. The XML declaration
// (`<?xml ... ?>`) is optional in XML 1.0 but conventional for
// standalone SVG files.
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
