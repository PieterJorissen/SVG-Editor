// Pending-edit buffer that stages attribute mutations without touching
// the document until commit() is called. Created and exposed for view
// code that wants preview/commit semantics; not yet consumed by the
// existing UI.
//
// The browser has no equivalent abstraction — every `setAttribute`
// reaches the live DOM immediately and is observable by mutation
// observers, listeners and the renderer. The spec describes the live
// model in svgdom.html (chapter B "Document Object Model"); a session
// buffer like this one sits in front of that model so the editor can
// preview a value (e.g. while dragging a slider) without committing
// dirty state, and discard the change if the user cancels.
export class EditSession {
  // Holds a per-element attribute map keyed by element node. The
  // backing Document is captured so commit() can replay the staged
  // writes through Document.setAttribute, which keeps the namespace
  // handling consistent with the live path described in
  // svgdom.html / struct.html §5.10 / linking.html §17.
  constructor(doc) {
    this.doc = doc;
    this.pending = new Map();
  }

  // Queues an attribute write for `el`. Last-write-wins per attribute,
  // mirroring how repeated `setAttribute` calls behave on the live DOM
  // — only the final value matters once commit() runs.
  set(el, name, value) {
    if (!this.pending.has(el)) this.pending.set(el, new Map());
    this.pending.get(el).set(name, value);
  }

  // Inspects the staged buffer. The browser-side equivalent is reading
  // back via `el.getAttribute`, but here we deliberately read the
  // pending value (not the committed one) so previews can show
  // unsaved edits.
  get(el, name) { return this.pending.get(el)?.get(name); }
  has(el, name) { return this.pending.get(el)?.has(name) ?? false; }

  // Replays every staged write through Document.setAttribute and
  // clears the buffer. Once this returns the live DOM matches the
  // staged values; the browser's renderer and observers see the changes
  // exactly as if the user had typed them directly into the live
  // attribute panel.
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
