import { CLASS_BY_SVG, createModelElement, classOf, canHaveChild } from './registry.js';
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

let modelRoot;
let renderer;
let overlay;
let tree;
let attrs;
let selected = null;

function setSelected(model) {
  selected = model;
  overlay.select(model);
  tree.setSelected(model);
  attrs.setModel(model);
}

function bootstrap(rootModel) {
  if (overlay) overlay.dispose();
  if (renderer) renderer.dispose();
  if (tree) tree.dispose();
  if (attrs) attrs.setModel(null);
  modelRoot = rootModel;
  modelRootHost.replaceChildren(modelRoot);

  renderer = new Renderer(modelRoot, svgHost);
  overlay = new Overlay(overlayEl, outlineEl, renderer, (m) => {
    selected = m;
    tree.setSelected(m);
    attrs.setModel(m);
  });
  tree = new TreePanel(treeHost, modelRoot, (m) => setSelected(m));
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
  const t = e.target;
  if (!(t instanceof HTMLButtonElement)) return;
  const action = t.dataset.action;
  const insert = t.dataset.insert;

  if (action === 'load') {
    fileInput.click();
  } else if (action === 'export') {
    exportSvg(modelRoot);
  } else if (action === 'delete') {
    if (selected && selected !== modelRoot) {
      const parent = selected.parentNode;
      const next = selected.previousElementSibling || selected.nextElementSibling || parent;
      selected.remove();
      setSelected(next && next !== modelRootHost ? next : modelRoot);
    }
  } else if (insert) {
    const target = pickInsertTarget(insert);
    if (!target) return;
    const el = createModelElement(insert);
    if (insert === 'text') el.textContent = 'Text';
    target.appendChild(el);
    setSelected(el);
  }
});

function pickInsertTarget(childTag) {
  let t = selected || modelRoot;
  while (t && !canHaveChild(t, childTag)) t = t.parentNode;
  if (!t || !classOf(t)) return modelRoot;
  return t;
}

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  try {
    const newRoot = await loadSvgFile(file);
    if (!newRoot) throw new Error('Failed to parse SVG');
    if (classOf(newRoot)?.svgTag !== 'svg') throw new Error('Loaded root is not <svg>');
    bootstrap(newRoot);
  } catch (err) {
    alert(err.message || String(err));
  } finally {
    fileInput.value = '';
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    if (selected && selected !== modelRoot) {
      const parent = selected.parentNode;
      const next = selected.previousElementSibling || selected.nextElementSibling || parent;
      selected.remove();
      setSelected(next && next !== modelRootHost ? next : modelRoot);
      e.preventDefault();
    }
  } else if (e.key === 'Escape') {
    setSelected(modelRoot);
  }
});
