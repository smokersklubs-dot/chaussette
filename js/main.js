import { BottleViewer } from './viewer.js';
import { loadProduct } from './data.js';
import { ArtworkEngine } from './artwork.js';
import { allowedFinishes, allowedMethods, allowedZones, computePrice, sanitize } from './pricing.js';

// ?produit=<id> ; couleurs de départ choisies sur l'accueil : &couleur=, &bouchon=, &anse= (HEX sans #)
// La page d'aperçu (une seule page) fournit ces paramètres dans window.SKLUBS_PREVIEW_PARAMS.
const params = () => new URLSearchParams(window.SKLUBS_PREVIEW_PARAMS ?? location.search);
let PRODUCT_ID;
function colorsFromUrl() {
  const p = params(), out = {};
  for (const [key, part] of [['couleur', 'body'], ['bouchon', 'cap'], ['anse', 'handle']]) {
    const v = (p.get(key) || '').replace(/^#/, '');
    if (/^[0-9a-f]{6}$/i.test(v)) out[part] = `#${v.toUpperCase()}`;
  }
  return out;
}
// Point d'envoi direct (API) : optionnel. Sur le site, l'envoi passe par la page parente (voir integration/wordpress).
const SUBMIT_ENDPOINT = null;
// Pages autorisées à intégrer le configurateur et à recevoir les projets (postMessage)
const PARENT_ORIGINS = ['https://sklubs.fr', 'https://www.sklubs.fr', 'https://sklubs.com', 'https://www.sklubs.com'];
const parentOrigin = (() => {
  if (window.parent === window) return null;
  try {
    const o = document.referrer ? new URL(document.referrer).origin : null;
    return PARENT_ORIGINS.includes(o) ? o : null;
  } catch { return null; }
})();

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
  { id: 'material', label: 'Matière & couleur',      short: 'Matière',   sub: 'Choisissez la matière, la couleur et la finition.' },
  { id: 'cap',      label: 'Bouchon & détails',      short: 'Bouchon',   sub: 'Personnalisez bouchon, anse et anneau métallique.' },
  { id: 'custom',   label: 'Personnalisation',       short: 'Logo',      sub: 'Ajoutez votre logo, un texte ou un design.' },
  { id: 'preview',  label: "Aperçu d'impression",    short: 'Aperçu',    sub: 'Vue 3D et gabarit 2D déroulé.' },
  { id: 'method',   label: "Méthode d'impression",   short: 'Méthode',   sub: 'Choisissez la technique adaptée.' },
  { id: 'quantity', label: 'Quantité & prix',        short: 'Quantité',  sub: 'Tarif en temps réel selon le volume.' },
  { id: 'review',   label: 'Vue finale',             short: 'Récap',     sub: '' },
];

let product;
let cfg;
let step = 0;
let viewer;
const artwork = new ArtworkEngine();

init().catch((err) => {
  console.error(err);
  $('#loading').innerHTML = `<b style="color:#111">Le configurateur n'a pas pu démarrer.</b><small>${esc(err.message)}</small>`;
});

// page d'aperçu : réouverture du configurateur avec d'autres couleurs choisies sur l'accueil
window.SKLUBS_APPLY_URL_COLORS = () => {
  if (!cfg || !viewer) return;
  Object.assign(cfg.colors, colorsFromUrl());
  renderStep();
  update();
};

async function init() {
  PRODUCT_ID = (params().get('produit') || 'cricket-bottle').replace(/[^a-z0-9-]/gi, '');
  product = await loadProduct(PRODUCT_ID).catch(() => { throw new Error('Produit introuvable'); });

  cfg = {
    size: product.defaultSize,
    material: product.defaultMaterial,
    finish: null,
    colors: { ...product.colors.defaults, ...colorsFromUrl() },
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

  $('#viewer').style.viewTransitionName = `product-${PRODUCT_ID}`;
  viewer = new BottleViewer($('#viewer'));
  $('#handleBtn').addEventListener('click', (e) => {
    const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    e.currentTarget.setAttribute('aria-pressed', String(on));
    viewer.setHandleDown(on);
  });
  viewer.onView = (name) => $('#tools').querySelectorAll('[data-view]').forEach((x) => x.classList.toggle('is-active', x.dataset.view === name));
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
function masterOf(size) { return { ...product.master, ...(size?.master || {}) }; }
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
  const r = masterOf(size).bodyRadius * S;
  artwork.setPattern(2 * Math.PI * r, (size.printZone.top - size.printZone.bottom) * S, product.safeMargin * S);
  artwork.setZone(product.printZones.find((z) => z.id === cfg.zone));
  await viewer.build(size, product, artwork);
  viewer.applyConfig(cfg, product);
  artwork.render();
}

let lastActiveLayer = -1;
function onArtworkChange() {
  viewer?.refreshArtwork();
  drawPattern();
  syncSliders();
  // un clic sur un autre élément (bouteille ou gabarit) le sélectionne : le panneau suit
  if (artwork.active !== lastActiveLayer) {
    lastActiveLayer = artwork.active;
    if (STEPS[step]?.id === 'custom' && cfg) renderStep();
  }
}

// ---------- Mise à jour globale ----------
function update({ model = false, materials = true } = {}) {
  sanitize(product, cfg);
  syncZone();
  cfg.hasArtwork = artwork.hasArt;
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
      `<span class="n">${String(i + 1).padStart(2, '0')}</span><span class="lbl">${s.short || s.label}</span><span class="bar"></span>`));
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
let lastStepShown = -1;
let previewMode = '3d';
let userGuides = false;

function renderStep(back = false) {
  const s = STEPS[step];
  $('#stepIndex').textContent = `${String(step + 1).padStart(2, '0')} / ${String(STEPS.length).padStart(2, '0')}`;
  $('#stepTitle').textContent = s.label;
  $('#stepSub').textContent = s.sub;
  const body = $('#panelBody');
  const entering = lastStepShown !== step;
  const scroll = body.scrollTop;
  body.innerHTML = '';
  if (entering) {
    body.classList.remove('enter', 'enter-back');
    void body.offsetWidth;
    body.classList.add(back ? 'enter-back' : 'enter');
  }
  ({ material: stepMaterial, cap: stepCap, custom: stepCustom, preview: stepPreview, method: stepMethod, quantity: stepQuantity })[s.id]?.(body);
  body.scrollTop = entering ? 0 : scroll;
  $('#prevBtn').disabled = step === 0;
  $('#nextBtn').textContent = step === STEPS.length - 2 ? 'Voir la vue finale' : 'Continuer';
  if (entering) enterStep(s.id);
  lastStepShown = step;
}

// contexte 3D propre à chaque étape (caméra, vue éclatée, zone d'impression, gabarit)
function enterStep(id) {
  setExploded(id === 'cap');
  setPreviewMode(id === 'preview' ? previewMode : '3d');
  $('#modeSeg').hidden = id !== 'preview';
  viewer.setGuides(userGuides || id === 'custom');
  $('#guidesBtn').setAttribute('aria-pressed', String(userGuides || id === 'custom'));
  if (id === 'cap') viewer.goTo('explode');
  else if (id === 'custom' || id === 'preview') viewer.goTo(cfg.zone === 'back' ? 'back' : 'front');
  else if (id === 'material') viewer.goTo('front');
}

function setExploded(on) {
  viewer.setExploded(on);
  $('#explodeBtn').setAttribute('aria-pressed', String(on));
}

function group(label, extra = '') {
  const g = el('div', { class: 'group' });
  g.append(el('div', { class: 'label' }, `<span>${label}</span>${extra}`));
  return g;
}
const flag = (confirmed) => (confirmed === false ? '<span class="flag">à confirmer</span>' : '');
const ICON = {
  check: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.6 2.5L16 9.5"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  logo: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v8M8 12l4-4 4 4"/></svg>',
  text: '<svg viewBox="0 0 24 24"><path d="M5 6V4h14v2M12 4v16M9 20h6"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
};
const METHOD_ICON = {
  laser: '<svg viewBox="0 0 32 32"><path d="M16 3v9M12 8l4 4 4-4"/><path d="M7 26c3-4 15-4 18 0"/><path d="M16 15v6M13 18l3 3 3-3"/></svg>',
  uv: '<svg viewBox="0 0 32 32"><rect x="8" y="5" width="16" height="10" rx="2"/><path d="M11 19l-2 4M16 19v5M21 19l2 4"/></svg>',
  screen: '<svg viewBox="0 0 32 32"><rect x="5" y="7" width="22" height="14" rx="2"/><path d="M9 25h14M12 11h8M12 15h5"/></svg>',
  pad: '<svg viewBox="0 0 32 32"><path d="M10 6h12v6H10zM12 12h8l3 8H9z"/><path d="M8 26h16"/></svg>',
  wrap360: '<svg viewBox="0 0 32 32"><ellipse cx="16" cy="16" rx="11" ry="5"/><path d="M25 12.5l2 3.5-4 .5M7 19.5L5 16l4-.5"/></svg>',
};

// ----- 01 · Matière & couleur
function stepMaterial(body) {
  if (product.sizes.length > 1) {
    const g = group('Capacité');
    const opts = el('div', { class: 'options' });
    product.sizes.forEach((s) => {
      const from = fromPrice(s.id);
      const cap = s.capacity && !/^TO_DEFINE/.test(s.capacity) ? s.capacity : 'capacité à confirmer';
      opts.append(el('button', {
        class: `opt ${cfg.size === s.id ? 'is-active' : ''}`,
        onclick: () => { cfg.size = s.id; update({ model: true }); renderStep(); },
      }, `<div class="t">${esc(s.label)}${flag(s.confirmed)}</div>
          <span class="k">${esc(cap)}${from ? ` · à partir de ${fmtMoney(from, product.pricing?.currency)} / u` : ''}</span>`));
    });
    g.append(opts);
    body.append(g);
  }

  const g = group('Matière du corps');
  const list = el('div', { class: 'mat-list' });
  product.materials.forEach((m) => {
    const desc = m.desc || allowedMethods(product, m.id).map((x) => x.label).join(' · ');
    list.append(el('button', {
      class: `mat ${cfg.material === m.id ? 'is-active' : ''}`,
      onclick: () => { cfg.material = m.id; cfg.finish = m.defaultFinish; update(); renderStep(); },
    }, `<span class="mi ${esc(m.id)}"></span><span><b>${esc(m.label)}${flag(m.confirmed)}</b><small>${esc(desc)}</small></span>`));
  });
  (product.materialsOnRequest || []).forEach((m) => {
    list.append(el('button', { class: 'mat off', onclick: () => toast(product.materialsOnRequestNote || 'Sur demande : précisez-le dans votre demande de devis.') },
      `<span class="mi other"></span><span><b>${esc(m.label)}</b><small>${esc(m.desc || '')}</small></span><span class="req">Sur demande</span>`));
  });
  g.append(list);
  body.append(g);

  colorGroup(body, 'body', 'Couleur du corps');

  const f = group('Finition');
  const radios = el('div', { class: 'radio-list', role: 'radiogroup' });
  allowedFinishes(product, cfg.material).forEach((fin) => {
    radios.append(el('button', {
      class: `radio ${cfg.finish === fin.id ? 'is-active' : ''}`, role: 'radio', 'aria-checked': String(cfg.finish === fin.id),
      onclick: () => { cfg.finish = fin.id; update(); renderStep(); viewer.goTo('detail'); },
    }, `<i></i>${esc(fin.label)}`));
  });
  f.append(radios);
  body.append(f);
  if (product.finishes[cfg.finish].colorable === false) {
    body.append(el('p', { class: 'note' }, 'Finition naturelle : la couleur du corps est celle du métal.'));
  }
}

function partColor(part) { return part === 'body' ? bodyColorShown() : cfg.colors[part]; }
function colorName(hex) { return product.colors.catalog.find((c) => c.hex.toLowerCase() === hex.toLowerCase())?.label || hex.toUpperCase(); }

// Nuancier + couleur personnalisée (HEX) + référence Pantone, pour une pièce
function colorGroup(body, part, title) {
  const g = group(title, `<b>${esc(colorName(partColor(part)))}</b>`);
  if (part === 'body' && product.finishes[cfg.finish].colorable === false) {
    g.append(el('p', { class: 'note' }, 'Inox brossé naturel : pas de coloration du corps. Choisissez une finition peinte pour colorer.'));
    body.append(g);
    return;
  }
  const cur = cfg.colors[part].toLowerCase();
  const sw = el('div', { class: 'swatches' });
  product.colors.catalog.forEach((c) => sw.append(el('button', {
    class: `swatch ${cur === c.hex.toLowerCase() ? 'is-active' : ''}`, style: `background:${c.hex}`, title: c.label, 'aria-label': c.label,
    onclick: () => setPartColor(part, c.hex, ''),
  })));
  g.append(sw);

  const custom = !product.colors.catalog.some((c) => c.hex.toLowerCase() === cur);
  const row = el('div', { class: `custom-row ${custom ? 'is-active' : ''}` });
  const picker = el('input', { type: 'color', value: cfg.colors[part], 'aria-label': 'Couleur personnalisée' });
  const lab = el('label', { class: 'cc-btn', title: 'Couleur personnalisée' }, `<span class="plus">${ICON.plus}</span>`);
  lab.prepend(picker);
  const hexInput = el('input', { class: 'input', value: cfg.colors[part].toUpperCase(), maxlength: 7, spellcheck: 'false', 'aria-label': 'HEX' });
  const refInput = el('input', { class: 'input', value: cfg.colorRefs[part] || '', placeholder: 'Pantone (ex. PMS 1585 C)', 'aria-label': 'Référence Pantone' });
  picker.addEventListener('input', () => { hexInput.value = picker.value.toUpperCase(); setPartColor(part, picker.value, null, false); });
  picker.addEventListener('change', () => renderStep());
  hexInput.addEventListener('change', () => { const v = normalizeHex(hexInput.value); if (v) setPartColor(part, v); else toast('Format HEX attendu : #RRGGBB'); });
  refInput.addEventListener('input', () => { cfg.colorRefs[part] = refInput.value.trim(); });
  row.append(lab, el('span', { class: 'cc-l' }, 'Couleur personnalisée'), hexInput);
  g.append(row, refInput);
  refInput.classList.add('ref');
  body.append(g);
}

function setPartColor(part, hex, ref = null, rerender = true) {
  cfg.colors[part] = hex;
  if (ref !== null) cfg.colorRefs[part] = ref;
  update({ materials: true });
  artwork.render();
  if (rerender) renderStep();
}

// ----- 02 · Bouchon & détails
function stepCap(body) {
  const tg = group('Type de bouchon');
  const caps = el('div', { class: 'cap-types' });
  caps.append(el('button', { class: 'cap-type is-active', 'aria-pressed': 'true' },
    `<svg viewBox="0 0 48 48"><path d="M16 22v-9a8 8 0 0116 0v9" stroke-width="3"/><rect x="12" y="20" width="24" height="12" rx="3"/><rect x="13" y="32" width="22" height="4" rx="1"/></svg><span>Bouchon à anse</span>`));
  tg.append(caps, el('p', { class: 'note' }, 'Bouchon du modèle reconstruit. Autres bouchons (sport, paille) : pas encore modélisés pour ce produit.'));
  body.append(tg);

  colorGroup(body, 'cap', 'Couleur du bouchon');
  colorGroup(body, 'handle', "Couleur de l'anse");

  const rg = group('Anneau métallique', `<b>${esc(ringLabel())}</b>`);
  const chips = el('div', { class: 'chips' });
  product.ringFinishes.forEach((f) => chips.append(el('button', {
    class: `chip ring ${cfg.colors.ring === f.id ? 'is-active' : ''}`,
    onclick: () => { cfg.colors.ring = f.id; update(); renderStep(); },
  }, `<i style="background:${f.color}"></i>${esc(f.label)}${f.confirmed === false ? ' <span class="flag">à confirmer</span>' : ''}`)));
  rg.append(chips);
  body.append(rg);

  const eg = group('Vue');
  const ex = el('div', { class: 'chips' });
  const exploded = $('#explodeBtn').getAttribute('aria-pressed') === 'true';
  ex.append(
    el('button', { class: `chip ${exploded ? 'is-active' : ''}`, onclick: () => { setExploded(true); viewer.goTo('explode'); renderStep(); } }, 'Vue éclatée'),
    el('button', { class: `chip ${!exploded ? 'is-active' : ''}`, onclick: () => { setExploded(false); renderStep(); } }, 'Assemblée'),
  );
  eg.append(ex);
  body.append(eg);
}

// ----- 03 · Personnalisation
const FONTS = [
  { id: 'Inter Tight', label: 'Moderne' },
  { id: 'Instrument Serif', label: 'Élégante' },
  { id: 'JetBrains Mono', label: 'Technique' },
];
const TEXT_COLORS = ['#111111', '#FFFFFF', '#FF6B00'];

function stepCustom(body) {
  const tg = group('Ajouter');
  const tools = el('div', { class: 'add-tools' });
  tools.append(
    el('button', { class: 'add', onclick: () => { replaceNext = false; $('#fileInput').click(); } }, `${ICON.logo}<span><b>Importer un logo</b><small>PNG, JPG ou SVG</small></span>`),
    el('button', { class: 'add', onclick: addText }, `${ICON.text}<span><b>Ajouter un texte</b><small>Nom, slogan, date…</small></span>`),
  );
  const drop = tools.firstChild;
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('over')));
  drop.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); });
  tg.append(tools);
  body.append(tg);

  if (artwork.hasArt) {
    const lg = group('Éléments', `<b>${artwork.layers.length}</b>`);
    const list = el('div', { class: 'layers' });
    artwork.layers.forEach((l, i) => {
      const row = el('div', { class: `layer ${i === artwork.active ? 'is-active' : ''}` });
      const th = el('span', { class: 'thumb' });
      th.style.backgroundImage = `url(${l.image.toDataURL()})`;
      const pick = el('button', { class: 'n', onclick: () => { artwork.select(i); renderStep(); } }, esc(l.kind === 'text' ? l.textOpts.text.replace(/\n/g, ' ') : l.name));
      row.append(th, pick, el('button', { class: 'del', title: 'Retirer', 'aria-label': 'Retirer', onclick: () => { artwork.select(i); artwork.removeActive(); artwork.render(); update(); renderStep(); } }, ICON.trash));
      list.append(row);
    });
    lg.append(list);
    body.append(lg);
  }

  const L = artwork.layer;
  if (L?.kind === 'text') {
    const xg = group('Texte');
    const ta = el('textarea', { class: 'input area', rows: 2, maxlength: 80, spellcheck: 'false' });
    ta.value = L.textOpts.text;
    ta.addEventListener('input', () => { if (ta.value.trim()) { artwork.setText({ text: ta.value }, L); artwork.render(); syncLayerName(); } });
    xg.append(ta);
    const fonts = el('div', { class: 'chips' });
    FONTS.forEach((f) => fonts.append(el('button', { class: `chip ${L.textOpts.font === f.id ? 'is-active' : ''}`, style: `font-family:'${f.id}'`, onclick: () => setTextOpt({ font: f.id }) }, f.label)));
    fonts.append(
      el('button', { class: `chip ${L.textOpts.weight >= 700 ? 'is-active' : ''}`, onclick: () => setTextOpt({ weight: L.textOpts.weight >= 700 ? 400 : 700 }) }, '<b>Gras</b>'),
      el('button', { class: `chip ${L.textOpts.italic ? 'is-active' : ''}`, onclick: () => setTextOpt({ italic: !L.textOpts.italic }) }, '<i>Italique</i>'),
    );
    xg.append(fonts);
    const cols = el('div', { class: 'swatches small' });
    [...TEXT_COLORS, ...product.colors.catalog.map((c) => c.hex)].filter((h, i, a) => a.findIndex((x) => x.toLowerCase() === h.toLowerCase()) === i).forEach((h) =>
      cols.append(el('button', { class: `swatch ${L.textOpts.color.toLowerCase() === h.toLowerCase() ? 'is-active' : ''}`, style: `background:${h}`, 'aria-label': h, onclick: () => setTextOpt({ color: h }) })));
    xg.append(el('div', { class: 'label sub' }, '<span>Couleur</span>'), cols);
    if (product.printingMethods.find((m) => m.id === cfg.method)?.render === 'engrave') xg.append(el('p', { class: 'note' }, 'Gravure laser : la couleur du texte est celle du métal révélé.'));
    body.append(xg);
  }
  if (L) {
    const pg = group('Position · taille · rotation', '<b>Glissez l\'élément sur la bouteille</b>');
    const acts = el('div', { class: 'chips' });
    const mv = (fn) => () => { fn(artwork.t); artwork.clampTransform(); artwork.render(); };
    acts.append(
      el('button', { class: 'chip', onclick: mv((t) => { t.x = 0; t.y = 0; }) }, 'Centrer'),
      el('button', { class: 'chip', onclick: mv((t) => { t.y = 99; }) }, 'Haut'),
      el('button', { class: 'chip', onclick: mv((t) => { t.y = -99; }) }, 'Bas'),
      el('button', { class: 'chip', onclick: mv((t) => { t.width = artwork.maxWidth(); }) }, 'Taille max'),
      el('button', { class: 'chip', onclick: mv((t) => { t.rotation = 0; }) }, 'Rotation 0°'),
    );
    pg.append(acts);
    pg.append(slider('Taille', 'size', 0.5, artwork.maxWidth(), 0.1, artwork.t.width, (v) => fmtLen(v, zoneWidth()), (v) => { artwork.t.width = v; }));
    pg.append(slider('Rotation', 'rot', -180, 180, 1, artwork.t.rotation, (v) => `${Math.round(v)}°`, (v) => { artwork.t.rotation = v; }));
    if (L.kind === 'image') pg.append(el('button', { class: 'link-btn', onclick: () => { replaceNext = true; $('#fileInput').click(); } }, 'Remplacer ce logo'));
    body.append(pg);
  }

  const zg = group("Zones d'impression");
  const zones = el('div', { class: 'zones' });
  const possible = new Set(allowedMethods(product, cfg.material).flatMap((m) => allowedZones(product, m.id).map((z) => z.id)));
  product.printZones.forEach((z) => {
    if (!possible.has(z.id)) return;
    zones.append(el('button', { class: `zone ${cfg.zone === z.id ? 'is-active' : ''}`, onclick: () => setZone(z.id) }, `${zoneIcon(z.id)}<span>${esc(z.label)}</span>`));
  });
  zg.append(zones);
  body.append(zg);
  if (!artwork.hasArt) body.append(el('p', { class: 'note' }, 'Astuce : déposez votre fichier directement sur la bouteille.'));
}

function zoneIcon(id) {
  const band = id === 'wrap' ? '<rect x="10" y="22" width="20" height="18" fill="currentColor" opacity=".35" stroke="none"/>'
    : id === 'back' ? '<rect x="15" y="24" width="10" height="13" rx="1" stroke-dasharray="2 2"/>' : '<rect x="15" y="24" width="10" height="13" rx="1" fill="currentColor" opacity=".35"/>';
  return `<svg viewBox="0 0 40 48"><path d="M16 4h8v6h-8zM16 10h8v2c4 2 6 4 6 8v22a3 3 0 01-3 3H13a3 3 0 01-3-3V20c0-4 2-6 6-8z"/>${band}</svg>`;
}

function setZone(id) {
  if (!allowedZones(product, cfg.method).some((z) => z.id === id)) {
    const m = allowedMethods(product, cfg.material).find((x) => allowedZones(product, x.id).some((z) => z.id === id));
    if (m) { cfg.method = m.id; toast(`Technique adaptée à cette zone : ${m.label}.`); }
  }
  cfg.zone = id;
  syncZone(true);
  update();
  renderStep();
  viewer.goTo(id === 'back' ? 'back' : id === 'wrap' ? 'side' : 'front');
}

// la zone du visuel suit la configuration (après un changement de technique ou de zone)
function syncZone(reset = false) {
  if (artwork.zone?.id === cfg.zone && !reset) return;
  const z = product.printZones.find((x) => x.id === cfg.zone);
  if (!z) return;
  artwork.setZone(z);
  if (z.id === 'wrap') artwork.layers.forEach((l) => { l.t.x = 0; });
  artwork.render();
}

function addText() {
  const n = artwork.layers.filter((l) => l.kind === 'text').length;
  const color = luminance(bodyColorShown()) > 0.6 ? '#111111' : '#FFFFFF';
  artwork.setText({ text: n ? 'Votre slogan' : 'Votre texte', color });
  artwork.render();
  update();
  renderStep();
  viewer.goTo(cfg.zone === 'back' ? 'back' : 'front');
  setTimeout(() => $('#panelBody textarea')?.select(), 60);
}

function setTextOpt(o) {
  artwork.setText(o, artwork.layer);
  artwork.render();
  renderStep();
}

function syncLayerName() {
  const n = $('#panelBody .layer.is-active .n');
  if (n) n.textContent = artwork.layer.textOpts.text.replace(/\n/g, ' ');
}

function luminance(hex) { const [r, g, b] = hexToRgb(hex); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; }

// ----- 04 · Aperçu d'impression
function stepPreview(body) {
  const vg = group('Vues');
  const views = el('div', { class: 'view-list' });
  [['front', 'Avant'], ['back', 'Arrière'], ['side', 'Droite'], ['left', 'Gauche']].forEach(([v, label]) =>
    views.append(el('button', { class: 'view-btn', onclick: () => { setPreviewMode('3d'); viewer.setAutoRotate(false); $('#rotateBtn').setAttribute('aria-pressed', 'false'); viewer.goTo(v); } }, label)));
  views.append(el('button', { class: 'view-btn', onclick: () => { setPreviewMode('3d'); viewer.goTo('front'); setTimeout(() => { viewer.setAutoRotate(true); $('#rotateBtn').setAttribute('aria-pressed', 'true'); }, 600); } }, '360°'));
  vg.append(views);
  body.append(vg);

  const mg = group('Gabarit');
  const seg = el('div', { class: 'seg block' });
  [['3d', 'Vue 3D'], ['2d', 'Gabarit 2D (360°)']].forEach(([m, label]) =>
    seg.append(el('button', { class: previewMode === m ? 'is-active' : '', onclick: () => { setPreviewMode(m); renderStep(); } }, label)));
  mg.append(seg);
  const known = typeof product.scale.mmPerBodyHeight === 'number';
  const dims = el('dl', { class: 'dims' });
  dims.innerHTML = `<dt>Déroulé 360°</dt><dd>${known ? fmtLen(artwork.pattern.circumference) : 'à confirmer usine'}</dd>
    <dt>Hauteur imprimable</dt><dd>${known ? fmtLen(artwork.pattern.height) : 'à confirmer usine'}</dd>
    <dt>Zone</dt><dd>${esc(labelOf(product.printZones, cfg.zone))}</dd>
    <dt>Éléments</dt><dd>${artwork.layers.length || 'aucun'}</dd>`;
  mg.append(dims);
  mg.append(el('p', { class: 'note' }, 'Le gabarit montre la bouteille déroulée : la zone imprimable (trait plein), la zone de sécurité (tirets orange) et la ligne de centrage. Les éléments se déplacent aussi sur le gabarit.'));
  body.append(mg);
  if (!artwork.hasArt) body.append(el('p', { class: 'note warn' }, 'Aucun logo ni texte : ajoutez-les à l\'étape Personnalisation.'));
}

function setPreviewMode(mode) {
  if (STEPS[step]?.id === 'preview') previewMode = mode;
  const on = mode === '2d';
  $('#template').hidden = !on;
  $('#viewer').classList.toggle('is-2d', on);
  $('#modeSeg').querySelectorAll('button').forEach((b) => b.classList.toggle('is-active', b.dataset.mode === mode));
  if (on) drawTemplate();
}

let tplBound = false;
function drawTemplate() {
  const c = $('#tplCanvas');
  const box = $('#template .tpl-canvas');
  const wrap = $('#template');
  const maxW = Math.max(200, wrap.clientWidth - (isMobile() ? 48 : 200));
  const ratio = artwork.pattern.height / artwork.pattern.circumference;
  const maxH = Math.max(120, wrap.clientHeight - (isMobile() ? 170 : 230));
  const w = Math.min(maxW, maxH / ratio);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = Math.round(w * dpr);
  c.height = Math.round(w * ratio * dpr);
  c.style.width = `${Math.round(w)}px`;
  c.style.height = `${Math.round(w * ratio)}px`;
  box.style.width = `${Math.round(w)}px`;
  const known = typeof product.scale.mmPerBodyHeight === 'number';
  $('#tplW').textContent = known ? fmtLen(artwork.pattern.circumference) : 'déroulé 360° · cote à confirmer';
  $('#tplH').textContent = known ? fmtLen(artwork.pattern.height) : 'hauteur à confirmer';
  if (!tplBound) { bindPatternDrag(c); tplBound = true; }
  drawPattern();
}

// ----- 05 · Méthode d'impression
function stepMethod(body) {
  const allowed = allowedMethods(product, cfg.material).map((m) => m.id);
  const grid = el('div', { class: 'method-grid' });
  product.printingMethods.forEach((m) => {
    const ok = allowed.includes(m.id);
    grid.append(el('button', {
      class: `mcard ${cfg.method === m.id ? 'is-active' : ''}`, disabled: !ok, title: ok ? '' : 'Non compatible avec la matière choisie',
      onclick: () => setMethod(m.id),
    }, `${METHOD_ICON[m.id] || METHOD_ICON.uv}<span>${esc(m.label)}</span>`));
  });
  body.append(grid);

  const m = product.printingMethods.find((x) => x.id === cfg.method);
  if (m) {
    const zones = allowedZones(product, m.id).map((z) => z.label).join(' · ');
    const card = el('div', { class: 'mdetail' });
    card.innerHTML = `<h3>${esc(m.label)}</h3>${m.desc ? `<p>${esc(m.desc)}</p>` : ''}
      <ul>${(m.benefits || []).map((b) => `<li>${ICON.check}${esc(b)}</li>`).join('')}</ul>
      <dl class="dims"><dt>Zones</dt><dd>${esc(zones)}</dd>
      <dt>Couleurs</dt><dd>${m.maxColors === null ? 'illimitées' : typeof m.maxColors === 'number' ? `${m.maxColors} max` : 'à confirmer usine'}</dd></dl>`;
    body.append(card);
  }
  if (!artwork.hasArt) body.append(el('p', { class: 'note' }, 'Sans logo ni texte, la bouteille est livrée sans marquage : la technique s\'applique dès que vous ajoutez un élément.'));
}

function setMethod(id) {
  const prevZone = cfg.zone;
  cfg.method = id;
  update();
  if (cfg.zone !== prevZone) toast(`Zone ajustée : ${labelOf(product.printZones, cfg.zone)} (compatible ${labelOf(product.printingMethods, id)}).`);
  renderStep();
  viewer.goTo(cfg.zone === 'back' ? 'back' : cfg.zone === 'wrap' ? 'side' : 'front');
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
  const c = $('#tplCanvas');
  if (!c || $('#template').hidden) return;
  artwork.drawEditor(c, { bodyColor: bodyColorShown(), engrave: product.printingMethods.find((m) => m.id === cfg.method)?.render === 'engrave', engraveColor: viewer.engraveColor || '#c9cac7' });
}

function bindPatternDrag(canvas) {
  let drag = null;
  const uv = (e) => {
    const r = canvas.getBoundingClientRect();
    return { u: (e.clientX - r.left) / r.width, v: 1 - (e.clientY - r.top) / r.height };
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (!artwork.hasArt) { replaceNext = false; $('#fileInput').click(); return; }
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
    if (!artwork.hasArt) return;
    e.preventDefault();
    artwork.t.width *= e.deltaY < 0 ? 1.05 : 0.95;
    artwork.clampTransform();
    artwork.render();
  }, { passive: false });
}

let replaceNext = false;
async function handleFile(file) {
  const okTypes = ['image/png', 'image/jpeg', 'image/svg+xml'];
  if (!okTypes.includes(file.type)) {
    toast(file.type === 'application/pdf' ? 'PDF : envoyez-le avec le projet, l\'aperçu 3D accepte PNG, JPG ou SVG.' : 'Formats acceptés : PNG, JPG, SVG.');
    return;
  }
  if (file.size > 15 * 1024 * 1024) { toast('Fichier trop lourd (15 Mo max).'); return; }
  try {
    await artwork.loadFile(file, replaceNext);
    replaceNext = false;
    artwork.render();
    update();
    const custom = STEPS.findIndex((s) => s.id === 'custom');
    if (step !== custom) goStep(custom); else renderStep();
    viewer.goTo(cfg.zone === 'back' ? 'back' : 'front');
    toast('Logo appliqué. Glissez-le directement sur la bouteille.');
  } catch (err) {
    toast(`Lecture impossible : ${err.message}`);
  }
}

// ----- 06 · Quantité & prix
function stepQuantity(body) {
  const g = group('Quantité');
  const q = el('div', { class: 'qty' });
  const input = el('input', { type: 'number', min: 1, step: 1, value: cfg.quantity, inputmode: 'numeric', 'aria-label': 'Quantité' });
  const set = (v) => { cfg.quantity = Math.max(1, Math.round(v) || 1); input.value = cfg.quantity; update({ materials: false }); renderStep(); };
  q.append(el('button', { 'aria-label': 'Moins', onclick: () => set(cfg.quantity - stepFor(cfg.quantity)) }, '−'), input,
    el('button', { 'aria-label': 'Plus', onclick: () => set(cfg.quantity + stepFor(cfg.quantity)) }, '+'));
  input.addEventListener('change', () => set(Number(input.value)));
  g.append(q, el('div', { class: 'qty-unit' }, 'pièces'));
  body.append(g);

  const p = computePrice(product, cfg);
  const tax = product.pricing?.taxLabel ? ` ${product.pricing.taxLabel}` : '';
  const pg = group('Paliers de prix', p.tiers?.length ? '<b>Prix unitaire</b>' : '');
  const tiers = product.pricing?.tiers?.[cfg.size];
  if (p.tiers && p.tiers.length) {
    const tbl = el('div', { class: 'tiers', role: 'list' });
    const popular = (tiers || []).find((t) => t.popular)?.min;
    p.tiers.forEach((t) => {
      tbl.append(el('button', { class: `tier ${t.active ? 'is-active' : ''}`, role: 'listitem', 'data-q': t.min, onclick: () => set(t.min) },
        `<span class="q">${fmtInt(t.min)} pcs${t.min === popular ? ' <span class="pop">le plus populaire</span>' : ''}</span>
         <span class="u">${t.unit !== null ? fmtMoney(t.unit, p.currency) : '—'} <small>/ unit</small></span>
         <span class="sv">${t.saving > 0.005 ? `−${Math.round(t.saving * 100)} %` : ''}</span>`));
    });
    pg.append(tbl);
  } else {
    const chips = el('div', { class: 'chips' });
    (product.quantity.presets || []).forEach((n) => chips.append(el('button', { class: `chip ${cfg.quantity === n ? 'is-active' : ''}`, onclick: () => set(n) }, fmtInt(n))));
    pg.append(chips);
  }
  body.append(pg);

  // Récapitulatif prix (planche 10)
  const card = el('div', { class: 'price-card' });
  if (p.status === 'factory') {
    card.innerHTML = `<p class="label"><span>Récapitulatif prix</span></p><b class="big">Sur devis</b>
      <p class="note">${p.belowMoq && p.moq ? `Minimum de commande : ${fmtInt(p.moq)} pièces.` : 'Tarifs non encore renseignés pour cette configuration : SKLUBS chiffre votre projet après validation usine. Aucun prix n\'est affiché tant qu\'il n\'est pas confirmé.'}</p>`;
  } else {
    card.innerHTML = `<p class="label"><span>Récapitulatif prix</span></p>
      <b class="big">${fmtMoney(p.unit, p.currency)}${tax}</b><span class="sub">Prix unitaire (${fmtInt(cfg.quantity)} pcs)</span>
      <div class="tot"><b>${fmtMoney(p.total, p.currency)}${tax}</b>${p.saving > 0.005 ? `<span class="save">−${Math.round(p.saving * 100)} %</span>` : ''}</div><span class="sub">Total estimé</span>
      ${p.leadTime ? `<p class="lead">${ICON.clock}<span>Délai de production<br><b>${esc(p.leadTime)}</b></span></p>` : ''}
      ${p.setup ? `<p class="note">Frais de calage du marquage inclus et répartis : ${fmtMoney(p.setup, p.currency, 0)} au total.</p>` : ''}
      <p class="note">${p.status === 'estimated' ? 'Prix estimatif, validation usine incluse.' : 'Prix instantané, confirmé à la validation du fichier.'}</p>`;
  }
  body.append(card);
  if (product.reference?.quantity) body.append(el('p', { class: 'note' }, `Référence devis Cricket : ${fmtInt(product.reference.quantity)} pièces.`));
}
const stepFor = (q) => (q < 100 ? 10 : q < 1000 ? 50 : 250);

// ---------- Vue finale & ajout au projet ----------
function enterReview() {
  $('#app').classList.add('is-review');
  setExploded(false);
  setPreviewMode('3d');
  $('#modeSeg').hidden = true;
  lastStepShown = -1;
  const size = currentSize();
  const dot = (h) => `<i style="background:${h}"></i>`;
  const ref = (c) => (cfg.colorRefs[c] ? ` · ${esc(cfg.colorRefs[c])}` : '');
  const cap = size.capacity && !/^TO_DEFINE/.test(size.capacity) ? size.capacity : 'à confirmer';
  const rows = [
    ['Modèle', esc(product.name)],
    ['Capacité', esc(cap)],
    ['Matière', esc(labelOf(product.materials, cfg.material))],
    ['Finition', esc(product.finishes[cfg.finish].label)],
    ['Couleur corps', `${esc(colorName(bodyColorShown()))}${ref('body')}${dot(bodyColorShown())}`],
    ['Couleur bouchon', `${esc(colorName(cfg.colors.cap))}${ref('cap')}${dot(cfg.colors.cap)}`],
    ['Couleur anse', `${esc(colorName(cfg.colors.handle))}${ref('handle')}${dot(cfg.colors.handle)}`],
    ['Anneau métallique', esc(ringLabel())],
    ["Méthode d'impression", cfg.hasArtwork ? esc(methodLabel()) : 'Sans marquage'],
    ["Zone d'impression", cfg.hasArtwork ? esc(labelOf(product.printZones, cfg.zone)) : '—'],
    ['Éléments', cfg.hasArtwork ? artwork.layers.map((l) => esc(l.kind === 'text' ? `« ${l.textOpts.text.replace(/\n/g, ' ')} »` : l.name)).join(', ') : '—'],
    ['Quantité', `${fmtInt(cfg.quantity)} pcs`],
  ];
  $('#reviewList').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  const p = computePrice(product, cfg);
  const tax = product.pricing?.taxLabel ? ` ${product.pricing.taxLabel}` : '';
  $('#reviewPrice').innerHTML = p.status === 'factory'
    ? `<div class="row"><span class="status factory">${STATUS.factory}</span></div><p>Cette configuration sera chiffrée par SKLUBS. Demandez le devis : aperçu, visuels et paramètres sont joints.</p>`
    : `<div class="row"><span>Prix unitaire (${fmtInt(cfg.quantity)} pcs)</span><b>${fmtMoney(p.unit, p.currency)}${tax}</b></div><div class="row"><span>Total estimé</span><b>${fmtMoney(p.total, p.currency)}${tax}</b></div>`
      + `<p>${STATUS[p.status]}${p.saving > 0.005 ? ` · économie de ${Math.round(p.saving * 100)} %` : ''}${p.leadTime ? ` · délai ${esc(p.leadTime)}` : ''}</p>`;
  const canOrder = p.status === 'instant';
  $('#orderBtn').disabled = !canOrder;
  $('#orderNote').textContent = canOrder ? 'Finalisez votre commande directement en ligne.' : 'Disponible dès que le prix est confirmé.';
  viewer.setGuides(false);
  $('#guidesBtn').setAttribute('aria-pressed', 'false');
  viewer.setPodium(true);
  if (isMobile()) viewer.setFrameShift(0.24);
  viewer.goTo('hero');
  setTimeout(() => { viewer.setAutoRotate(true); $('#rotateBtn').setAttribute('aria-pressed', 'true'); }, 900);
}

function exitReview() {
  if (!$('#app').classList.contains('is-review')) return;
  $('#app').classList.remove('is-review');
  viewer.setPodium(false);
  viewer.setFrameShift(0);
  viewer.setAutoRotate(false);
  $('#rotateBtn').setAttribute('aria-pressed', 'false');
  viewer.goTo('front');
}

// ---------- Projet ----------
function buildProject(intent = 'quote') {
  const size = currentSize();
  const p = computePrice(product, cfg);
  const S = SCALE();
  const mm = product.scale.mmPerBodyHeight;
  const tf = (t) => ({
    units: 'BODY_HEIGHT', x: +(t.x / S).toFixed(4), y: +(t.y / S).toFixed(4), width: +(t.width / S).toFixed(4),
    width_pct_zone: Math.round((t.width / zoneWidth()) * 100), rotation_deg: t.rotation,
    mm: typeof mm === 'number' ? { x: (t.x / S) * mm, y: (t.y / S) * mm, width: (t.width / S) * mm } : 'TO_DEFINE_FACTORY',
  });
  return {
    intent, // quote = demande de devis, order = commande, save = ajout au projet
    product_id: product.id,
    variant_id: `${product.id}-${size.id}`,
    size: size.id,
    materials: { material: cfg.material, finish: cfg.finish },
    colors: { body: bodyColorShown(), cap: cfg.colors.cap, handle: cfg.colors.handle, ring: cfg.colors.ring },
    color_refs: cfg.colorRefs,
    // visuel de production : déroulé 360° complet (tous les éléments) ; détail de chaque élément ci-dessous
    artwork: artwork.hasArt ? { file: artwork.layers.map((l) => l.name).join(' + '), data_url: artwork.colorCanvas.toDataURL('image/png') } : null,
    artwork_layers: artwork.layers.map((l) => ({
      kind: l.kind, name: l.name, text: l.textOpts || null, transform: tf(l.t),
      data_url: l.kind === 'image' ? l.image.toDataURL('image/png') : null,
    })),
    artwork_transform: artwork.hasArt ? tf(artwork.layers[0].t) : null,
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

function sendToParent(intent = 'quote') {
  const proj = buildProject(intent);
  window.parent.postMessage({ type: 'sklubs:bottle:project', version: 1, project: proj }, parentOrigin);
  toast('Projet transmis à SKLUBS…');
}

window.addEventListener('message', (e) => {
  if (!parentOrigin || e.origin !== parentOrigin) return;
  if (e.data?.type === 'sklubs:bottle:project-received') toast(`Projet reçu par SKLUBS${e.data.reference ? ` (réf. ${e.data.reference})` : ''}. Nous revenons vers vous avec le chiffrage.`);
  if (e.data?.type === 'sklubs:bottle:project-error') toast(e.data.message || 'Envoi impossible. Réessayez ou contactez SKLUBS.');
});

// Ajouter au projet : configuration gardée sur cet appareil (et transmise au site s'il intègre le configurateur)
function saveProject() {
  const proj = buildProject('save');
  let list = [];
  try { list = JSON.parse(localStorage.getItem('sklubs-projects') || '[]'); } catch { /* stockage indisponible */ }
  const light = { ...proj, preview_image: viewer.snapshot(360), artwork: proj.artwork ? { file: proj.artwork.file } : null, artwork_layers: proj.artwork_layers.map((l) => ({ ...l, data_url: null })) };
  list = [light, ...list].slice(0, 12);
  let saved = false;
  try { localStorage.setItem('sklubs-projects', JSON.stringify(list)); saved = true; } catch { /* quota ou navigation privée */ }
  if (parentOrigin) sendToParent('save');
  else toast(saved ? `Ajouté au projet : ${list.length} configuration${list.length > 1 ? 's' : ''} enregistrée${list.length > 1 ? 's' : ''} sur cet appareil.` : 'Enregistrement impossible sur cet appareil : téléchargez le rendu ou demandez un devis.');
}

async function sendProject(intent = 'quote') {
  if (parentOrigin) { sendToParent(intent); return; }
  if (!SUBMIT_ENDPOINT) {
    exportProject();
    if (!window.SKLUBS_PREVIEW) toast('Envoi en ligne à brancher (point d\'envoi SKLUBS à définir). Projet et aperçu téléchargés.');
    return;
  }
  const btn = $('#sendBtn');
  btn.disabled = true;
  try {
    const res = await fetch(SUBMIT_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildProject(intent)) });
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
  $('#sendBtn').addEventListener('click', () => sendProject('quote'));
  $('#orderBtn').addEventListener('click', () => sendProject('order'));
  $('#saveBtn').addEventListener('click', saveProject);
  $('#downloadBtn').addEventListener('click', () => { exportProject(); if (!window.SKLUBS_PREVIEW) toast('Rendu 3D (PNG) et fichier projet téléchargés.'); });
  $('#fileInput').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) handleFile(f); e.target.value = ''; });

  $('#tools').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-view], button[data-act]');
    if (!b) return;
    setPreviewMode('3d');
    if (b.dataset.view) viewer.goTo(b.dataset.view);
    if (b.dataset.act === 'zoomin') viewer.zoom(0.8);
    if (b.dataset.act === 'zoomout') viewer.zoom(1.25);
  });
  $('#explodeBtn').addEventListener('click', (e) => {
    const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    setExploded(on);
    if (on) viewer.goTo('explode');
    if (STEPS[step].id === 'cap') renderStep();
  });
  $('#fullBtn').addEventListener('click', () => {
    const v = $('#viewer');
    if (document.fullscreenElement) document.exitFullscreen?.();
    else (v.requestFullscreen || v.webkitRequestFullscreen)?.call(v);
  });
  $('#modeSeg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (!b) return;
    setPreviewMode(b.dataset.mode);
    if (STEPS[step].id === 'preview') renderStep();
  });
  addEventListener('resize', () => { if (!$('#template').hidden) drawTemplate(); });
  $('#resetBtn').addEventListener('click', () => viewer.goTo('front'));
  $('#rotateBtn').addEventListener('click', (e) => {
    const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    e.currentTarget.setAttribute('aria-pressed', String(on));
    viewer.setAutoRotate(on);
  });
  $('#guidesBtn').addEventListener('click', (e) => {
    const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    userGuides = on;
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
