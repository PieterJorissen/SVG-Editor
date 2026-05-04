// Mounts the document's SVG root into the host element and keeps the host's
// box sized to match the SVG's width/height attributes. No mirroring tree —
// the document IS the rendered SVG.
export class Canvas {
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

  _syncSize() {
    const w = this.doc.root.getAttribute('width') || 800;
    const h = this.doc.root.getAttribute('height') || 600;
    this.host.style.width = w + 'px';
    this.host.style.height = h + 'px';
  }

  dispose() { this.doc.removeEventListener('change', this._onChange); }
}
