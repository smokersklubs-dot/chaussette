// Page d'accueil : catalogue piloté par l'API WordPress ou products/catalog.json
import { loadCatalog } from './data.js';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ARROW = '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

const catalog = await loadCatalog();
const params = new URLSearchParams(location.search);
let active = params.get('categorie') || 'all';

function counts() {
  const c = {};
  for (const m of catalog.models) if (m.status === 'available') c[m.category] = (c[m.category] || 0) + 1;
  return c;
}

function renderCats() {
  const c = counts();
  const total = Object.values(c).reduce((a, b) => a + b, 0);
  const items = [{ id: 'all', label: 'Tout', n: total }, ...catalog.categories.map((k) => ({ ...k, n: c[k.id] || 0 }))];
  $('#cats').innerHTML = items.map((k) => `<button class="cat ${active === k.id ? 'is-active' : ''}" data-cat="${k.id}" aria-pressed="${active === k.id}">${esc(k.label)}<span class="n">${k.n || 'bientôt'}</span></button>`).join('');
}

function card(m) {
  const url = `configurateur.html?produit=${encodeURIComponent(m.id)}`;
  return `<a class="card" href="${url}" data-id="${esc(m.id)}">
    <div class="stage"><span class="badge">3D</span><img src="${esc(m.thumbnail)}" alt="${esc(m.name)}" style="view-transition-name: product-${esc(m.id)}" loading="lazy"></div>
    <div class="info">
      <h2>${esc(m.name)}</h2>
      <p>${esc(m.subtitle || '')}</p>
      <dl class="specs"><dt>Capacité</dt><dd>${esc(m.capacity || '—')}</dd><dt>Matière</dt><dd>${esc(m.material || '—')}</dd></dl>
      <div class="tags">${(m.tags || []).map((t) => `<span>${esc(t)}</span>`).join('')}</div>
      <span class="go">Configurer ${ARROW}</span>
    </div>
  </a>`;
}

function soonList(list) {
  if (!list.length) return '';
  return `<div class="soon-row"><p class="soon-title">À venir</p><div class="soon-items">${list.map((k) =>
    `<div class="soon-item"><b>${esc(k.label)}</b><span>${esc(k.desc || '')}</span></div>`).join('')}</div></div>`;
}

function renderGrid() {
  const models = catalog.models.filter((m) => m.status === 'available' && (active === 'all' || m.category === active));
  const c = counts();
  const empties = catalog.categories.filter((k) => !c[k.id] && (active === 'all' || active === k.id));
  $('#grid').innerHTML = models.map(card).join('');
  $('#soon').innerHTML = soonList(empties);
  const empty = !models.length;
  $('#empty').hidden = !empty;
  if (empty) $('#empty').textContent = 'Cette gamme arrive bientôt. Les autres produits restent disponibles dans « Tout ».';
  // légère rotation 3D qui suit le pointeur (5-8° max)
  document.querySelectorAll('.card:not(.soon)').forEach((el) => {
    const img = el.querySelector('img');
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      img.style.setProperty('--ry', `${(x * 14).toFixed(1)}deg`);
      img.style.setProperty('--rx', `${(-y * 8).toFixed(1)}deg`);
    });
    el.addEventListener('pointerleave', () => { img.style.removeProperty('--ry'); img.style.removeProperty('--rx'); });
  });
}

$('#cats').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cat]');
  if (!b) return;
  active = b.dataset.cat;
  const u = new URL(location.href);
  if (active === 'all') u.searchParams.delete('categorie'); else u.searchParams.set('categorie', active);
  history.replaceState(null, '', u);
  renderCats(); renderGrid();
});

renderCats();
renderGrid();
