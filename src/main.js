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

function pickInsertTarget(start, childTag = null) {
  let cursor = start || doc.root;
  if (!childTag) return cursor;
  while (cursor && cursor !== doc.root.parentNode && !canHaveChild(cursor.localName, childTag)) {
    cursor = cursor.parentNode;
  }
  return cursor && cursor.namespaceURI === SVG_NS ? cursor : doc.root;
}

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

function deleteSelected() {
  const sel = doc.selection;
  if (!sel || sel === doc.root) return;
  const parent = sel.parentNode;
  const fallback = sel.previousElementSibling || sel.nextElementSibling || parent;
  doc.remove(sel);
  doc.selection = fallback && fallback.namespaceURI === SVG_NS ? fallback : doc.root;
}

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
