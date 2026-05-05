// edit-session.js is a pending-edit buffer that stages attribute
// mutations without touching the live SVG DOM until `commit` is
// called. It is created and exposed for view code that wants
// preview-then-commit semantics; the existing UI does not yet route
// through it, so for now the buffer is unused.
//
// Inputs:  staged (el, name, value) writes from view code
// Outputs: live mutations on `commit`; nothing on `rollback`
// Common bugs:
//   - preview not visible (caller forgot to `commit`)
//   - commit double-fires events (`commit` called twice in a row)
//
// prev: src/doc/document.js  ·  next: src/widgets/index.js

export class EditSession {
  // Holds a per-element attribute map keyed by the element node.
  // The Document is captured so `commit` can replay the staged
  // writes through `doc.setAttribute`, which keeps the namespace
  // dispatch consistent with the live path.
  constructor(doc) {
    this.doc = doc;
    this.pending = new Map();
  }

  // Queues an attribute write for `el`. Last-write-wins per
  // attribute, mirroring how repeated `setAttribute` calls behave on
  // the live DOM — only the final value matters once `commit` runs.
  set(el, name, value) {
    if (!this.pending.has(el)) this.pending.set(el, new Map());
    this.pending.get(el).set(name, value);
  }

  // Reads back from the staged buffer rather than the live DOM, so
  // a preview can show the unsaved value while the user is still
  // editing. Use `el.getAttribute(name)` directly to read the
  // committed value.
  get(el, name) { return this.pending.get(el)?.get(name); }
  has(el, name) { return this.pending.get(el)?.has(name) ?? false; }

  // Replays every staged write through `doc.setAttribute` and clears
  // the buffer. Once this returns, the live DOM matches the staged
  // values; the browser's renderer and the Document's
  // MutationObserver see the changes exactly as if the user had
  // typed them directly into the attribute panel.
  commit() {
    for (const [el, attrs] of this.pending) {
      for (const [name, value] of attrs) this.doc.setAttribute(el, name, value);
    }
    this.pending.clear();
  }

  // Drops the staged buffer without writing. The live DOM is
  // untouched, so the browser keeps rendering the last committed
  // values — useful for "cancel" affordances.
  rollback() { this.pending.clear(); }
}
