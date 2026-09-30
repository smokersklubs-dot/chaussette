// Viewer 3D SKLUBS — bouteille procédurale (tour), studio blanc, PBR.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const ENGRAVE = {
  coated: { color: '#c9cac7', metalness: 0.95, roughness: 0.32 }, // peinture retirée → inox apparent
  raw:    { color: '#8e8f8c', metalness: 0.7,  roughness: 0.62 }, // inox brut → gravure plus sombre / mate
  alu:    { color: '#d6d7d5', metalness: 0.9,  roughness: 0.3 },
};

export class BottleViewer {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.85;

    this.camera = new THREE.PerspectiveCamera(28, 1, 1, 400);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = 22;
    this.controls.maxDistance = 110;
    this.controls.maxPolarAngle = Math.PI * 0.53;
    this.controls.autoRotateSpeed = 1.2;
    this.controls.addEventListener('start', () => { this.camAnim = null; });

    this.setupLights();
    this.setupGround();

    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.materials = {
      body: new THREE.MeshPhysicalMaterial({ color: '#ffffff' }),
      cap: new THREE.MeshPhysicalMaterial({ color: '#c8102e', roughness: 0.45, clearcoat: 0.3 }),
      loop: new THREE.MeshPhysicalMaterial({ color: '#c8102e', roughness: 0.5 }),
      inner: new THREE.MeshStandardMaterial({ color: '#9c9d9a', metalness: 1, roughness: 0.4 }),
    };
    this.colorTargets = {};

    this.brushedMap = makeBrushedTexture();
    this.softMap = makeGrainTexture();

    this.artTextures = null;
    this.sleeve = null;
    this.guides = null;
    this.showGuides = false;
    this.camAnim = null;
    this.intro = 0;

    this.resize();
    new ResizeObserver(() => this.resize()).observe(container);
    this.setupDrag();
    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  setupLights() {
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#e9e7e2', 0.35));
    const key = new THREE.DirectionalLight('#ffffff', 2.1);
    key.position.set(-22, 42, 30);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.radius = 9;
    key.shadow.blurSamples = 20;
    key.shadow.bias = -0.0004;
    Object.assign(key.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, near: 1, far: 120 });
    this.scene.add(key);
    const fill = new THREE.DirectionalLight('#f3f5ff', 0.7);
    fill.position.set(30, 14, 22);
    this.scene.add(fill);
    const rim = new THREE.DirectionalLight('#ffffff', 1.6);
    rim.position.set(8, 26, -34);
    this.scene.add(rim);
  }

  setupGround() {
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.ShadowMaterial({ opacity: 0.09 }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.receiveShadow = true;
    this.scene.add(shadow);
    // ombre de contact douce
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grd.addColorStop(0, 'rgba(0,0,0,0.55)');
    grd.addColorStop(0.35, 'rgba(0,0,0,0.22)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(c);
    this.contact = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.8 }),
    );
    this.contact.rotation.x = -Math.PI / 2;
    this.contact.position.y = 0.02;
    this.scene.add(this.contact);
  }

  // ---------- Géométrie ----------
  build(size, artwork) {
    const g = size.geometry;
    this.dim = g;
    this.zone = size.printZone;
    const old = [...this.group.children];
    old.forEach((o) => { this.group.remove(o); o.geometry?.dispose(); });

    const bodyH = g.height - g.capHeight + 0.6;
    this.bodyH = bodyH;
    const R = g.radius;
    const rn = g.neckRadius;
    const s = g.shoulderStart * bodyH;

    const pts = [];
    const P = (x, y) => pts.push(new THREE.Vector2(x, y));
    P(0, 0.05); P(R * 0.55, 0.05); P(R - 0.35, 0.08); P(R - 0.12, 0.2); P(R - 0.02, 0.45); P(R, 0.8);
    P(R, s);
    const neckY = bodyH - 1.1;
    const curve = new THREE.CubicBezierCurve(
      new THREE.Vector2(R, s),
      new THREE.Vector2(R, s + (neckY - s) * 0.62),
      new THREE.Vector2(rn + 0.15, neckY - (neckY - s) * 0.18),
      new THREE.Vector2(rn, neckY),
    );
    curve.getPoints(28).slice(1).forEach((p) => P(p.x, p.y));
    P(rn, bodyH - 0.12); P(rn - 0.1, bodyH); P(rn - 0.35, bodyH); P(rn - 0.35, bodyH - 1.5);

    const body = new THREE.Mesh(new THREE.LatheGeometry(pts, 160), this.materials.body);
    body.castShadow = true;
    body.receiveShadow = true;
    body.name = 'body';
    this.group.add(body);

    // bouchon
    const capBase = bodyH - 1.6;
    const capTop = capBase + g.capHeight;
    const rc = rn + 0.42;
    const cp = [];
    const C = (x, y) => cp.push(new THREE.Vector2(x, y));
    C(rn - 0.2, capBase + 0.3); C(rn, capBase); C(rc - 0.12, capBase); C(rc, capBase + 0.14);
    C(rc, capTop - 0.55); C(rc - 0.08, capTop - 0.2); C(rc - 0.35, capTop - 0.02); C(0, capTop);
    const capGeo = new THREE.LatheGeometry(cp, 120);
    const cap = new THREE.Mesh(capGeo, this.materials.cap);
    cap.castShadow = true;
    cap.name = 'cap';
    this.group.add(cap);

    // stries de préhension
    const ribs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, g.capHeight * 0.62, 0.14), this.materials.cap, 48);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      m.makeRotationY(a).setPosition(Math.sin(a) * rc, capBase + g.capHeight * 0.42, Math.cos(a) * rc);
      ribs.setMatrixAt(i, m);
    }
    ribs.castShadow = true;
    ribs.name = 'cap';
    this.group.add(ribs);

    // anse
    const loop = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.34, 24, 64, Math.PI), this.materials.loop);
    loop.position.y = capTop - 0.25;
    loop.castShadow = true;
    loop.name = 'loop';
    this.group.add(loop);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.8, 0.35, 64), this.materials.loop);
    hub.position.y = capTop - 0.05;
    hub.name = 'loop';
    this.group.add(hub);

    // manchon d'impression
    const zh = this.zone.top - this.zone.bottom;
    const sleeveGeo = new THREE.CylinderGeometry(R + 0.015, R + 0.015, zh, 256, 1, true, Math.PI, Math.PI * 2);
    this.sleeve = new THREE.Mesh(sleeveGeo, new THREE.MeshPhysicalMaterial({ transparent: true, depthWrite: false }));
    this.sleeve.position.y = this.zone.bottom + zh / 2;
    this.sleeve.renderOrder = 2;
    this.sleeve.name = 'sleeve';
    this.group.add(this.sleeve);

    this.guides = new THREE.Mesh(
      new THREE.CylinderGeometry(R + 0.03, R + 0.03, zh, 256, 1, true, Math.PI, Math.PI * 2),
      new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false }),
    );
    this.guides.position.copy(this.sleeve.position);
    this.guides.renderOrder = 3;
    this.guides.visible = this.showGuides;
    this.group.add(this.guides);

    this.contact.scale.set(R * 4.2, R * 4.2, 1);

    this.circumference = 2 * Math.PI * R;
    this.patternHeight = zh;
    this.bindArtwork(artwork);
    this.intro = 1;
  }

  bindArtwork(artwork) {
    this.artwork = artwork;
    this.artTextures?.forEach((t) => t.dispose());
    const mk = (c, srgb) => {
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      return t;
    };
    this.colorTex = mk(artwork.colorCanvas, true);
    this.maskTex = mk(artwork.maskCanvas, false);
    this.guideTex = mk(artwork.guideCanvas, true);
    this.artTextures = [this.colorTex, this.maskTex, this.guideTex];
    this.guides.material.map = this.guideTex;
    this.guides.material.needsUpdate = true;
  }

  refreshArtwork() {
    this.colorTex.needsUpdate = true;
    this.maskTex.needsUpdate = true;
    this.guideTex.needsUpdate = true;
  }

  // ---------- Matériaux ----------
  applyConfig(cfg, product) {
    const fin = product.finishes[cfg.finish];
    const b = this.materials.body;
    b.metalness = fin.metalness ?? 0;
    b.roughness = fin.roughness ?? 0.5;
    b.clearcoat = fin.clearcoat ?? 0;
    b.clearcoatRoughness = fin.clearcoatRoughness ?? 0.1;
    b.transmission = fin.transmission ?? 0;
    b.ior = fin.ior ?? 1.5;
    b.thickness = fin.thickness ?? 0;
    b.sheen = fin.sheen ?? 0;
    b.sheenRoughness = 0.8;
    b.sheenColor = new THREE.Color('#ffffff');
    b.roughnessMap = fin.brushed ? this.brushedMap : cfg.finish === 'softtouch' || cfg.finish === 'matte' ? this.softMap : null;
    b.bumpMap = fin.brushed ? this.brushedMap : null;
    b.bumpScale = 0.4;
    b.side = fin.transmission ? THREE.DoubleSide : THREE.FrontSide;
    b.needsUpdate = true;
    this.body = this.group.getObjectByName('body');
    if (this.body) this.body.castShadow = !fin.transmission;

    const bodyColor = fin.colorable === false ? fin.fixedColor : cfg.colors.body;
    this.colorTargets.body = new THREE.Color(bodyColor);
    this.colorTargets.cap = new THREE.Color(cfg.colors.cap);
    this.colorTargets.loop = new THREE.Color(cfg.colors.loop);

    // marquage
    const method = product.printingMethods.find((m) => m.id === cfg.method);
    const s = this.sleeve.material;
    const engrave = method?.render === 'engrave';
    if (engrave) {
      const e = cfg.material === 'aluminium' ? ENGRAVE.alu : fin.brushed ? ENGRAVE.raw : ENGRAVE.coated;
      s.map = null;
      s.alphaMap = this.maskTex;
      s.bumpMap = this.maskTex;
      s.bumpScale = -1.2;
      s.color.set(e.color);
      s.metalness = e.metalness;
      s.roughness = e.roughness;
      s.clearcoat = 0;
    } else {
      s.map = this.colorTex;
      s.alphaMap = null;
      s.bumpMap = null;
      s.color.set('#ffffff');
      s.metalness = 0;
      s.roughness = cfg.method === 'uv' ? 0.28 : 0.5;
      s.clearcoat = cfg.method === 'uv' ? 0.5 : 0;
    }
    s.alphaTest = 0.04;
    s.needsUpdate = true;
    this.engraveColor = engrave ? (cfg.material === 'aluminium' ? ENGRAVE.alu.color : fin.brushed ? ENGRAVE.raw.color : ENGRAVE.coated.color) : null;
  }

  setGuides(on) {
    this.showGuides = on;
    if (this.guides) this.guides.visible = on;
  }

  // ---------- Caméra ----------
  views() {
    const h = this.dim.height;
    const cy = h * 0.46;
    const d = (h * 2.55 + 18) * (1 + (this.frameShift || 0) * 2.4);
    const zc = (this.zone.bottom + this.zone.top) / 2;
    return {
      front:  { pos: [0, cy + 4, d], target: [0, cy, 0] },
      back:   { pos: [0, cy + 4, -d], target: [0, cy, 0] },
      side:   { pos: [d, cy + 4, 0], target: [0, cy, 0] },
      top:    { pos: [0.01, h + d * 0.8, d * 0.35], target: [0, h * 0.55, 0] },
      detail: { pos: [d * 0.22, zc + 2, d * 0.46], target: [0, zc, 0] },
      hero:   { pos: [-d * 0.42, cy + 7, d * 0.9], target: [0, cy, 0] },
    };
  }

  goTo(name, instant = false) {
    const v = this.views()[name];
    if (!v) return;
    const to = { pos: new THREE.Vector3(...v.pos), target: new THREE.Vector3(...v.target) };
    if (instant) {
      this.camera.position.copy(to.pos);
      this.controls.target.copy(to.target);
      this.controls.update();
      return;
    }
    this.camAnim = { from: { pos: this.camera.position.clone(), target: this.controls.target.clone() }, to, start: performance.now(), dur: 900 };
    this.onView?.(name);
  }

  setAutoRotate(on) { this.controls.autoRotate = on; }

  // Décale le cadrage vers le haut (ex. carte récap mobile qui couvre le bas)
  setFrameShift(fraction) {
    this.frameShift = fraction;
    this.resize();
  }

  // ---------- Glisser le visuel directement sur la bouteille ----------
  setupDrag() {
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const el = this.renderer.domElement;
    const pick = (e) => {
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, this.camera);
      const hit = ray.intersectObject(this.sleeve, false)[0];
      // on ne prend que la face visible (normale vers la caméra)
      if (!hit) return null;
      const n = hit.point.clone().setY(0).normalize();
      const toCam = this.camera.position.clone().sub(hit.point).setY(0).normalize();
      return n.dot(toCam) > 0 ? hit.uv : null;
    };
    let drag = null;
    el.addEventListener('pointerdown', (e) => {
      if (!this.artwork?.image || !this.sleeve) return;
      const uv = pick(e);
      if (uv && this.artwork.hit(uv.x, uv.y)) {
        const p = this.artwork.uvToCm(uv.x, uv.y);
        drag = { dx: this.artwork.t.x - p.x, dy: this.artwork.t.y - p.y };
        this.controls.enabled = false;
        el.setPointerCapture(e.pointerId);
        el.style.cursor = 'grabbing';
        e.stopPropagation();
      }
    }, true);
    el.addEventListener('pointermove', (e) => {
      if (!drag) {
        if (this.artwork?.image && this.sleeve && e.pointerType === 'mouse') {
          const uv = pick(e);
          el.style.cursor = uv && this.artwork.hit(uv.x, uv.y) ? 'grab' : '';
        }
        return;
      }
      const uv = pick(e);
      if (!uv) return;
      const p = this.artwork.uvToCm(uv.x, uv.y);
      this.artwork.t.x = p.x + drag.dx;
      this.artwork.t.y = p.y + drag.dy;
      this.artwork.clampTransform();
      this.artwork.render();
    });
    const end = () => {
      if (!drag) return;
      drag = null;
      this.controls.enabled = true;
      el.style.cursor = '';
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  // ---------- Rendu ----------
  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // garde la bouteille entière dans le cadre en portrait
    this.camera.fov = w / h < 0.8 ? 38 : 28;
    if (this.frameShift) this.camera.setViewOffset(w, h, 0, h * this.frameShift, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  tick() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const k = 1 - Math.exp(-dt / 0.09); // ~300 ms
    for (const key of ['body', 'cap', 'loop']) {
      const t = this.colorTargets[key];
      if (t) this.materials[key].color.lerp(t, k);
    }
    if (this.camAnim) {
      const a = this.camAnim;
      // temps réel : la durée reste identique quel que soit le framerate
      a.t = Math.min(1, (performance.now() - a.start) / a.dur);
      const e = a.t < 0.5 ? 4 * a.t * a.t * a.t : 1 - Math.pow(-2 * a.t + 2, 3) / 2;
      this.camera.position.lerpVectors(a.from.pos, a.to.pos, e);
      this.controls.target.lerpVectors(a.from.target, a.to.target, e);
      if (a.t >= 1) this.camAnim = null;
    }
    if (this.intro > 0) {
      this.intro = Math.max(0, this.intro - Math.min(dt, 0.1) / 0.6);
      const e = Math.pow(this.intro, 3);
      this.group.position.y = e * 1.2;
      this.group.rotation.y = -e * 0.35;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  // Capture PNG (fond blanc) de la vue courante
  snapshot(width = 1200) {
    const guides = this.guides.visible;
    this.guides.visible = false;
    this.renderer.render(this.scene, this.camera);
    const src = this.renderer.domElement;
    const c = document.createElement('canvas');
    c.width = width;
    c.height = Math.round((width * src.height) / src.width);
    const g = c.getContext('2d');
    g.fillStyle = '#F6F6F4';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(src, 0, 0, c.width, c.height);
    this.guides.visible = guides;
    return c.toDataURL('image/png');
  }

  cameraState() {
    return { position: this.camera.position.toArray().map((n) => +n.toFixed(2)), target: this.controls.target.toArray().map((n) => +n.toFixed(2)) };
  }
}

function makeBrushedTexture() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 1024;
  const g = c.getContext('2d');
  for (let y = 0; y < c.height; y++) {
    const v = 150 + Math.random() * 70;
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(0, y, c.width, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function makeGrainTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const img = g.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 205 + Math.random() * 50;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6, 6);
  return t;
}
