// Entrypoint. Wires the layers together; owns no domain logic.
//
// Inputs:  DOM elements from index.html; toolbar/keyboard/file events
// Outputs: live editor — Document, Canvas, Overlay, Tree, Attr panels
// Common bugs:
//   - editor never appears (element id drift vs index.html)
//   - insert dropdown empty (rules/queries.js content-model filter)
//   - delete leaves dead selection (fallback logic below)
//   - file load doesn't replace state (bootstrap dispose order)
//
// prev: (set at end of Phase C)  ·  next: (set at end of Phase C)

import { SVG_NS, canHaveChild, elementsAcceptedBy } from './rules/index.js';
import { Document as EditorDocument } from './doc/document.js';
import { Canvas } from './view/canvas.js';
import { Overlay } from './view/overlay.js';
import { TreePanel } from './view/tree-panel.js';
import { AttrPanel } from './view/attr-panel.js';
import { loadSvgFile, exportSvg } from './io/file-io.js';

const svgHost = window.document.getElementById('svg-host');
const overlayEl = window.document.getElementById('overlay');
const outlineEl = window.document.getElementById('selection-outline');
const treeHost = window.document.getElementById('tree-panel');
const attrHost = window.document.getElementById('attr-panel');
const fileInput = window.document.getElementById('file-input');
const insertSelect = window.document.getElementById('insert-tag');

let doc;
let canvas;
let overlay;
let tree;
let attrs;

// Disposes the previous wiring and rebuilds against a new Document.
// Order matters: panels go before the Document, because their dispose
// hooks unsubscribe from the Document's events.
function bootstrap(nextDoc) {
  if (overlay) overlay.dispose();
  if (canvas) canvas.dispose();
  if (tree) tree.dispose();
  if (attrs) attrs.dispose();
  if (doc) doc.dispose();

  doc = nextDoc;
  canvas = new Canvas(doc, svgHost);
  overlay = new Overlay(overlayEl, outlineEl, doc);
  tree = new TreePanel(treeHost, doc);
  attrs = new AttrPanel(attrHost, doc);

  doc.addEventListener('selectionchange', refreshInsertOptions);
  doc.selection = doc.root;
  refreshInsertOptions();
}

// Repopulates the insert dropdown from elementsAcceptedBy. The browser
// does not enforce content models at runtime; this filter is purely an
// editor affordance to keep schema-invalid trees out of the document.
function refreshInsertOptions() {
  const target = pickInsertTarget(doc.selection || doc.root);
  const tags = elementsAcceptedBy(target.localName);
  const previous = insertSelect.value;
  insertSelect.replaceChildren();
  for (const tag of tags) {
    const option = window.document.createElement('option');
    option.value = tag;
    option.textContent = tag;
    insertSelect.appendChild(option);
  }
  if (tags.includes(previous)) insertSelect.value = previous;
}

// Walks ancestors looking for the nearest element whose content model
// admits `childTag`, falling back to the document root. Without a
// `childTag` the function just returns the current selection.
function pickInsertTarget(start, childTag = null) {
  let cursor = start || doc.root;
  if (!childTag) return cursor;
  while (cursor && cursor !== doc.root.parentNode && !canHaveChild(cursor.localName, childTag)) {
    cursor = cursor.parentNode;
  }
  return cursor && cursor.namespaceURI === SVG_NS ? cursor : doc.root;
}

// Builds the starter document the editor opens with. The root carries
// `width`/`height` and a matching `viewBox`, which the browser uses to
// establish the outermost viewport (coords.html §7.2).
function defaultDocument() {
  const svg = window.document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', '800');
  svg.setAttribute('height', '600');
  svg.setAttribute('viewBox', '0 0 800 600');
  const newDoc = new EditorDocument(svg);

  const rect = newDoc.createElement('rect', { x: 80, y: 80, width: 220, height: 140, rx: 12, fill: '#4f8cff' });
  newDoc.appendChild(svg, rect);
  const circle = newDoc.createElement('circle', { cx: 480, cy: 200, r: 90, fill: '#ef4444' });
  newDoc.appendChild(svg, circle);
  const ellipse = newDoc.createElement('ellipse', { cx: 220, cy: 400, rx: 120, ry: 60, fill: '#22c55e' });
  newDoc.appendChild(svg, ellipse);
  const text = newDoc.createElement('text', { x: 420, y: 420, 'font-size': 36, fill: '#111111' });
  newDoc.setText(text, 'Hello, SVG');
  newDoc.appendChild(svg, text);

  newDoc.markClean();
  return newDoc;
}

bootstrap(defaultDocument());

// Toolbar dispatcher. Each branch turns one user gesture into one
// method call; insert + delete go through Document so the
// MutationObserver fires and the panels refresh.
window.document.querySelector('#toolbar').addEventListener('click', async (e) => {
  const button = e.target;
  if (!(button instanceof HTMLButtonElement)) return;
  const action = button.dataset.action;

  if (action === 'load') {
    fileInput.click();
  } else if (action === 'export') {
    exportSvg(doc);
  } else if (action === 'delete') {
    deleteSelected();
  } else if (action === 'insert') {
    const tag = insertSelect.value;
    if (!tag) return;
    const target = pickInsertTarget(doc.selection || doc.root, tag);
    const newEl = doc.createElement(tag);
    if (tag === 'text') doc.setText(newEl, 'Text');
    doc.appendChild(target, newEl);
    doc.selection = newEl;
  }
});

// Removes the selection and picks a sensible fallback (previous
// sibling, next sibling, or parent). The browser handles the unlink
// via `el.remove()`; the Document's MutationObserver handles the rest.
function deleteSelected() {
  const sel = doc.selection;
  if (!sel || sel === doc.root) return;
  const parent = sel.parentNode;
  const fallback = sel.previousElementSibling || sel.nextElementSibling || parent;
  doc.remove(sel);
  doc.selection = fallback && fallback.namespaceURI === SVG_NS ? fallback : doc.root;
}

// File picker → loadSvgFile → bootstrap. The input is reset so picking
// the same file twice still triggers a `change` event.
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  try {
    const newDoc = await loadSvgFile(file);
    bootstrap(newDoc);
  } catch (err) {
    alert(err.message || String(err));
  } finally {
    fileInput.value = '';
  }
});

// Keyboard shortcuts. The in-field guard keeps native typing alive
// inside `<input>`, `<textarea>`, and `<select>`; outside those,
// Delete/Backspace remove the selection and Escape clears it.
window.document.addEventListener('keydown', (e) => {
  const inField = window.document.activeElement
    && ['INPUT', 'TEXTAREA', 'SELECT'].includes(window.document.activeElement.tagName);
  if (inField) return;
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (doc.selection && doc.selection !== doc.root) {
      deleteSelected();
      e.preventDefault();
    }
  } else if (e.key === 'Escape') {
    doc.selection = doc.root;
  }
});
