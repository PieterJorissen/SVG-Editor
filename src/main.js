import {
  createModelElement, schemaOf, tagOf, isModelElement,
  canHaveChild, elementsAcceptedBy,
} from './registry.js';
import { Renderer } from './renderer.js';
import { Overlay } from './overlay.js';
import { TreePanel } from './tree-panel.js';
import { AttrPanel } from './attr-panel.js';
import { loadSvgFile, exportSvg } from './file-io.js';

const modelRootHost = document.getElementById('model-root');
const svgHost = document.getElementById('svg-host');
const overlayEl = document.getElementById('overlay');
const outlineEl = document.getElementById('selection-outline');
const treeHost = document.getElementById('tree-panel');
const attrHost = document.getElementById('attr-panel');
const fileInput = document.getElementById('file-input');
const insertSelect = document.getElementById('insert-tag');

let modelRoot;
let renderer;
let overlay;
let tree;
let attrs;
let selected = null;

function setSelected(modelElement) {
  selected = modelElement;
  overlay.select(modelElement);
  tree.setSelected(modelElement);
  attrs.setModel(modelElement);
  refreshInsertOptions();
}

function refreshInsertOptions() {
  const insertTarget = pickInsertTarget(selected || modelRoot);
  const tags = elementsAcceptedBy(insertTarget);
  const previous = insertSelect.value;
  insertSelect.replaceChildren();
  for (const tag of tags) {
    const option = document.createElement('option');
    option.value = tag;
    option.textContent = tag;
    insertSelect.appendChild(option);
  }
  if (tags.includes(previous)) insertSelect.value = previous;
}

// Walk up from a starting element to the nearest ancestor whose schema accepts
// the given child tag. Returns the element itself when accepted, or modelRoot
// as a last resort.
function pickInsertTarget(start, childTag = null) {
  let cursor = start || modelRoot;
  if (!childTag) return cursor;
  while (cursor && cursor !== modelRootHost && !canHaveChild(cursor, childTag)) {
    cursor = cursor.parentNode;
  }
  return cursor && cursor !== modelRootHost ? cursor : modelRoot;
}

function bootstrap(rootModel) {
  if (overlay) overlay.dispose();
  if (renderer) renderer.dispose();
  if (tree) tree.dispose();
  if (attrs) attrs.setModel(null);
  modelRoot = rootModel;
  modelRootHost.replaceChildren(modelRoot);

  renderer = new Renderer(modelRoot, svgHost);
  overlay = new Overlay(overlayEl, outlineEl, renderer, (modelElement) => {
    selected = modelElement;
    tree.setSelected(modelElement);
    attrs.setModel(modelElement);
    refreshInsertOptions();
  });
  tree = new TreePanel(treeHost, modelRoot, (modelElement) => setSelected(modelElement));
  attrs = new AttrPanel(attrHost);
  setSelected(modelRoot);
}

function defaultDocument() {
  const root = createModelElement('svg', { width: 800, height: 600, viewBox: '0 0 800 600' });
  root.appendChild(createModelElement('rect', { x: 80, y: 80, width: 220, height: 140, rx: 12, fill: '#4f8cff' }));
  root.appendChild(createModelElement('circle', { cx: 480, cy: 200, r: 90, fill: '#ef4444' }));
  root.appendChild(createModelElement('ellipse', { cx: 220, cy: 400, rx: 120, ry: 60, fill: '#22c55e' }));
  const text = createModelElement('text', { x: 420, y: 420, 'font-size': 36, fill: '#111111' });
  text.textContent = 'Hello, SVG';
  root.appendChild(text);
  return root;
}

bootstrap(defaultDocument());

document.querySelector('#toolbar').addEventListener('click', async (e) => {
  const button = e.target;
  if (!(button instanceof HTMLButtonElement)) return;
  const action = button.dataset.action;

  if (action === 'load') {
    fileInput.click();
  } else if (action === 'export') {
    exportSvg(modelRoot);
  } else if (action === 'delete') {
    deleteSelected();
  } else if (action === 'insert') {
    const tag = insertSelect.value;
    if (!tag) return;
    const target = pickInsertTarget(selected || modelRoot, tag);
    const newEl = createModelElement(tag);
    if (!newEl) return;
    if (schemaOf(newEl)?.contentText) newEl.textContent = tag === 'text' ? 'Text' : '';
    target.appendChild(newEl);
    setSelected(newEl);
  }
});

function deleteSelected() {
  if (!selected || selected === modelRoot) return;
  const parent = selected.parentNode;
  const fallback = selected.previousElementSibling || selected.nextElementSibling || parent;
  selected.remove();
  setSelected(fallback && fallback !== modelRootHost && isModelElement(fallback) ? fallback : modelRoot);
}

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  try {
    const newRoot = await loadSvgFile(file);
    if (!newRoot) throw new Error('Failed to parse SVG');
    if (tagOf(newRoot) !== 'svg') throw new Error('Loaded root is not <svg>');
    bootstrap(newRoot);
  } catch (err) {
    alert(err.message || String(err));
  } finally {
    fileInput.value = '';
  }
});

document.addEventListener('keydown', (e) => {
  const inField = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
  if (inField) return;
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (selected && selected !== modelRoot) {
      deleteSelected();
      e.preventDefault();
    }
  } else if (e.key === 'Escape') {
    setSelected(modelRoot);
  }
});
