// canvas.js mounts the document's SVG root into the editor's host
// element and keeps the host's CSS box sized to match the SVG's
// `width` and `height` attributes.
//
// Inputs:  a Document; the host HTML element from index.html
// Outputs: a sized host with the live SVG inside; CSS layout follows
// Common bugs:
//   - panels overlap or leave a gap (host size out of sync with SVG)
//   - CSS layout cuts off the SVG (host smaller than viewBox extent)
//
// prev: src/io/file-io.js  ·  next: src/view/overlay.js
export class Canvas {
  // Replaces the host's children with the SVG root and starts
  // listening for mutations on `width` and `height` so the host's
  // CSS box can follow them. There is no mirroring tree in the
  // editor — the Document IS the rendered SVG, so once the root is
  // in the live DOM the browser does all the drawing without any
  // separate render call from the editor. struct.html §5.1.2 calls
  // the outermost `<svg>` "the establishing viewport".
  constructor(doc, host) {
    this.doc = doc;
    this.host = host;
    host.replaceChildren(doc.root);
    this._syncSize();
    this._onChange = (e) => {
      for (const m of e.detail) {
        if (m.target === doc.root && (m.attributeName === 'width' || m.attributeName === 'height')) {
          this._syncSize();
          break;
        }
      }
    };
    doc.addEventListener('change', this._onChange);
  }

  // Reads `width` and `height` from the root and pushes them onto the
  // host as CSS pixels. The browser does the analogous parse against
  // the <length> grammar in coords.html §7.2 to size the SVG viewport
  // itself; we mirror the numeric value (with an implicit `px` unit)
  // so the editor chrome around the canvas reserves the right space.
  _syncSize() {
    const w = this.doc.root.getAttribute('width') || 800;
    const h = this.doc.root.getAttribute('height') || 600;
    this.host.style.width = w + 'px';
    this.host.style.height = h + 'px';
  }

  // Detaches the change listener when the canvas is replaced — for
  // example after a file load, when `bootstrap` in src/main.js spins
  // up a fresh Canvas against a new Document.
  dispose() { this.doc.removeEventListener('change', this._onChange); }
}
