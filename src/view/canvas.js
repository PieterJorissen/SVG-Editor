// Mounts the document's SVG root into the host element and keeps the
// host's box sized to match the SVG's `width` and `height` attributes.
// There is no mirroring tree — the document IS the rendered SVG, so
// once the root is in the DOM the browser does all the actual drawing.
//
// The relevant chapter is coords.html (chapter 7 "Coordinate Systems,
// Transformations and Units"), which defines what `width`, `height`
// and `viewBox` mean on the outermost `<svg>` element. The browser
// reads those attributes to establish the SVG viewport and the
// user-space coordinate system per coords.html §7.2; the host element
// here is just an HTML wrapper whose CSS box we keep aligned with the
// SVG viewport so the surrounding layout (toolbars, panels) reserves
// the right amount of room.
export class Canvas {
  // Replaces the host's children with the SVG root and starts listening
  // for `change` events on the document. struct.html §5.1.2 calls the
  // outermost `<svg>` "the establishing viewport"; once the browser
  // sees the element in the live DOM it begins rendering immediately.
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

  // Reads the root's `width` / `height` attributes and pushes them onto
  // the host's CSS box. The browser parses the same attributes against
  // the <length> grammar in coords.html §7.2 to size the SVG viewport;
  // we mirror the numeric value (with an implicit `px` unit) so the
  // editor chrome around the canvas reserves the right space.
  _syncSize() {
    const w = this.doc.root.getAttribute('width') || 800;
    const h = this.doc.root.getAttribute('height') || 600;
    this.host.style.width = w + 'px';
    this.host.style.height = h + 'px';
  }

  // Detaches the change listener when the canvas is replaced (e.g. on
  // file load), so the old Canvas does not keep reacting to events on
  // a document that is no longer mounted.
  dispose() { this.doc.removeEventListener('change', this._onChange); }
}
