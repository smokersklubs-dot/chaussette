// Accueil : hero 3D, choix du type de produit, choix du modèle. Données : API WordPress ou products/ (voir data.js).
import { loadCatalog, loadProduct } from './data.js';
import { ShowBottle } from './hero3d.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ARROW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
const pad = (n) => String(n).padStart(2, '0');
const unknown = (v) => v == null || v === '' || /^TO_DEFINE/.test(String(v)) || /confirmer/i.test(String(v));

// Exemple de personnalisation affiché sur l'accueil : orange SKLUBS (couleur personnalisée), bouchon et anse noirs.
const BRAND = { id: 'sklubs', label: 'Orange SKLUBS (personnalisée)', hex: '#FF6B00' };
const DARK = '#202023';

// Silhouettes des gammes sans modèle 3D (aucune photo inventée)
const SIL = {
  bottles: '<svg viewBox="0 0 40 100"><path d="M14 4h12v9H14zM15 13h10v6c6 3 9 7 9 12v61a4 4 0 01-4 4H10a4 4 0 01-4-4V31c0-5 3-9 9-12z"/><path d="M14 5c0-4 12-4 12 0"/></svg>',
  tumblers: '<svg viewBox="0 0 60 100"><path d="M8 10h44l-2 8H10zM10 18h40l-5 74a4 4 0 01-4 4H19a4 4 0 01-4-4z"/><path d="M22 10V6h16v4"/></svg>',
  mugs: '<svg viewBox="0 0 90 100"><path d="M10 26h50v52a10 10 0 01-10 10H20a10 10 0 01-10-10z"/><path d="M60 38h8a10 10 0 010 20h-8"/></svg>',
  thermos: '<svg viewBox="0 0 40 100"><path d="M12 4h16v12H12zM10 16h20v4H10zM8 20h24v72a4 4 0 01-4 4H12a4 4 0 01-4-4z"/></svg>',
  cups: '<svg viewBox="0 0 60 100"><path d="M34 2l-6 22"/><path d="M8 24h44l-2 6H10zM10 30h40l-6 64H16z"/></svg>',
};

const FEAT = {
  material: '<svg viewBox="0 0 24 24"><rect x="7" y="3" width="10" height="18" rx="3"/><path d="M10 3v18"/></svg>',
  handle: '<svg viewBox="0 0 24 24"><path d="M7 11V8a5 5 0 0110 0v3"/><rect x="5" y="11" width="14" height="10" rx="2"/></svg>',
  ring: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="12" rx="8" ry="4"/><path d="M4 12v2c0 2.2 3.6 4 8 4s8-1.8 8-4v-2"/></svg>',
  marking: '<svg viewBox="0 0 24 24"><path d="M4 20l4.5-1 10-10a2.1 2.1 0 00-3-3l-10 10z"/></svg>',
  colors: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 4v16M4 12h16"/></svg>',
};

function miniBottle(hex) {
  return `<svg viewBox="0 0 22 52" aria-hidden="true">
    <path d="M7 4.5c0-4 8-4 8 0" fill="none" stroke="${DARK}" stroke-width="1.6"/>
    <rect x="6" y="4" width="10" height="6" rx="1.5" fill="${DARK}"/>
    <rect x="6.6" y="10" width="8.8" height="2" fill="#c9c9c6"/>
    <path d="M6.6 12h8.8v1.5c3.4 1.6 4.6 3.8 4.6 6.6V49a3 3 0 01-3 3H5a3 3 0 01-3-3V20.1c0-2.8 1.2-5 4.6-6.6z" fill="${hex}" stroke="rgba(17,17,17,.12)" stroke-width=".6"/>
  </svg>`;
}

// ---------- Données ----------
const catalog = await loadCatalog();
const available = catalog.models.filter((m) => m.status === 'available');
const products = new Map();
const getProduct = (id) => { if (!products.has(id)) products.set(id, loadProduct(id)); return products.get(id); };

const params = new URLSearchParams(location.search);
const state = {
  color: BRAND.hex,
  category: params.get('categorie') || available[0]?.category || catalog.categories[0]?.id,
  model: 0,
};
const heroModel = available[0];

function configUrl(modelId) {
  const q = new URLSearchParams({ produit: modelId, couleur: state.color.slice(1), bouchon: DARK.slice(1), anse: DARK.slice(1) });
  return `configurateur.html?${q}`;
}
function paletteOf(product) {
  const list = [BRAND, ...(product?.colors?.catalog || [])];
  return list.filter((c, i) => list.findIndex((x) => x.hex.toLowerCase() === c.hex.toLowerCase()) === i);
}
function lowestPrice(product) {
  const p = product?.pricing || {};
  const units = Object.values(p.tiers || {}).flat().map((t) => t?.unit).filter((u) => typeof u === 'number');
  if (!units.length) units.push(...Object.values(p.basePriceBySize || {}).filter((u) => typeof u === 'number'));
  return units.length ? Math.min(...units) : null;
}
const money = (v, cur = 'EUR') => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: cur }).format(v);

function safeBottle(el, opts, fallbackImg) {
  try { return new ShowBottle(el, opts); } catch (e) {
    console.warn('3D indisponible', e);
    el.classList.remove('is-loading');
    if (fallbackImg) el.innerHTML = `<img src="${esc(fallbackImg)}" alt="" style="position:absolute;inset:8%;width:84%;height:84%;object-fit:contain">`;
    return null;
  }
}

// ---------- 01 · Hero ----------
let heroProduct = null;
let heroBottle = null;
let palette = [BRAND];

async function initHero() {
  if (!heroModel) return;
  heroProduct = await getProduct(heroModel.id);
  palette = paletteOf(heroProduct);
  renderRail();
  const el = $('#heroBottle');
  el.classList.add('is-loading');
  heroBottle = safeBottle(el, { tilt: 0.36, yaw: -0.55, fill: 0.9, logo: 'SKLUBS' }, heroModel.thumbnail);
  if (!heroBottle) return;
  await heroBottle.load(heroProduct);
  heroBottle.setColors(colorsNow(), true);
  el.classList.remove('is-loading');
  $('#heroNote').textContent = 'Exemple de personnalisation · logo SKLUBS';
}

function colorsNow() { return { body: state.color, cap: DARK, handle: DARK, ring: 'polished' }; }

function renderRail() {
  $('#heroRail').innerHTML = palette.map((c) =>
    `<button class="hp-swatch" role="radio" aria-checked="${c.hex === state.color}" data-hex="${esc(c.hex)}" title="${esc(c.label)}" aria-label="${esc(c.label)}">${miniBottle(esc(c.hex))}</button>`).join('');
  const i = palette.findIndex((c) => c.hex === state.color);
  $('#heroCount').innerHTML = `<b>${pad(i + 1)}</b> / ${pad(palette.length)}`;
}

function setColor(hex) {
  state.color = hex;
  renderRail();
  heroBottle?.setColors(colorsNow());
  modelBottle?.setColors(colorsNow());
  renderCard();
  syncLinks();
}

$('#heroRail').addEventListener('click', (e) => { const b = e.target.closest('[data-hex]'); if (b) setColor(b.dataset.hex); });
$('#heroRail').addEventListener('keydown', (e) => {
  if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  e.preventDefault();
  const i = palette.findIndex((c) => c.hex === state.color);
  const n = (i + (e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1) + palette.length) % palette.length;
  setColor(palette[n].hex);
  $(`#heroRail [data-hex="${palette[n].hex}"]`)?.focus();
});

function syncLinks() {
  const target = currentModels()[state.model] || heroModel;
  document.querySelectorAll('[data-config]').forEach((a) => { if (target) a.href = configUrl(target.id); });
}

// ---------- 02 · Types ----------
function renderTypes() {
  $('#typeGrid').innerHTML = catalog.categories.map((k) => {
    const models = available.filter((m) => m.category === k.id);
    const pic = models[0]?.thumbnail ? `<img src="${esc(models[0].thumbnail)}" alt="" loading="lazy">` : (SIL[k.id] || SIL.bottles);
    const tag = models.length ? `<span class="tag on">${models.length} modèle${models.length > 1 ? 's' : ''}</span>` : '<span class="tag">Bientôt</span>';
    return `<button class="hp-type" role="radio" aria-checked="${k.id === state.category}" data-cat="${esc(k.id)}">
      ${tag}<span class="pic">${pic}</span><b>${esc(k.label)}</b><small>${esc(k.desc || '')}</small></button>`;
  }).join('');
}
$('#typeGrid').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cat]');
  if (!b) return;
  state.category = b.dataset.cat;
  state.model = 0;
  const u = new URL(location.href);
  u.searchParams.set('categorie', state.category);
  try { history.replaceState(null, '', u); } catch { /* page d'aperçu */ }
  renderTypes();
  renderModels();
  if (currentModels().length) $('#modeles').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// ---------- 03 · Modèles ----------
let modelBottle = null;
let modelProduct = null;
const currentModels = () => available.filter((m) => m.category === state.category);

async function renderModels() {
  const list = currentModels();
  const cat = catalog.categories.find((k) => k.id === state.category);
  const empty = !list.length;
  $('#models').hidden = empty;
  $('#soonMsg').hidden = !empty;
  $('#modelsSub').textContent = empty ? '' : `${cat?.label || ''} · ${list.length} modèle${list.length > 1 ? 's' : ''} configurable${list.length > 1 ? 's' : ''} en 3D`;
  if (empty) {
    $('#soonMsg').innerHTML = `Les ${esc((cat?.label || 'produits').toLowerCase())} arrivent bientôt. <a href="#types" style="color:var(--hp-accent);font-weight:600">Voir les gammes disponibles</a>`;
    syncLinks();
    return;
  }
  state.model = Math.min(state.model, list.length - 1);
  const m = list[state.model];
  $('#modelRail').innerHTML = list.map((x, i) =>
    `<button class="hp-mthumb" data-i="${i}" aria-current="${i === state.model}" title="${esc(x.name)}"><img src="${esc(x.thumbnail)}" alt="${esc(x.name)}"></button>`).join('');
  $('#modelCount').innerHTML = `<b>${pad(state.model + 1)}</b> / ${pad(list.length)}`;
  $('#prevModel').disabled = $('#nextModel').disabled = list.length < 2;
  syncLinks();

  modelProduct = await getProduct(m.id);
  renderCard();
  const el = $('#modelBottle');
  if (!modelBottle && !el.dataset.failed) {
    el.classList.add('is-loading');
    modelBottle = safeBottle(el, { tilt: 0, yaw: -0.5, fill: 0.8, drag: true, logo: null }, m.thumbnail);
    if (!modelBottle) el.dataset.failed = '1';
  }
  if (modelBottle) {
    await modelBottle.load(modelProduct);
    modelBottle.setColors(colorsNow(), true);
    el.classList.remove('is-loading');
  }
}

function renderCard() {
  const m = currentModels()[state.model];
  const p = modelProduct;
  if (!m || !p) return;
  const size = p.sizes?.find((s) => s.id === p.defaultSize) || p.sizes?.[0];
  const capacity = !unknown(m.capacity) ? m.capacity : !unknown(size?.capacity) ? size.capacity : null;
  const mat = p.materials?.find((x) => x.id === p.defaultMaterial) || p.materials?.[0];
  const pending = '<i>à confirmer</i>';
  const feats = [];
  if (mat) feats.push([FEAT.material, esc(mat.label) + (mat.confirmed === false ? pending : '')]);
  if (p.components?.some((c) => c.id === 'handle')) feats.push([FEAT.handle, 'Anse de transport rabattable']);
  if (p.ringFinishes?.length) feats.push([FEAT.ring, 'Bague métal : ' + p.ringFinishes.map((f) => esc(f.label.toLowerCase())).join(' ou ')]);
  if (p.printingMethods?.length) feats.push([FEAT.marking, `${p.printingMethods.length} techniques de marquage`]);
  feats.push([FEAT.colors, 'Corps, bouchon et anse en couleurs séparées']);
  const price = lowestPrice(p);
  const pal = paletteOf(p);
  const colorLabel = pal.find((c) => c.hex === state.color)?.label || state.color;
  $('#modelCard').innerHTML = `
    <div><h3>${esc(m.name)}</h3><p class="cap">${capacity ? esc(capacity) : 'Capacité à confirmer'}</p></div>
    <p class="desc">${esc(m.subtitle || p.subtitle || '')}</p>
    <div><p class="label">Couleur du corps · ${esc(colorLabel)}</p></div>
    <div class="hp-dots" role="radiogroup" aria-label="Couleur du corps">${pal.map((c) =>
      `<button class="hp-dot" role="radio" aria-checked="${c.hex === state.color}" data-hex="${esc(c.hex)}" style="background:${esc(c.hex)}" title="${esc(c.label)}" aria-label="${esc(c.label)}"></button>`).join('')}</div>
    <ul class="hp-feats">${feats.map(([i, t]) => `<li>${i}<span>${t}</span></li>`).join('')}</ul>
    <div class="hp-price">${price != null
      ? `<b>À partir de ${money(price, p.pricing?.currency)}</b><span>par unité, selon quantité</span>`
      : '<b>Prix sur devis</b><span>validation usine</span>'}</div>
    <a class="hp-cta" data-config href="${esc(configUrl(m.id))}">Personnaliser ce modèle ${ARROW}</a>`;
}

$('#modelCard').addEventListener('click', (e) => { const b = e.target.closest('[data-hex]'); if (b) setColor(b.dataset.hex); });
$('#modelRail').addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) { state.model = +b.dataset.i; renderModels(); } });
const step = (d) => { const n = currentModels().length; if (n > 1) { state.model = (state.model + d + n) % n; renderModels(); } };
$('#prevModel').addEventListener('click', () => step(-1));
$('#nextModel').addEventListener('click', () => step(1));

// ---------- Démarrage ----------
renderTypes();
syncLinks();
Promise.all([initHero(), renderModels()]).catch((e) => {
  console.error(e);
  $('#heroNote').textContent = 'Le modèle 3D n\'a pas pu être chargé.';
});
