// Artwork engine : compose le patron 2D (déroulé du corps) et produit
// les textures appliquées au manchon 3D.
//   - print   : colorCanvas (RGBA)       → map
//   - engrave : maskCanvas (niveaux gris) → alphaMap + bumpMap
// Les coordonnées de l'artwork sont en cm sur le patron déroulé :
//   x = décalage horizontal depuis le centre de la zone, y = décalage vertical
//   depuis le milieu de la zone imprimable, width = largeur du visuel.
// Plusieurs éléments (calques) : logos importés et textes. Le calque actif est
// exposé par image / name / t pour l'édition (taille, rotation, position).

const PX_WIDTH = 2048;

export class ArtworkEngine {
  constructor() {
    this.colorCanvas = document.createElement('canvas');
    this.maskCanvas = document.createElement('canvas');
    this.guideCanvas = document.createElement('canvas');
    this.layers = [];
    this.active = -1;
    this.pattern = { circumference: 20, height: 10, safe: 0.4 };
    this.zone = { id: 'front', widthRatio: 0.36, centerU: 0.5 };
    this.onChange = () => {};
  }

  setPattern(circumference, height, safe) {
    this.pattern = { circumference, height, safe };
    const h = Math.round((PX_WIDTH * height) / circumference);
    for (const c of [this.colorCanvas, this.maskCanvas, this.guideCanvas]) {
      c.width = PX_WIDTH;
      c.height = h;
    }
    this.clampTransform();
  }

  setZone(zone) {
    this.zone = zone;
    this.clampTransform();
  }

  // calque actif
  get layer() { return this.layers[this.active] || null; }
  get image() { return this.layer?.image || null; }
  get imageMask() { return this.layer?.mask || null; }
  get name() { return this.layer?.name || null; }
  get t() { return this.layer?.t || this._t || (this._t = { x: 0, y: 0, width: 5, rotation: 0 }); }
  set t(v) { if (this.layer) this.layer.t = v; else this._t = v; }
  get hasArt() { return this.layers.length > 0; }

  select(i) { this.active = i >= 0 && i < this.layers.length ? i : -1; this.onChange(); }

  addLayer(layer) {
    this.layers.push(layer);
    this.active = this.layers.length - 1;
    // décalage vertical léger pour ne pas superposer les éléments
    const n = this.layers.length - 1;
    layer.t = { x: 0, y: n ? -n * 1.6 : 0, width: Math.min(layer.kind === 'text' ? 7 : 6, this.maxWidth() * 0.7), rotation: 0 };
    this.clampTransform();
    return layer;
  }

  get pxPerCm() { return PX_WIDTH / this.pattern.circumference; }

  // Zone imprimable en cm (x relatif au centre de zone)
  zoneRect() {
    const w = this.pattern.circumference * this.zone.widthRatio;
    const s = this.zone.id === 'wrap' ? 0 : this.pattern.safe;
    return { halfW: w / 2 - s, halfH: this.pattern.height / 2 - this.pattern.safe, fullHalfW: w / 2 };
  }

  maxWidth(layer = this.layer) {
    const r = this.zoneRect();
    const aspect = layer ? layer.image.height / layer.image.width : 1;
    return Math.max(0.5, Math.min(r.halfW * 2, (r.halfH * 2) / aspect));
  }

  clampTransform() {
    for (const layer of this.layers) this.clampLayer(layer);
  }

  clampLayer(layer) {
    const r = this.zoneRect();
    const t = layer.t;
    const aspect = layer.image.height / layer.image.width;
    t.width = Math.min(Math.max(t.width, 0.5), this.maxWidth(layer));
    const hw = t.width / 2;
    const hh = (t.width * aspect) / 2;
    if (this.zone.id !== 'wrap') t.x = Math.min(Math.max(t.x, -r.halfW + hw), r.halfW - hw);
    else t.x = ((t.x + this.pattern.circumference / 2) % this.pattern.circumference + this.pattern.circumference) % this.pattern.circumference - this.pattern.circumference / 2;
    t.y = Math.min(Math.max(t.y, -r.halfH + hh), r.halfH - hh);
  }

  // Importer un logo : nouveau calque, ou remplace le visuel du calque actif (replace = true)
  async loadFile(file, replace = false) {
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url, file.type === 'image/svg+xml');
      if (replace && this.layer?.kind === 'image') {
        Object.assign(this.layer, { image: img, mask: buildMask(img), name: file.name });
        this.clampLayer(this.layer);
      } else {
        this.addLayer({ kind: 'image', image: img, mask: buildMask(img), name: file.name });
      }
      return img;
    } finally {
      URL.revokeObjectURL(url); // l'image est déjà rasterisée dans un canvas
    }
  }

  // Ajouter / modifier un texte : rendu en image (transparent), traité comme un logo
  setText(opts, layer = null) {
    const o = { text: 'Votre texte', font: 'Inter Tight', weight: 700, italic: false, color: '#111111', ...(layer?.textOpts || {}), ...opts };
    const img = renderText(o);
    if (!img) return null;
    if (layer) {
      const aspectOld = layer.image.height / layer.image.width;
      const hOld = layer.t.width * aspectOld;
      Object.assign(layer, { image: img, mask: buildMask(img), name: `Texte « ${o.text} »`, textOpts: o });
      layer.t.width = hOld * (img.width / img.height); // garde la hauteur des lettres
      this.clampLayer(layer);
      return layer;
    }
    return this.addLayer({ kind: 'text', image: img, mask: buildMask(img), name: `Texte « ${o.text} »`, textOpts: o });
  }

  removeActive() {
    if (this.active < 0) return;
    this.layers.splice(this.active, 1);
    this.active = this.layers.length - 1;
  }

  clear() {
    this.layers = [];
    this.active = -1;
  }

  // Position horizontale du centre de zone en px
  zoneCenterPx() { return this.zone.centerU * PX_WIDTH; }

  // Dessine le visuel (ou son masque) sur un contexte, avec répétition sur la couture
  drawArt(ctx, which = 'image', scale = 1) {
    for (const layer of this.layers) this.drawLayer(ctx, layer, layer[which], scale);
  }

  drawLayer(ctx, layer, source, scale = 1) {
    if (!source) return;
    const t = layer.t;
    const k = this.pxPerCm * scale;
    const W = PX_WIDTH * scale;
    const cx = this.zoneCenterPx() * scale + t.x * k;
    const cy = (ctx.canvas.height / 2) - t.y * k;
    const w = t.width * k;
    const h = w * (layer.image.height / layer.image.width);
    for (const off of [-W, 0, W]) {
      ctx.save();
      ctx.translate(cx + off, cy);
      ctx.rotate((t.rotation * Math.PI) / 180);
      ctx.drawImage(source, -w / 2, -h / 2, w, h);
      ctx.restore();
    }
  }

  // contour du calque actif (éditeur 2D)
  outlineActive(ctx, scale) {
    const layer = this.layer;
    if (!layer || this.layers.length < 2) return;
    const t = layer.t, k = this.pxPerCm * scale;
    const w = t.width * k, h = w * (layer.image.height / layer.image.width);
    ctx.save();
    ctx.translate(this.zoneCenterPx() * scale + t.x * k, ctx.canvas.height / 2 - t.y * k);
    ctx.rotate((t.rotation * Math.PI) / 180);
    ctx.strokeStyle = '#FF6B00';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(-w / 2 - 3, -h / 2 - 3, w + 6, h + 6);
    ctx.restore();
  }

  // Textures du manchon 3D
  render() {
    const c = this.colorCanvas.getContext('2d');
    c.clearRect(0, 0, this.colorCanvas.width, this.colorCanvas.height);
    const m = this.maskCanvas.getContext('2d');
    m.fillStyle = '#000';
    m.fillRect(0, 0, this.maskCanvas.width, this.maskCanvas.height);
    this.drawArt(c, 'image');
    this.drawArt(m, 'mask');
    this.renderGuides();
    this.onChange();
  }

  renderGuides() {
    const g = this.guideCanvas.getContext('2d');
    const { width: W, height: H } = this.guideCanvas;
    g.clearRect(0, 0, W, H);
    const k = this.pxPerCm;
    const r = this.zoneRect();
    const cx = this.zoneCenterPx();
    g.lineWidth = 4;
    // zone imprimable
    g.strokeStyle = 'rgba(255,107,0,0.9)';
    g.setLineDash([]);
    strokeWrapped(g, cx - r.fullHalfW * k, 2, r.fullHalfW * 2 * k, H - 4, W);
    // zone de sécurité
    g.setLineDash([18, 12]);
    g.strokeStyle = 'rgba(255,107,0,0.65)';
    strokeWrapped(g, cx - r.halfW * k, r.halfH ? H / 2 - r.halfH * k : 0, r.halfW * 2 * k, r.halfH * 2 * k, W);
    // axe central
    g.setLineDash([6, 10]);
    g.strokeStyle = 'rgba(17,17,17,0.45)';
    g.beginPath();
    g.moveTo(cx % W, 0);
    g.lineTo(cx % W, H);
    g.stroke();
    g.setLineDash([]);
  }

  // Éditeur 2D (patron déroulé) dans l'UI
  drawEditor(canvas, { bodyColor, engrave, engraveColor }) {
    const ctx = canvas.getContext('2d');
    const scale = canvas.width / PX_WIDTH;
    const H = canvas.height;
    ctx.clearRect(0, 0, canvas.width, H);
    ctx.fillStyle = bodyColor;
    ctx.fillRect(0, 0, canvas.width, H);
    if (this.layers.length) {
      if (engrave) {
        const tmp = document.createElement('canvas');
        tmp.width = canvas.width; tmp.height = H;
        const t = tmp.getContext('2d');
        this.drawArt(t, 'mask', scale);
        t.globalCompositeOperation = 'source-in';
        t.fillStyle = engraveColor;
        t.fillRect(0, 0, tmp.width, H);
        // le masque est blanc sur transparent : on retire le fond
        ctx.drawImage(tmp, 0, 0);
      } else {
        this.drawArt(ctx, 'image', scale);
      }
    }
    ctx.drawImage(this.guideCanvas, 0, 0, canvas.width, H);
    this.outlineActive(ctx, scale);
    // repères face / dos
    ctx.fillStyle = 'rgba(17,17,17,0.45)';
    ctx.font = '500 10px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('DOS', 14, H - 6);
    ctx.fillText('FACE', canvas.width / 2, H - 6);
    ctx.fillText('DOS', canvas.width - 14, H - 6);
  }

  // Hit-test en coordonnées patron (u,v ∈ [0,1]) : sélectionne le calque touché (le plus haut d'abord)
  hit(u, v) {
    const p = this.uvToCm(u, v);
    const C = this.pattern.circumference;
    for (let i = this.layers.length - 1; i >= 0; i--) {
      const { t, image } = this.layers[i];
      const aspect = image.height / image.width;
      const a = (-t.rotation * Math.PI) / 180;
      let dx = p.x - t.x;
      dx = ((dx + C / 2) % C + C) % C - C / 2;
      const dy = p.y - t.y;
      const rx = dx * Math.cos(a) - dy * Math.sin(a);
      const ry = dx * Math.sin(a) + dy * Math.cos(a);
      if (Math.abs(rx) <= t.width / 2 + 0.3 && Math.abs(ry) <= (t.width * aspect) / 2 + 0.3) {
        if (i !== this.active) this.select(i);
        return true;
      }
    }
    return false;
  }

  uvToCm(u, v) {
    let x = (u - this.zone.centerU) * this.pattern.circumference;
    const C = this.pattern.circumference;
    x = ((x + C / 2) % C + C) % C - C / 2;
    return { x, y: (v - 0.5) * this.pattern.height };
  }

  snapshot() {
    return this.layers.length ? this.layers.map((l) => ({ kind: l.kind, file: l.name, text: l.textOpts?.text, ...l.t, zone: this.zone.id })) : null;
  }
}

function strokeWrapped(g, x, y, w, h, W) {
  for (const off of [-W, 0, W]) g.strokeRect(x + off, y, w, h);
}

function loadImage(url, isSvg) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      if (isSvg && (!img.naturalWidth || !img.naturalHeight)) {
        // SVG sans dimensions : on rasterise à 1024 px
        img.width = 1024; img.height = 1024;
      }
      // Rasterisation (SVG / très grandes images) à 2048 px max
      const max = 2048;
      const w0 = img.naturalWidth || 1024;
      const h0 = img.naturalHeight || 1024;
      const s = Math.min(1, max / Math.max(w0, h0)) * (isSvg ? Math.max(1, 1024 / Math.max(w0, h0)) : 1);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w0 * s));
      c.height = Math.max(1, Math.round(h0 * s));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c);
    };
    img.onerror = () => reject(new Error('Format non lisible'));
    img.src = url;
  });
}

// Masque de gravure : alpha si l'image a de la transparence, sinon zones sombres.
function buildMask(src) {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(src, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const d = data.data;
  let hasAlpha = false;
  for (let i = 3; i < d.length; i += 4 * 7) if (d[i] < 250) { hasAlpha = true; break; }
  for (let i = 0; i < d.length; i += 4) {
    const lum = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
    const a = hasAlpha ? d[i + 3] / 255 : lum < 0.6 ? 1 : 0;
    d[i] = d[i + 1] = d[i + 2] = 255;
    d[i + 3] = Math.round(a * 255);
  }
  ctx.putImageData(data, 0, 0);
  return c;
}

// Texte → image transparente recadrée (police de la page, haute définition)
function renderText({ text, font, weight, italic, color }) {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 3);
  if (!lines.length) return null;
  const px = 220;
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const spec = `${italic ? 'italic ' : ''}${weight} ${px}px "${font}", system-ui, sans-serif`;
  g.font = spec;
  const w = Math.ceil(Math.max(...lines.map((l) => g.measureText(l).width))) + px * 0.3;
  const lh = px * 1.12;
  c.width = Math.min(4096, w);
  c.height = Math.ceil(lh * lines.length + px * 0.25);
  g.font = spec;
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  lines.forEach((l, i) => g.fillText(l, c.width / 2, px * 0.12 + lh * (i + 0.5)));
  return c;
}
