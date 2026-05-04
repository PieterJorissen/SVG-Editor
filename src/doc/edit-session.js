// Pending-edit buffer. Stages attribute mutations without touching the document
// until commit() is called. Created and exposed for view code that wants
// preview/commit semantics; not yet consumed by the existing UI.
export class EditSession {
  constructor(doc) {
    this.doc = doc;
    this.pending = new Map();
  }

  set(el, name, value) {
    if (!this.pending.has(el)) this.pending.set(el, new Map());
    this.pending.get(el).set(name, value);
  }

  get(el, name) { return this.pending.get(el)?.get(name); }
  has(el, name) { return this.pending.get(el)?.has(name) ?? false; }

  commit() {
    for (const [el, attrs] of this.pending) {
      for (const [name, value] of attrs) this.doc.setAttribute(el, name, value);
    }
    this.pending.clear();
  }

  rollback() { this.pending.clear(); }
}
