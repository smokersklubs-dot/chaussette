// Bouteille vitrine de l'accueil : master 3D du produit, couleurs, logo, animation légère.
// Plus simple que le viewer du configurateur : pas de marquage, pas d'étapes, rendu suspendu hors écran.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { loadGLB } from './glb.js';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

export class ShowBottle {
  constructor(container, { tilt = 0, yaw = -0.35, drag = false, fill = 0.86, logo = 'SKLUBS' } = {}) {
    this.container = container;
    this.opts = { tilt, yaw, drag, fill, logo };
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }));
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 0.82; // couleurs saturées (orange SKLUBS) sans délavage
    container.appendChild(r.domElement);

    this.scene = new THREE.Scene();
    this.scene.environment = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.7;
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#e9e7e2', 0.4));
    const key = new THREE.DirectionalLight('#ffffff', 2.2); key.position.set(-22, 40, 30); this.scene.add(key);
    const fillL = new THREE.DirectionalLight('#f3f5ff', 0.6); fillL.position.set(30, 10, 20); this.scene.add(fillL);
    const rim = new THREE.DirectionalLight('#ffffff', 1.8); rim.position.set(10, 24, -34); this.scene.add(rim);

    this.camera = new THREE.PerspectiveCamera(24, 1, 1, 500);
    this.pivot = new THREE.Group();
    this.scene.add(this.pivot);
    this.materials = {
      body: new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.6 }),
      cap: new THREE.MeshPhysicalMaterial({ color: '#202023', roughness: 0.45, clearcoat: 0.3 }),
      handle: new THREE.MeshPhysicalMaterial({ color: '#202023', roughness: 0.42, clearcoat: 0.2 }),
      ring: new THREE.MeshPhysicalMaterial({ color: '#e6e6e3', metalness: 1, roughness: 0.1 }),
    };
    this.targets = {};
    this.pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    this.spin = 0; this.spinVel = 0; this.dragging = false;
    this.clock = new THREE.Clock();
    this.visible = true;

    this.resize();
    new ResizeObserver(() => this.resize()).observe(container);
    new IntersectionObserver(([e]) => { this.visible = e.isIntersecting; this.loop(); }).observe(container);
    this.bindPointer();
  }

  async load(product) {
    const S = product.scale?.sceneUnitsPerBodyHeight || 20;
    const M = product.master;
    const size = product.sizes.find((s) => s.id === product.defaultSize) || product.sizes[0];
    const root = await loadGLB(M.model);
    const model = root.clone(true);
    model.scale.setScalar(S);
    const partOf = {};
    for (const [part, names] of Object.entries(M.parts)) names.forEach((n) => { partOf[n] = part; });
    model.traverse((o) => {
      if (/^PRINT_/.test(o.name)) { o.visible = false; return; }
      if (!o.isMesh) return;
      const part = partOf[o.name] || partOf[o.parent?.name];
      if (part) o.material = this.materials[part];
    });
    const H = M.totalHeight * S, R = M.bodyRadius * S;
    model.position.y = -H / 2;
    this.pivot.clear();
    this.pivot.add(model);
    this.H = H;

    // logo de démonstration sur la face avant, dans la zone imprimable
    if (this.opts.logo) {
      const zb = size.printZone.bottom * S, zt = size.printZone.top * S, zh = zt - zb;
      this.logoCanvas = document.createElement('canvas');
      this.logoCanvas.width = 2048;
      this.logoCanvas.height = Math.round(2048 * zh / (2 * Math.PI * R));
      this.logoTex = new THREE.CanvasTexture(this.logoCanvas);
      this.logoTex.colorSpace = THREE.SRGBColorSpace;
      this.logoTex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      const sleeve = new THREE.Mesh(
        new THREE.CylinderGeometry(R + 0.012, R + 0.012, zh, 192, 1, true, Math.PI, Math.PI * 2),
        new THREE.MeshPhysicalMaterial({ map: this.logoTex, transparent: true, depthWrite: false, roughness: 0.5, alphaTest: 0.04 }),
      );
      sleeve.position.y = zb + zh / 2 - H / 2;
      sleeve.renderOrder = 2;
      this.pivot.add(sleeve);
      await document.fonts?.load?.('800 120px "Inter Tight"').catch(() => {});
    }
    this.ringFinishes = product.ringFinishes;
    this.resize();
    this.loop();
    return this;
  }

  drawLogo(light) {
    if (!this.logoCanvas) return;
    const c = this.logoCanvas, g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = light ? '#111111' : '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const px = Math.round(c.width * 0.05);
    g.font = `800 ${px}px "Inter Tight", system-ui, sans-serif`;
    if ('letterSpacing' in g) g.letterSpacing = `${Math.round(px * 0.06)}px`;
    g.fillText(this.opts.logo, c.width / 2, c.height * 0.5);
    this.logoTex.needsUpdate = true;
  }

  setColors({ body, cap, handle, ring = 'polished' }, instant = false) {
    const t = this.targets;
    if (body) t.body = new THREE.Color(body);
    if (cap) t.cap = new THREE.Color(cap);
    if (handle) t.handle = new THREE.Color(handle);
    const rf = this.ringFinishes?.find((f) => f.id === ring);
    if (rf) { t.ring = new THREE.Color(rf.color); this.materials.ring.metalness = rf.metalness; this.materials.ring.roughness = rf.roughness; }
    if (body) {
      const hsl = {}; new THREE.Color(body).getHSL(hsl);
      this.drawLogo(hsl.l > 0.72);
    }
    if (instant) for (const [k, c] of Object.entries(t)) this.materials[k].color.copy(c);
    this.loop();
  }

  bindPointer() {
    const el = this.renderer.domElement;
    const host = this.opts.drag ? el : window;
    host.addEventListener('pointermove', (e) => {
      if (this.dragging) {
        this.spinVel = (e.clientX - this.lastX) * 0.012;
        this.spin += this.spinVel;
        this.lastX = e.clientX;
        return;
      }
      const r = this.container.getBoundingClientRect();
      this.pointer.tx = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width - 0.5) * 2));
      this.pointer.ty = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height - 0.5) * 2));
    }, { passive: true });
    if (!this.opts.drag) return;
    el.style.touchAction = 'pan-y';
    el.style.cursor = 'grab';
    el.addEventListener('pointerdown', (e) => { this.dragging = true; this.lastX = e.clientX; el.setPointerCapture(e.pointerId); el.style.cursor = 'grabbing'; });
    const stop = () => { this.dragging = false; el.style.cursor = 'grab'; };
    el.addEventListener('pointerup', stop);
    el.addEventListener('pointercancel', stop);
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // recadrage : la bouteille (inclinée comprise) occupe « fill » de la hauteur ou de la largeur
    const H = (this.H || 26) * (1 + Math.abs(Math.sin(this.opts.tilt)) * 0.12);
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    const dH = (H / 2) / Math.tan(vfov / 2) / this.opts.fill;
    const dW = (H * 0.42) / Math.tan(vfov / 2) / this.camera.aspect / this.opts.fill;
    const d = Math.max(dH, dW);
    this.camera.position.set(0, H * 0.06, d);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
    this.loop();
  }

  loop() {
    const run = this.visible && this.pivot.children.length;
    this.renderer.setAnimationLoop(run ? () => this.tick() : null);
  }

  tick() {
    const dt = Math.min(this.clock.getDelta(), 0.05), t = this.clock.elapsedTime;
    const p = this.pointer;
    p.x += (p.tx - p.x) * 0.06; p.y += (p.ty - p.y) * 0.06;
    if (!this.dragging) { this.spin += this.spinVel; this.spinVel *= 0.94; }
    const idle = reduced ? 0 : (this.opts.drag ? t * 0.18 : Math.sin(t * 0.4) * 0.28);
    this.pivot.rotation.set(p.y * 0.1, this.opts.yaw + idle + this.spin + p.x * 0.3, this.opts.tilt + (reduced ? 0 : Math.sin(t * 0.6) * 0.015));
    this.pivot.position.y = reduced ? 0 : Math.sin(t * 0.9) * (this.H || 26) * 0.008;
    const k = 1 - Math.pow(0.0015, dt);
    for (const [name, c] of Object.entries(this.targets)) this.materials[name].color.lerp(c, k);
    this.renderer.render(this.scene, this.camera);
  }
}
