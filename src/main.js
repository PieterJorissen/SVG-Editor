// Entrypoint. Wires the layers together and turns user gestures
// (toolbar clicks, file picker, key presses) into method calls on the
// modules below. Owns no domain logic of its own.
//
// Inputs:  DOM elements from index.html; toolbar/keyboard/file events
// Outputs: a live editor — Document, Canvas, Overlay, Tree, Attr panels
// Common bugs:
//   - editor never appears (element id drift vs index.html)
//   - insert dropdown empty (rules/queries.js content-model filter)
//   - delete leaves dead selection (fallback logic in deleteSelected)
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

// Disposes the previous wiring (so observers, listeners, and pointer
// captures do not leak across documents) and instantiates fresh
// Canvas, Overlay, TreePanel, and AttrPanel against the new Document.
// Order matters: panels go before the Document, because their
// `dispose` hooks unsubscribe from Document events. Selection is set
// to the root `<svg>` after construction; struct.html §5 "Document
// Structure" treats the outermost `<svg>` as a regular structural
// element with attributes and children, so it is a valid initial
// selection target. struct.html is the lead chapter for everything
// this file does: `<svg>`, `<g>`, `<defs>`, `<use>` and the way they
// nest are the structural model the editor is wiring up.
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

// Repopulates the insert-element dropdown based on what the spec
// allows as a child of the current insertion target. The list comes
// from `elementsAcceptedBy` in rules/queries.js, which evaluates the
// DTD content model from svgdtd.html. The browser does not enforce
// content models at runtime — it will happily render an illegal
// child — so this filtering is purely an editor affordance to keep
// users from producing schema-invalid trees.
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

// Walks the ancestor chain looking for the nearest element whose
// content model accepts `childTag`. If none of the ancestors do, it
// falls back to the document root — a sensible default since the
// root `<svg>` accepts the structure and shape categories. Without a
// `childTag` the function just returns the current selection
// unchanged. Same content-model source as `refreshInsertOptions`
// above (svgdtd.html).
function pickInsertTarget(start, childTag = null) {
  let cursor = start || doc.root;
  if (!childTag) return cursor;
  while (cursor && cursor !== doc.root.parentNode && !canHaveChild(cursor.localName, childTag)) {
    cursor = cursor.parentNode;
  }
  return cursor && cursor.namespaceURI === SVG_NS ? cursor : doc.root;
}

// Builds the starter document the editor opens with. The root `<svg>`
// declares its viewport via `width`/`height` and a matching
// `viewBox` — the establishing-viewport rule from coords.html §7.2 —
// and the children are canonical examples of each shape category
// from shapes.html §9 plus a `<text>` from text.html §10. The result
// is itself a Conforming SVG Document per conform.html §2.3.1: the
// SVG namespace is set, and only schema-declared elements and
// attributes are used. Once Canvas mounts the live SVG, the browser
// renders it according to those chapters.
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

// Toolbar dispatcher. Click events on the toolbar surface — load,
// export, insert, delete — are funnelled here. The button-vs-other
// guard keeps the listener from firing on layout chrome. Each branch
// turns one user gesture into one method call: file-io for load and
// export, the Document's tree mutators for insert and delete. Insert
// also runs through `pickInsertTarget` so a click on a leaf shape
// still produces a schema-valid placement.
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

// Removes the current selection from the document and picks a
// sensible fallback (previous sibling, next sibling, or parent). The
// browser handles the actual unlinking via `el.remove()`; the
// MutationObserver inside Document then fires a `change` event that
// repaints the tree and attribute panels.
function deleteSelected() {
  const sel = doc.selection;
  if (!sel || sel === doc.root) return;
  const parent = sel.parentNode;
  const fallback = sel.previousElementSibling || sel.nextElementSibling || parent;
  doc.remove(sel);
  doc.selection = fallback && fallback.namespaceURI === SVG_NS ? fallback : doc.root;
}

// File picker → `loadSvgFile` → `bootstrap`. The hidden input is
// triggered from the toolbar handler above; when the user picks a
// file, it is handed to the loader (which uses DOMParser per
// conform.html's parsing requirements) and the editor is rebuilt
// around the resulting Document. The input value is reset so picking
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

// Keyboard shortcuts. `Delete`/`Backspace` removes the selection,
// `Escape` clears it back to the root. The in-field guard keeps
// native typing alive inside `<input>`, `<textarea>`, and `<select>`
// — those should retain their built-in key handling — so the
// shortcut is only active when focus is outside any form control.
// Browser-level key dispatch is described in interact.html §16.5.
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
