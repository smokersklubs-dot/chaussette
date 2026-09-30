// Viewer 3D SKLUBS — bouteille procédurale (tour), studio blanc, PBR.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

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
      handle: new THREE.MeshPhysicalMaterial({ color: '#c8102e', roughness: 0.42, clearcoat: 0.2 }),
      ring: new THREE.MeshPhysicalMaterial({ color: '#e6e6e3', metalness: 1, roughness: 0.1 }),
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

  // ---------- Géométrie : master 3D validé (bottle-master/) ----------
  async loadMaster(url) {
    if (this.masterScene) return this.masterScene;
    const loader = new GLTFLoader();
    let gltf;
    if (url.endsWith('.b64.txt')) {
      // GLB encodé en base64 dans un fichier texte : pour les hébergeurs qui ne servent pas .glb
      // et bloquent les URI data: (page d'aperçu). Décodé ici, puis analysé sans requête réseau.
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Modèle 3D introuvable (${res.status})`);
      const bin = atob((await res.text()).trim());
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      gltf = await new Promise((resolve, reject) => loader.parse(bytes.buffer, '', resolve, reject));
    } else {
      const draco = new DRACOLoader();
      draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/gltf/');
      loader.setDRACOLoader(draco);
      gltf = await loader.loadAsync(url);
    }
    this.masterScene = gltf.scene;
    return this.masterScene;
  }

  async build(size, product, artwork) {
    const S = product.scale.sceneUnitsPerBodyHeight;
    const M = product.master;
    const root = await this.loadMaster(M.model);
    this.group.clear();
    const model = root.clone(true);
    model.scale.setScalar(S);
    const partOf = {};
    for (const [part, names] of Object.entries(M.parts)) names.forEach((n) => { partOf[n] = part; });
    model.traverse((o) => {
      if (/^PRINT_/.test(o.name)) { o.visible = false; return; }
      if (!o.isMesh) return;
      const part = partOf[o.name] || partOf[o.parent?.name];
      if (part) o.material = this.materials[part];
      o.castShadow = true;
      o.receiveShadow = true;
    });
    this.handleNode = model.getObjectByName(M.handleNode);
    this.handleFold = THREE.MathUtils.degToRad(M.handleFoldDeg);
    this.handleTarget = this.handleTarget || 0;
    this.group.add(model);
    this.body = model.getObjectByName('BODY');

    const R = M.bodyRadius * S;
    this.dim = { height: M.totalHeight * S, radius: R };
    this.zone = { bottom: size.printZone.bottom * S, top: size.printZone.top * S };

    // manchon d'impression : épouse la partie droite du corps (zone imprimable du master)
    const zh = this.zone.top - this.zone.bottom;
    const sleeveGeo = new THREE.CylinderGeometry(R + 0.012, R + 0.012, zh, 256, 1, true, Math.PI, Math.PI * 2);
    this.sleeve = new THREE.Mesh(sleeveGeo, new THREE.MeshPhysicalMaterial({ transparent: true, depthWrite: false }));
    this.sleeve.position.y = this.zone.bottom + zh / 2;
    this.sleeve.renderOrder = 2;
    this.sleeve.name = 'sleeve';
    this.group.add(this.sleeve);

    this.guides = new THREE.Mesh(
      new THREE.CylinderGeometry(R + 0.025, R + 0.025, zh, 256, 1, true, Math.PI, Math.PI * 2),
      new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false }),
    );
    this.guides.position.copy(this.sleeve.position);
    this.guides.renderOrder = 3;
    this.guides.visible = this.showGuides;
    this.group.add(this.guides);

    this.contact.scale.set(R * 4.2, R * 4.2, 1);
    this.bindArtwork(artwork);
    this.intro = 1;
  }

  setHandleDown(down) { this.handleTarget = down ? 1 : 0; }

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
    this.body = this.group.getObjectByName('BODY');
    if (this.body) this.body.castShadow = !fin.transmission;

    const bodyColor = fin.colorable === false ? fin.fixedColor : cfg.colors.body;
    this.colorTargets.body = new THREE.Color(bodyColor);
    this.colorTargets.cap = new THREE.Color(cfg.colors.cap);
    this.colorTargets.handle = new THREE.Color(cfg.colors.handle);
    const rf = product.ringFinishes.find((f) => f.id === cfg.colors.ring) || product.ringFinishes[0];
    this.colorTargets.ring = new THREE.Color(rf.color);
    this.materials.ring.metalness = rf.metalness;
    this.materials.ring.roughness = rf.roughness;

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
      cap:    { pos: [d * 0.2, h * 0.86, d * 0.36], target: [0, h * 0.8, 0] },
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
    for (const key of ['body', 'cap', 'handle', 'ring']) {
      const t = this.colorTargets[key];
      if (t) this.materials[key].color.lerp(t, k);
    }
    if (this.handleNode) {
      const cur = this.handleNode.rotation.x / (this.handleFold || -Math.PI / 2);
      const next = cur + (this.handleTarget - cur) * (1 - Math.exp(-dt / 0.12));
      this.handleNode.rotation.x = next * this.handleFold;
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
