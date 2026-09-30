import { BottleViewer } from './viewer.js';
import { ArtworkEngine } from './artwork.js';
import { allowedFinishes, allowedMethods, allowedZones, computePrice, sanitize } from './pricing.js';

const PRODUCT_URL = 'products/cricket-bottle/product.json';
// Point d'envoi des projets vers SKLUBS : TO_DEFINE (API, WooCommerce, CRM...).
const SUBMIT_ENDPOINT = null;

const $ = (s, r = document) => r.querySelector(s);
const el = (tag, attrs = {}, html = '') => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
  }
  if (html) n.innerHTML = html;
  return n;
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isMobile = () => matchMedia('(max-width: 860px)').matches;

const STEPS = [
  { id: 'size',     label: 'Capacité', sub: 'Format du master 3D, reconstruit sur la référence.' },
  { id: 'material', label: 'Matière',  sub: 'La matière et la finition changent le rendu réel.' },
  { id: 'colors',   label: 'Couleurs', sub: 'Corps, bouchon et anse se règlent séparément.' },
  { id: 'marking',  label: 'Marquage', sub: 'Technique, zone et visuel. Glissez le logo sur la bouteille.' },
  { id: 'quantity', label: 'Quantité', sub: 'Le prix unitaire dépend du volume.' },
  { id: 'review',   label: 'Récap',    sub: '' },
];

let product;
let cfg;
let step = 0;
let viewer;
const artwork = new ArtworkEngine();
let activeComponent = 'body';
let patternCanvas = null;

init().catch((err) => {
  console.error(err);
  $('#loading').innerHTML = `<b style="color:#111">Le configurateur n'a pas pu démarrer.</b><small>${esc(err.message)}</small>`;
});

async function init() {
  const res = await fetch(PRODUCT_URL);
  if (!res.ok) throw new Error(`Produit introuvable (${res.status})`);
  product = await res.json();

  cfg = {
    size: product.defaultSize,
    material: product.defaultMaterial,
    finish: null,
    colors: { ...product.colors.defaults },
    colorRefs: { body: '', cap: '', handle: '' },
    method: 'uv',
    zone: 'front',
    quantity: product.quantity.default,
    hasArtwork: false,
  };
  sanitize(product, cfg);

  $('#productName').textContent = product.name;
  $('#productTag').textContent = product.subtitle;
  $('#reviewTitle').textContent = product.name;

  viewer = new BottleViewer($('#viewer'));
  $('#handleBtn').addEventListener('click', (e) => {
    const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    e.currentTarget.setAttribute('aria-pressed', String(on));
    viewer.setHandleDown(on);
  });
  viewer.onView = (name) => $('#views').querySelectorAll('button').forEach((x) => x.classList.toggle('is-active', x.dataset.view === name));
  artwork.onChange = onArtworkChange;
  await rebuildModel();
  viewer.goTo('hero', true);
  setTimeout(() => viewer.goTo('front'), 250);
  $('#loading').classList.add('hidden');

  bindChrome();
  renderProgress();
  renderStep();
  update();
  initSheet();
}

// ---------- Modèle ----------
function zoneWidth() { return artwork.pattern.circumference * (artwork.zone?.widthRatio || 1); }
function ringLabel() { return product.ringFinishes.find((f) => f.id === cfg.colors.ring)?.label || '—'; }
function currentSize() { return product.sizes.find((s) => s.id === cfg.size); }

const SCALE = () => product.scale.sceneUnitsPerBodyHeight;
// Longueur affichée : mm si l'échelle usine est connue, sinon % de la zone imprimable
function fmtLen(units, ref) {
  const mm = product.scale.mmPerBodyHeight;
  if (typeof mm === 'number') return `${Math.round((units / SCALE()) * mm)} mm`;
  return `${Math.round((units / ref) * 100)} %`;
}

async function rebuildModel() {
  const size = currentSize();
  const S = SCALE();
  const r = product.master.bodyRadius * S;
  artwork.setPattern(2 * Math.PI * r, (size.printZone.top - size.printZone.bottom) * S, product.safeMargin * S);
  artwork.setZone(product.printZones.find((z) => z.id === cfg.zone));
  await viewer.build(size, product, artwork);
  viewer.applyConfig(cfg, product);
  artwork.render();
}

function onArtworkChange() {
  viewer?.refreshArtwork();
  drawPattern();
  syncSliders();
}

// ---------- Mise à jour globale ----------
function update({ model = false, materials = true } = {}) {
  sanitize(product, cfg);
  cfg.hasArtwork = !!artwork.image;
  if (model) rebuildModel();
  else if (materials) viewer.applyConfig(cfg, product);
  renderSpec();
  renderSummary();
  renderPrice();
  if (isMobile() && sheetState === 'full') setSheet('medium');
}

function labelOf(list, id) { return list.find((x) => x.id === id)?.label ?? '—'; }
function methodLabel() { return cfg.hasArtwork ? labelOf(product.printingMethods, cfg.method) : 'Sans marquage'; }
function bodyColorShown() {
  const f = product.finishes[cfg.finish];
  return f.colorable === false ? f.fixedColor : cfg.colors.body;
}

function renderSpec() {
  const size = currentSize();
  $('#specLine').innerHTML = [
    size.label,
    labelOf(product.materials, cfg.material),
    product.finishes[cfg.finish].label,
    typeof product.scale.mmPerBodyHeight === 'number' ? `H ${Math.round(product.master.totalHeight * product.scale.mmPerBodyHeight)} mm` : 'Cotes à confirmer',
  ].map((t) => `<span>${esc(t)}</span>`).join('');
}

function renderSummary() {
  const items = [
    ['Capacité', currentSize().label],
    ['Matière', labelOf(product.materials, cfg.material)],
    ['Couleurs', ['body', 'cap', 'handle'].map((c) => `<i style="background:${c === 'body' ? bodyColorShown() : cfg.colors[c]}"></i>`).join('')],
    ['Marquage', methodLabel()],
    ['Quantité', `${fmtInt(cfg.quantity)} pcs`],
  ];
  $('#sumItems').innerHTML = items.map(([k, v]) => `<div><span>${k}</span><b>${k === 'Couleurs' ? v : esc(v)}</b></div>`).join('');
}

const STATUS = {
  instant: 'Prix instantané',
  estimated: 'Prix estimé',
  factory: 'Validation usine requise',
};
let shownUnit = null;
let shownTotal = null;

function renderPrice() {
  const p = computePrice(product, cfg);
  const st = $('#priceStatus');
  st.className = `status ${p.status}`;
  st.textContent = STATUS[p.status];
  if (p.status === 'factory') {
    $('#unitPrice').textContent = 'Sur devis';
    $('#totalPrice').textContent = '—';
    shownUnit = shownTotal = null;
  } else {
    animateNumber($('#unitPrice'), shownUnit, p.unit, (v) => fmtMoney(v, p.currency));
    animateNumber($('#totalPrice'), shownTotal, p.total, (v) => fmtMoney(v, p.currency, 0));
    shownUnit = p.unit;
    shownTotal = p.total;
  }
  return p;
}

function animateNumber(node, from, to, fmt) {
  if (from == null || !isFinite(from)) { node.textContent = fmt(to); return; }
  const t0 = performance.now();
  const d = 420;
  const step = (t) => {
    const k = Math.min(1, (t - t0) / d);
    const e = 1 - Math.pow(1 - k, 3);
    node.textContent = fmt(from + (to - from) * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

const fmtInt = (n) => new Intl.NumberFormat('fr-FR').format(n);
const fmtMoney = (n, c = 'EUR', d = 2) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: c, minimumFractionDigits: d, maximumFractionDigits: d }).format(n);

// ---------- Progression ----------
function renderProgress() {
  const ol = $('#progress');
  ol.innerHTML = '';
  STEPS.forEach((s, i) => {
    const li = el('li', { class: i === step ? 'active' : i < step ? 'done' : '' });
    li.append(el('button', { onclick: () => goStep(i), 'aria-current': i === step ? 'step' : false },
      `<span class="n">${String(i + 1).padStart(2, '0')}</span><span class="lbl">${s.label}</span><span class="bar"></span>`));
    ol.append(li);
  });
}

function goStep(i) {
  if (i === step && STEPS[i].id !== 'review') return;
  const back = i < step;
  step = Math.max(0, Math.min(STEPS.length - 1, i));
  renderProgress();
  if (STEPS[step].id === 'review') { enterReview(); return; }
  exitReview();
  renderStep(back);
}

// ---------- Étapes ----------
function renderStep(back = false) {
  const s = STEPS[step];
  $('#stepIndex').textContent = `${String(step + 1).padStart(2, '0')} / ${String(STEPS.length).padStart(2, '0')}`;
  $('#stepTitle').textContent = s.label;
  $('#stepSub').textContent = s.sub;
  const body = $('#panelBody');
  body.innerHTML = '';
  body.classList.remove('enter', 'enter-back');
  void body.offsetWidth;
  body.classList.add(back ? 'enter-back' : 'enter');
  body.scrollTop = 0;
  patternCanvas = null;
  ({ size: stepSize, material: stepMaterial, colors: stepColors, marking: stepMarking, quantity: stepQuantity })[s.id]?.(body);
  $('#prevBtn').disabled = step === 0;
  $('#nextBtn').textContent = step === STEPS.length - 2 ? 'Voir le récapitulatif' : 'Continuer';
  if (s.id === 'marking') viewer.goTo(cfg.zone === 'back' ? 'back' : 'front');
  if (s.id === 'colors' && activeComponent !== 'body') viewer.goTo('cap');
}

function group(label, extra = '') {
  const g = el('div', { class: 'group' });
  g.append(el('div', { class: 'label' }, `<span>${label}</span>${extra}`));
  return g;
}
const flag = (confirmed) => (confirmed === false ? '<span class="flag">à confirmer</span>' : '');

function stepSize(body) {
  const g = group('Capacité');
  const opts = el('div', { class: 'options' });
  product.sizes.forEach((s) => {
    opts.append(el('button', {
      class: `opt ${cfg.size === s.id ? 'is-active' : ''}`,
      onclick: () => { cfg.size = s.id; update({ model: true }); renderStep(); },
    }, `<div class="t">${esc(s.label)}${flag(s.confirmed)}</div>
        <span class="k">Capacité : à confirmer usine · master 3D validé sur la référence</span>`));
  });
  g.append(opts);
  body.append(g);
  body.append(el('p', { class: 'note' }, 'Forme reconstruite au pixel près sur la photo de référence. Capacité, cotes et autres formats : à confirmer avec l\'usine.'));
}

function stepMaterial(body) {
  const g = group('Matière');
  const opts = el('div', { class: 'options' });
  product.materials.forEach((m) => {
    const methods = allowedMethods(product, m.id).map((x) => x.label).join(' · ');
    opts.append(el('button', {
      class: `opt ${cfg.material === m.id ? 'is-active' : ''}`,
      onclick: () => { cfg.material = m.id; cfg.finish = m.defaultFinish; update(); renderStep(); },
    }, `<div class="t">${esc(m.label)}${flag(m.confirmed)}</div><div class="d">${esc(methods)}</div>`));
  });
  g.append(opts);
  body.append(g);

  const f = group('Finition');
  const chips = el('div', { class: 'chips' });
  allowedFinishes(product, cfg.material).forEach((fin) => {
    chips.append(el('button', {
      class: `chip ${cfg.finish === fin.id ? 'is-active' : ''}`,
      onclick: () => { cfg.finish = fin.id; update(); renderStep(); viewer.goTo('detail'); },
    }, esc(fin.label)));
  });
  f.append(chips);
  body.append(f);
  if (product.finishes[cfg.finish].colorable === false) {
    body.append(el('p', { class: 'note' }, 'Finition naturelle : la couleur du corps est celle du métal.'));
  }
}

function stepColors(body) {
  const tabs = el('div', { class: 'tabs', role: 'tablist' });
  product.components.forEach((c) => {
    const color = c.id === 'body' ? bodyColorShown() : c.id === 'ring' ? (product.ringFinishes.find((f) => f.id === cfg.colors.ring)?.color || '#ccc') : cfg.colors[c.id];
    tabs.append(el('button', {
      class: activeComponent === c.id ? 'is-active' : '', role: 'tab', 'aria-selected': activeComponent === c.id ? 'true' : 'false',
      onclick: () => { activeComponent = c.id; renderStep(); viewer.goTo(c.id === 'body' ? 'front' : 'cap'); },
    }, `<span class="dot" style="background:${color}"></span>${esc(c.label)}`));
  });
  body.append(tabs);

  if (activeComponent === 'ring') {
    const rg = group('Finition de la bague', `<b>${esc(ringLabel())}</b>`);
    const chips = el('div', { class: 'chips' });
    product.ringFinishes.forEach((f) => chips.append(el('button', {
      class: `chip ${cfg.colors.ring === f.id ? 'is-active' : ''}`,
      onclick: () => { cfg.colors.ring = f.id; update(); renderStep(); viewer.goTo('cap'); },
    }, `${esc(f.label)}${f.confirmed === false ? ' <span class="flag">à confirmer</span>' : ''}`)));
    rg.append(chips);
    body.append(rg);
    body.append(el('p', { class: 'note' }, 'La bague métallique sépare le corps du bouchon. Inox poli : finition visible sur la référence.'));
    return;
  }
  const locked = activeComponent === 'body' && product.finishes[cfg.finish].colorable === false;
  const g = group(`Couleur ${labelOf(product.components, activeComponent).toLowerCase()}`, `<b>${esc(currentColorName())}</b>`);
  if (locked) {
    g.append(el('p', { class: 'note' }, 'Inox brossé naturel : pas de coloration du corps. Choisissez une finition peinte pour colorer.'));
    body.append(g);
    return;
  }
  const sw = el('div', { class: 'swatches' });
  product.colors.catalog.forEach((c) => {
    sw.append(el('button', {
      class: `swatch ${cfg.colors[activeComponent].toLowerCase() === c.hex.toLowerCase() ? 'is-active' : ''}`,
      style: `background:${c.hex}`, title: c.label, 'aria-label': c.label,
      onclick: () => setColor(c.hex, ''),
    }));
  });
  const custom = !product.colors.catalog.some((c) => c.hex.toLowerCase() === cfg.colors[activeComponent].toLowerCase());
  sw.append(el('button', { class: `swatch custom ${custom ? 'is-active' : ''}`, title: 'Couleur personnalisée', 'aria-label': 'Couleur personnalisée', onclick: () => $('#pick')?.click() }));
  g.append(sw);
  body.append(g);

  const cg = group('Couleur personnalisée');
  const row = el('div', { class: 'custom-color' });
  const hex = cfg.colors[activeComponent];
  const picker = el('input', { type: 'color', id: 'pick', value: hex, 'aria-label': 'Sélecteur' });
  const hexIn = el('label', { class: 'field' }, `<span>HEX</span>`);
  const hexInput = el('input', { class: 'input', value: hex.toUpperCase(), maxlength: 7, spellcheck: 'false' });
  hexIn.append(hexInput);
  const rgbIn = el('label', { class: 'field' }, `<span>RGB</span>`);
  const rgbInput = el('input', { class: 'input', value: hexToRgb(hex).join(', '), spellcheck: 'false' });
  rgbIn.append(rgbInput);
  picker.addEventListener('input', () => setColor(picker.value, null, false));
  picker.addEventListener('change', () => renderStep());
  hexInput.addEventListener('change', () => {
    const v = normalizeHex(hexInput.value);
    if (v) setColor(v); else toast('Format HEX attendu : #RRGGBB');
  });
  rgbInput.addEventListener('change', () => {
    const p = rgbInput.value.split(/[,\s]+/).map(Number).filter((n) => !Number.isNaN(n));
    if (p.length === 3 && p.every((n) => n >= 0 && n <= 255)) setColor(rgbToHex(p)); else toast('Format RGB attendu : 255, 107, 0');
  });
  row.append(picker, hexIn, rgbIn);
  cg.append(row);
  const ref = el('label', { class: 'field', style: 'margin-top:10px' }, '<span>Référence Pantone / usine (optionnel)</span>');
  const refInput = el('input', { class: 'input', value: cfg.colorRefs[activeComponent] || '', placeholder: 'ex. PMS 186 C' });
  refInput.addEventListener('input', () => { cfg.colorRefs[activeComponent] = refInput.value.trim(); });
  ref.append(refInput);
  cg.append(ref);
  cg.append(el('p', { class: 'note' }, 'Les couleurs écran sont indicatives. Une référence Pantone garantit la teinte en production.'));
  body.append(cg);
}

function currentColorName() {
  const hex = activeComponent === 'body' ? bodyColorShown() : cfg.colors[activeComponent];
  return product.colors.catalog.find((c) => c.hex.toLowerCase() === hex.toLowerCase())?.label || hex.toUpperCase();
}

function setColor(hex, ref = null, rerender = true) {
  cfg.colors[activeComponent] = hex;
  if (ref !== null) cfg.colorRefs[activeComponent] = ref;
  update({ materials: true });
  artwork.render();
  if (rerender) renderStep();
}

function stepMarking(body) {
  const mg = group('Technique');
  const chips = el('div', { class: 'chips' });
  const allowed = allowedMethods(product, cfg.material);
  product.printingMethods.forEach((m) => {
    if (!allowed.some((a) => a.id === m.id)) return; // jamais de technique impossible
    chips.append(el('button', {
      class: `chip ${cfg.method === m.id ? 'is-active' : ''}`,
      onclick: () => { cfg.method = m.id; update(); renderStep(); },
    }, esc(m.label)));
  });
  mg.append(chips);
  const method = product.printingMethods.find((m) => m.id === cfg.method);
  if (method?.render === 'engrave') mg.append(el('p', { class: 'note' }, 'Gravure : le visuel devient monochrome et révèle le métal. Rendu réagissant à la lumière.'));
  body.append(mg);

  const zg = group('Zone');
  const zc = el('div', { class: 'chips' });
  allowedZones(product, cfg.method).forEach((z) => {
    zc.append(el('button', {
      class: `chip ${cfg.zone === z.id ? 'is-active' : ''}`,
      onclick: () => {
        cfg.zone = z.id;
        artwork.setZone(z);
        if (z.id === 'wrap') artwork.t.x = 0;
        artwork.render();
        update();
        renderStep();
        viewer.goTo(z.id === 'back' ? 'back' : z.id === 'wrap' ? 'side' : 'front');
      },
    }, esc(z.label)));
  });
  zg.append(zc);
  body.append(zg);

  const ag = group('Visuel', artwork.image ? '' : '<b>PNG · JPG · SVG</b>');
  if (!artwork.image) {
    const drop = el('button', { class: 'drop', onclick: () => $('#fileInput').click() },
      `<svg viewBox="0 0 24 24" style="width:22px;height:22px"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>
       <span class="t">Importer votre logo</span><span class="d">Glissez un fichier ici ou cliquez. Idéalement PNG transparent ou SVG.</span>`);
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('over')));
    drop.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); });
    ag.append(drop);
  } else {
    const row = el('div', { class: 'file-row' });
    const th = el('span', { class: 'thumb' });
    th.style.backgroundImage = `url(${artwork.image.toDataURL()})`;
    row.append(th, el('span', { class: 'n' }, esc(artwork.name)),
      el('button', { onclick: () => $('#fileInput').click() }, 'Remplacer'),
      el('button', { onclick: () => { artwork.clear(); artwork.render(); update(); renderStep(); } }, 'Retirer'));
    ag.append(row);
  }
  body.append(ag);

  const pg = group('Patron déroulé', '<b>2D ↔ 3D</b>');
  const wrap = el('div', { class: 'pattern-wrap' });
  patternCanvas = el('canvas');
  const cw = 820;
  patternCanvas.width = cw;
  patternCanvas.height = Math.round((cw * artwork.pattern.height) / artwork.pattern.circumference);
  wrap.append(patternCanvas);
  pg.append(wrap);
  pg.append(el('div', { class: 'pattern-cap' }, `<span>360° · déroulé du corps</span><span>${typeof product.scale.mmPerBodyHeight === 'number' ? fmtLen(artwork.pattern.circumference) : 'cotes à confirmer'}</span>`));
  bindPatternDrag(patternCanvas);

  if (artwork.image) {
    pg.append(slider('Taille', 'size', 0.5, artwork.maxWidth(), 0.1, artwork.t.width, (v) => fmtLen(v, zoneWidth()), (v) => { artwork.t.width = v; }));
    pg.append(slider('Rotation', 'rot', -180, 180, 1, artwork.t.rotation, (v) => `${Math.round(v)}°`, (v) => { artwork.t.rotation = v; }));
    const acts = el('div', { class: 'mini-actions' });
    acts.append(
      el('button', { class: 'chip', onclick: () => { artwork.t.x = 0; artwork.t.y = 0; artwork.clampTransform(); artwork.render(); } }, 'Centrer'),
      el('button', { class: 'chip', onclick: () => { artwork.t.width = artwork.maxWidth(); artwork.t.x = 0; artwork.t.y = 0; artwork.clampTransform(); artwork.render(); } }, 'Taille max'),
      el('button', { class: 'chip', onclick: () => { artwork.t.rotation = 0; artwork.render(); } }, 'Rotation 0°'),
    );
    pg.append(acts);
  }
  body.append(pg);
  drawPattern();
}

function slider(label, key, min, max, stepV, value, fmt, apply) {
  const row = el('label', { class: 'slider' }, `<span>${label}</span>`);
  const input = el('input', { type: 'range', min, max, step: stepV, value, 'data-key': key });
  const out = el('output', {}, fmt(value));
  input.addEventListener('input', () => {
    apply(Number(input.value));
    artwork.clampTransform();
    artwork.render();
    out.textContent = fmt(Number(input.value));
  });
  input._fmt = fmt;
  input._out = out;
  row.append(input, out);
  return row;
}

function syncSliders() {
  const s = $('input[data-key="size"]');
  if (s && document.activeElement !== s) { s.max = artwork.maxWidth(); s.value = artwork.t.width; s._out.textContent = s._fmt(artwork.t.width); }
  const r = $('input[data-key="rot"]');
  if (r && document.activeElement !== r) { r.value = artwork.t.rotation; r._out.textContent = r._fmt(artwork.t.rotation); }
}

function drawPattern() {
  if (!patternCanvas) return;
  artwork.drawEditor(patternCanvas, { bodyColor: bodyColorShown(), engrave: product.printingMethods.find((m) => m.id === cfg.method)?.render === 'engrave', engraveColor: viewer.engraveColor || '#c9cac7' });
}

function bindPatternDrag(canvas) {
  let drag = null;
  const uv = (e) => {
    const r = canvas.getBoundingClientRect();
    return { u: (e.clientX - r.left) / r.width, v: 1 - (e.clientY - r.top) / r.height };
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (!artwork.image) { $('#fileInput').click(); return; }
    const p = uv(e);
    const c = artwork.uvToCm(p.u, p.v);
    if (artwork.hit(p.u, p.v)) drag = { dx: artwork.t.x - c.x, dy: artwork.t.y - c.y };
    else { drag = { dx: 0, dy: 0 }; artwork.t.x = c.x; artwork.t.y = c.y; artwork.clampTransform(); artwork.render(); }
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = uv(e);
    const c = artwork.uvToCm(p.u, p.v);
    artwork.t.x = c.x + drag.dx;
    artwork.t.y = c.y + drag.dy;
    artwork.clampTransform();
    artwork.render();
  });
  const end = () => { drag = null; };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', (e) => {
    if (!artwork.image) return;
    e.preventDefault();
    artwork.t.width *= e.deltaY < 0 ? 1.05 : 0.95;
    artwork.clampTransform();
    artwork.render();
  }, { passive: false });
}

async function handleFile(file) {
  const okTypes = ['image/png', 'image/jpeg', 'image/svg+xml'];
  if (!okTypes.includes(file.type)) {
    toast(file.type === 'application/pdf' ? 'PDF : envoyez-le avec le projet, l\'aperçu 3D accepte PNG, JPG ou SVG.' : 'Formats acceptés : PNG, JPG, SVG.');
    return;
  }
  if (file.size > 15 * 1024 * 1024) { toast('Fichier trop lourd (15 Mo max).'); return; }
  try {
    await artwork.loadFile(file);
    artwork.render();
    update();
    if (STEPS[step].id !== 'marking') goStep(STEPS.findIndex((s) => s.id === 'marking'));
    else renderStep();
    viewer.goTo(cfg.zone === 'back' ? 'back' : 'front');
    toast('Visuel appliqué. Glissez-le directement sur la bouteille.');
  } catch (err) {
    toast(`Lecture impossible : ${err.message}`);
  }
}

function stepQuantity(body) {
  const g = group('Quantité');
  const q = el('div', { class: 'qty' });
  const input = el('input', { type: 'number', min: 1, step: 1, value: cfg.quantity, inputmode: 'numeric', 'aria-label': 'Quantité' });
  const set = (v) => { cfg.quantity = Math.max(1, Math.round(v) || 1); input.value = cfg.quantity; update({ materials: false }); markPresets(); };
  q.append(el('button', { 'aria-label': 'Moins', onclick: () => set(cfg.quantity - stepFor(cfg.quantity)) }, '−'), input,
    el('button', { 'aria-label': 'Plus', onclick: () => set(cfg.quantity + stepFor(cfg.quantity)) }, '+'));
  input.addEventListener('change', () => set(Number(input.value)));
  g.append(q, el('div', { class: 'qty-unit' }, 'pièces'));
  body.append(g);

  const pg = group('Paliers');
  const chips = el('div', { class: 'chips' });
  product.quantity.presets.forEach((n) => chips.append(el('button', { class: 'chip', 'data-q': n, onclick: () => set(n) }, fmtInt(n))));
  pg.append(chips);
  body.append(pg);
  const markPresets = () => chips.querySelectorAll('.chip').forEach((c) => c.classList.toggle('is-active', Number(c.dataset.q) === cfg.quantity));
  markPresets();

  const p = computePrice(product, cfg);
  const moq = product.quantity.moq;
  body.append(el('p', { class: `note ${p.status === 'factory' ? 'warn' : ''}` },
    p.status === 'factory'
      ? `Tarifs usine non encore renseignés${moq === 'TO_DEFINE' ? ' (MOQ inclus)' : ''} : votre projet sera chiffré par SKLUBS après validation. Aucun prix n'est affiché tant qu'il n'est pas confirmé.`
      : p.belowMoq ? `Minimum de commande : ${fmtInt(moq)} pièces.` : ''));
  if (product.reference?.quantity) body.append(el('p', { class: 'note' }, `Référence devis Cricket : ${fmtInt(product.reference.quantity)} pièces.`));
}
const stepFor = (q) => (q < 100 ? 10 : q < 1000 ? 50 : 250);

// ---------- Récapitulatif ----------
function enterReview() {
  $('#app').classList.add('is-review');
  const size = currentSize();
  const dot = (h) => `<i style="background:${h}"></i>`;
  const ref = (c) => (cfg.colorRefs[c] ? ` · ${esc(cfg.colorRefs[c])}` : '');
  const rows = [
    ['Produit', esc(product.name)],
    ['Capacité', esc(size.label)],
    ['Matière', `${esc(labelOf(product.materials, cfg.material))} · ${esc(product.finishes[cfg.finish].label)}`],
    ['Corps', `${esc(bodyColorShown().toUpperCase())}${ref('body')}${dot(bodyColorShown())}`],
    ['Bouchon', `${esc(cfg.colors.cap.toUpperCase())}${ref('cap')}${dot(cfg.colors.cap)}`],
    ['Anse', `${esc(cfg.colors.handle.toUpperCase())}${ref('handle')}${dot(cfg.colors.handle)}`],
    ['Bague', esc(ringLabel())],
    ['Marquage', cfg.hasArtwork ? `${esc(methodLabel())} · ${esc(labelOf(product.printZones, cfg.zone))}` : 'Sans marquage'],
    ['Visuel', cfg.hasArtwork ? `${esc(artwork.name)} · ${fmtLen(artwork.t.width, zoneWidth())}` : '—'],
    ['Quantité', `${fmtInt(cfg.quantity)} pcs`],
  ];
  $('#reviewList').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  const p = computePrice(product, cfg);
  $('#reviewPrice').innerHTML = p.status === 'factory'
    ? `<div class="row"><span class="status factory">${STATUS.factory}</span></div><p>Cette configuration sera chiffrée par SKLUBS. Envoyez le projet : aperçu, visuel et paramètres sont joints.</p>`
    : `<div class="row"><span>Prix / unité</span><b>${fmtMoney(p.unit, p.currency)}</b></div><div class="row"><span>Total</span><b>${fmtMoney(p.total, p.currency, 0)}</b></div><p>${STATUS[p.status]}</p>`;
  $('#sendBtn').textContent = p.status === 'factory' ? 'Envoyer à SKLUBS' : 'Demander le devis';
  viewer.setGuides(false);
  $('#guidesBtn').setAttribute('aria-pressed', 'false');
  if (isMobile()) viewer.setFrameShift(0.24);
  viewer.goTo('hero');
  setTimeout(() => { viewer.setAutoRotate(true); $('#rotateBtn').setAttribute('aria-pressed', 'true'); }, 900);
}

function exitReview() {
  if (!$('#app').classList.contains('is-review')) return;
  $('#app').classList.remove('is-review');
  viewer.setFrameShift(0);
  viewer.setAutoRotate(false);
  $('#rotateBtn').setAttribute('aria-pressed', 'false');
  viewer.goTo('front');
}

// ---------- Projet ----------
function buildProject() {
  const size = currentSize();
  const p = computePrice(product, cfg);
  return {
    product_id: product.id,
    variant_id: `${product.id}-${size.id}`,
    size: size.id,
    materials: { material: cfg.material, finish: cfg.finish },
    colors: { body: bodyColorShown(), cap: cfg.colors.cap, handle: cfg.colors.handle, ring: cfg.colors.ring },
    color_refs: cfg.colorRefs,
    artwork: artwork.image ? { file: artwork.name, data_url: artwork.image.toDataURL('image/png') } : null,
    artwork_transform: artwork.image ? {
      units: 'BODY_HEIGHT', x: +(artwork.t.x / SCALE()).toFixed(4), y: +(artwork.t.y / SCALE()).toFixed(4), width: +(artwork.t.width / SCALE()).toFixed(4),
      width_pct_zone: Math.round((artwork.t.width / zoneWidth()) * 100), rotation_deg: artwork.t.rotation,
      mm: typeof product.scale.mmPerBodyHeight === 'number' ? { x: (artwork.t.x / SCALE()) * product.scale.mmPerBodyHeight, y: (artwork.t.y / SCALE()) * product.scale.mmPerBodyHeight, width: (artwork.t.width / SCALE()) * product.scale.mmPerBodyHeight } : 'TO_DEFINE_FACTORY',
    } : null,
    model: product.master.model,
    printing_method: cfg.hasArtwork ? cfg.method : null,
    print_zones: cfg.hasArtwork ? [cfg.zone] : [],
    quantity: cfg.quantity,
    pricing: { status: p.status, unit: p.unit, total: p.total, currency: p.currency, missing: p.reasons },
    camera_preview: viewer.cameraState(),
    preview_image: viewer.snapshot(),
    timestamp: new Date().toISOString(),
  };
}

function download(name, href) {
  const a = el('a', { href, download: name });
  document.body.append(a);
  a.click();
  a.remove();
}

function exportProject() {
  if (window.SKLUBS_PREVIEW) {
    toast('Aperçu en ligne : le téléchargement est bloqué ici. Il fonctionne sur le site SKLUBS.');
    return buildProject();
  }
  const proj = buildProject();
  const stamp = proj.timestamp.slice(0, 19).replace(/[:T]/g, '-');
  download(`sklubs-${proj.product_id}-${stamp}.png`, proj.preview_image);
  const blob = new Blob([JSON.stringify(proj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  download(`sklubs-${proj.product_id}-${stamp}.json`, url);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return proj;
}

async function sendProject() {
  if (!SUBMIT_ENDPOINT) {
    exportProject();
    if (!window.SKLUBS_PREVIEW) toast('Envoi en ligne à brancher (point d\'envoi SKLUBS à définir). Projet et aperçu téléchargés.');
    return;
  }
  const btn = $('#sendBtn');
  btn.disabled = true;
  try {
    const res = await fetch(SUBMIT_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildProject()) });
    if (!res.ok) throw new Error(res.status);
    toast('Projet envoyé à SKLUBS.');
  } catch {
    toast('Envoi impossible. Le projet a été téléchargé à la place.');
    exportProject();
  } finally {
    btn.disabled = false;
  }
}

// ---------- Chrome ----------
function bindChrome() {
  $('#prevBtn').addEventListener('click', () => goStep(step - 1));
  $('#nextBtn').addEventListener('click', () => goStep(step + 1));
  $('#ctaBtn').addEventListener('click', () => goStep(STEPS.length - 1));
  $('#editBtn').addEventListener('click', () => goStep(STEPS.length - 2));
  $('#sendBtn').addEventListener('click', sendProject);
  $('#downloadBtn').addEventListener('click', () => { exportProject(); if (!window.SKLUBS_PREVIEW) toast('Aperçu PNG et fichier projet téléchargés.'); });
  $('#fileInput').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) handleFile(f); e.target.value = ''; });

  $('#views').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-view]');
    if (!b) return;
    viewer.goTo(b.dataset.view);
  });
  $('#resetBtn').addEventListener('click', () => viewer.goTo('front'));
  $('#rotateBtn').addEventListener('click', (e) => {
    const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    e.currentTarget.setAttribute('aria-pressed', String(on));
    viewer.setAutoRotate(on);
  });
  $('#guidesBtn').addEventListener('click', (e) => {
    const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    e.currentTarget.setAttribute('aria-pressed', String(on));
    viewer.setGuides(on);
  });
  // Déposer un fichier n'importe où sur la bouteille
  const v = $('#viewer');
  v.addEventListener('dragover', (e) => e.preventDefault());
  v.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); });
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3600);
}

// ---------- Bottom sheet mobile ----------
let sheetState = 'medium';
const SHEET = { collapsed: () => 150, medium: () => stageH() * 0.5, full: () => stageH() * 0.9 };
const stageH = () => $('.stage').clientHeight;

function setSheet(state) {
  sheetState = state;
  $('#panel').dataset.state = state;
  $('.stage').style.setProperty('--sheet-h', `${Math.round(SHEET[state]())}px`);
}

function initSheet() {
  const panel = $('#panel');
  const stage = $('.stage');
  const handleEls = [$('#sheetHandle'), $('.panel-head')];
  let start = null;
  handleEls.forEach((h) => {
    h.addEventListener('pointerdown', (e) => {
      if (!isMobile()) return;
      start = { y: e.clientY, h: panel.getBoundingClientRect().height, moved: false };
      stage.classList.add('dragging');
      h.setPointerCapture(e.pointerId);
    });
    h.addEventListener('pointermove', (e) => {
      if (!start) return;
      const dy = start.y - e.clientY;
      if (Math.abs(dy) > 4) start.moved = true;
      const hpx = Math.min(SHEET.full(), Math.max(110, start.h + dy));
      stage.style.setProperty('--sheet-h', `${hpx}px`);
    });
    const end = () => {
      if (!start) return;
      stage.classList.remove('dragging');
      const cur = panel.getBoundingClientRect().height;
      if (!start.moved) {
        setSheet(sheetState === 'collapsed' ? 'medium' : sheetState === 'medium' ? 'full' : 'collapsed');
      } else {
        const best = Object.keys(SHEET).reduce((a, b) => (Math.abs(SHEET[b]() - cur) < Math.abs(SHEET[a]() - cur) ? b : a));
        setSheet(best);
      }
      start = null;
    };
    h.addEventListener('pointerup', end);
    h.addEventListener('pointercancel', end);
  });
  setSheet('medium');
  addEventListener('resize', () => setSheet(sheetState));
}

function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rgbToHex(a) { return `#${a.map((n) => Math.round(n).toString(16).padStart(2, '0')).join('')}`; }
function normalizeHex(v) {
  let s = v.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(s)) s = s.split('').map((c) => c + c).join('');
  return /^[0-9a-f]{6}$/i.test(s) ? `#${s.toLowerCase()}` : null;
}
