// Artwork engine : compose le patron 2D (déroulé du corps) et produit
// les textures appliquées au manchon 3D.
//   - print   : colorCanvas (RGBA)       → map
//   - engrave : maskCanvas (niveaux gris) → alphaMap + bumpMap
// Les coordonnées de l'artwork sont en cm sur le patron déroulé :
//   x = décalage horizontal depuis le centre de la zone, y = décalage vertical
//   depuis le milieu de la zone imprimable, width = largeur du visuel.

const PX_WIDTH = 2048;

export class ArtworkEngine {
  constructor() {
    this.colorCanvas = document.createElement('canvas');
    this.maskCanvas = document.createElement('canvas');
    this.guideCanvas = document.createElement('canvas');
    this.image = null;
    this.imageMask = null;
    this.name = null;
    this.t = { x: 0, y: 0, width: 5, rotation: 0 };
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

  get pxPerCm() { return PX_WIDTH / this.pattern.circumference; }

  // Zone imprimable en cm (x relatif au centre de zone)
  zoneRect() {
    const w = this.pattern.circumference * this.zone.widthRatio;
    const s = this.zone.id === 'wrap' ? 0 : this.pattern.safe;
    return { halfW: w / 2 - s, halfH: this.pattern.height / 2 - this.pattern.safe, fullHalfW: w / 2 };
  }

  maxWidth() {
    const r = this.zoneRect();
    const aspect = this.image ? this.image.height / this.image.width : 1;
    return Math.max(0.5, Math.min(r.halfW * 2, (r.halfH * 2) / aspect));
  }

  clampTransform() {
    if (!this.image) return;
    const r = this.zoneRect();
    const aspect = this.image.height / this.image.width;
    this.t.width = Math.min(Math.max(this.t.width, 0.5), this.maxWidth());
    const hw = this.t.width / 2;
    const hh = (this.t.width * aspect) / 2;
    if (this.zone.id !== 'wrap') this.t.x = Math.min(Math.max(this.t.x, -r.halfW + hw), r.halfW - hw);
    else this.t.x = ((this.t.x + this.pattern.circumference / 2) % this.pattern.circumference + this.pattern.circumference) % this.pattern.circumference - this.pattern.circumference / 2;
    this.t.y = Math.min(Math.max(this.t.y, -r.halfH + hh), r.halfH - hh);
  }

  async loadFile(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url, file.type === 'image/svg+xml');
      this.image = img;
      this.name = file.name;
      this.imageMask = buildMask(img);
      this.t = { x: 0, y: 0, width: Math.min(6, this.maxWidth() * 0.7), rotation: 0 };
      this.clampTransform();
      return img;
    } finally {
      // l'URL reste nécessaire tant que l'image est affichée ; libérée au prochain upload
      if (this._lastUrl) URL.revokeObjectURL(this._lastUrl);
      this._lastUrl = url;
    }
  }

  clear() {
    this.image = null;
    this.imageMask = null;
    this.name = null;
  }

  // Position horizontale du centre de zone en px
  zoneCenterPx() { return this.zone.centerU * PX_WIDTH; }

  // Dessine le visuel (ou son masque) sur un contexte, avec répétition sur la couture
  drawArt(ctx, source, scale = 1) {
    if (!source) return;
    const k = this.pxPerCm * scale;
    const W = PX_WIDTH * scale;
    const cx = this.zoneCenterPx() * scale + this.t.x * k;
    const cy = (ctx.canvas.height / 2) - this.t.y * k;
    const w = this.t.width * k;
    const h = w * (this.image.height / this.image.width);
    for (const off of [-W, 0, W]) {
      ctx.save();
      ctx.translate(cx + off, cy);
      ctx.rotate((this.t.rotation * Math.PI) / 180);
      ctx.drawImage(source, -w / 2, -h / 2, w, h);
      ctx.restore();
    }
  }

  // Textures du manchon 3D
  render() {
    const c = this.colorCanvas.getContext('2d');
    c.clearRect(0, 0, this.colorCanvas.width, this.colorCanvas.height);
    const m = this.maskCanvas.getContext('2d');
    m.fillStyle = '#000';
    m.fillRect(0, 0, this.maskCanvas.width, this.maskCanvas.height);
    if (this.image) {
      this.drawArt(c, this.image);
      this.drawArt(m, this.imageMask);
    }
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
    if (this.image) {
      if (engrave) {
        const tmp = document.createElement('canvas');
        tmp.width = canvas.width; tmp.height = H;
        const t = tmp.getContext('2d');
        this.drawArt(t, this.imageMask, scale);
        t.globalCompositeOperation = 'source-in';
        t.fillStyle = engraveColor;
        t.fillRect(0, 0, tmp.width, H);
        // le masque est blanc sur transparent : on retire le fond
        ctx.drawImage(tmp, 0, 0);
      } else {
        this.drawArt(ctx, this.image, scale);
      }
    }
    ctx.drawImage(this.guideCanvas, 0, 0, canvas.width, H);
    // repères face / dos
    ctx.fillStyle = 'rgba(17,17,17,0.45)';
    ctx.font = '500 10px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('DOS', 14, H - 6);
    ctx.fillText('FACE', canvas.width / 2, H - 6);
    ctx.fillText('DOS', canvas.width - 14, H - 6);
  }

  // Hit-test en coordonnées patron (u,v ∈ [0,1])
  hit(u, v) {
    if (!this.image) return false;
    const p = this.uvToCm(u, v);
    const aspect = this.image.height / this.image.width;
    const a = (-this.t.rotation * Math.PI) / 180;
    let dx = p.x - this.t.x;
    const C = this.pattern.circumference;
    dx = ((dx + C / 2) % C + C) % C - C / 2;
    const dy = p.y - this.t.y;
    const rx = dx * Math.cos(a) - dy * Math.sin(a);
    const ry = dx * Math.sin(a) + dy * Math.cos(a);
    return Math.abs(rx) <= this.t.width / 2 + 0.3 && Math.abs(ry) <= (this.t.width * aspect) / 2 + 0.3;
  }

  uvToCm(u, v) {
    let x = (u - this.zone.centerU) * this.pattern.circumference;
    const C = this.pattern.circumference;
    x = ((x + C / 2) % C + C) % C - C / 2;
    return { x, y: (v - 0.5) * this.pattern.height };
  }

  snapshot() {
    return this.image ? { file: this.name, ...this.t, zone: this.zone.id } : null;
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
