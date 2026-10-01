/* SKLUBS Configurateur — back-office (produits, prix, catégories, projets). Aucune dépendance.
   Serveur : WordPress (API REST + jeton) par défaut, ou Supabase si window.SKLUBS_ADMIN.api est fourni (voir admin/supabase-admin.js). */
(function () {
  'use strict';
  const A = window.SKLUBS_ADMIN || {};
  const root = document.getElementById('sklubs-admin');
  if (!root) return;

  /* ---------- outils ---------- */
  const api = A.api || (async (path, opts = {}) => {
    const r = await fetch(A.root + path, { credentials: 'same-origin', ...opts, headers: { 'X-WP-Nonce': A.nonce, 'Content-Type': 'application/json' } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.message || `Erreur ${r.status}`);
    return j;
  });
  const h = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k === 'value') n.value = v;
      else if (k === 'checked') n.checked = !!v;
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) n.append(k instanceof Node ? k : document.createTextNode(String(k)));
    return n;
  };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const num = (v) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));
  const slug = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  const money = (v, c = 'EUR') => (v === null || v === undefined ? '—' : new Intl.NumberFormat('fr-FR', { style: 'currency', currency: c || 'EUR' }).format(v));
  const getP = (o, path) => path.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
  const setP = (o, path, v) => { const ks = path.split('.'); let a = o; ks.slice(0, -1).forEach((k) => { if (a[k] == null || typeof a[k] !== 'object') a[k] = {}; a = a[k]; }); a[ks.at(-1)] = v; };

  let toastT;
  const toast = (msg, bad) => {
    let t = document.querySelector('.sk-toast');
    if (!t) { t = h('div', { class: 'sk-toast' }); document.body.append(t); }
    t.textContent = msg; t.classList.toggle('bad', !!bad); t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 3500);
  };

  /* ---------- état ---------- */
  const S = { view: 'list', products: [], categories: [], cur: null, tab: 'general', dirty: false };
  const markDirty = () => { S.dirty = true; const b = document.querySelector('.sk-save'); if (b) b.disabled = false; const d = document.querySelector('.sk-dirty'); if (d) d.hidden = false; };
  window.addEventListener('beforeunload', (e) => { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });

  /* ---------- champs liés au produit courant ---------- */
  const P = () => S.cur.product;
  function field(label, input, help) {
    return h('label', { class: 'sk-field' }, h('span', { class: 'sk-label' }, label), input, help ? h('span', { class: 'sk-help' }, help) : null);
  }
  function text(path, opts = {}) {
    return h('input', { type: 'text', value: getP(P(), path) ?? '', placeholder: opts.placeholder, disabled: opts.disabled,
      oninput: (e) => { setP(P(), path, opts.transform ? opts.transform(e.target.value) : e.target.value); markDirty(); opts.after?.(); } });
  }
  function number(path, opts = {}) {
    const v = getP(P(), path);
    return h('input', { type: 'number', step: opts.step || 'any', min: opts.min, value: v ?? '', placeholder: opts.placeholder || 'à définir',
      oninput: (e) => { setP(P(), path, num(e.target.value)); markDirty(); opts.after?.(); } });
  }
  function select(path, options, opts = {}) {
    const v = getP(P(), path);
    return h('select', { onchange: (e) => { setP(P(), path, e.target.value); markDirty(); opts.after?.(); } },
      options.map((o) => h('option', { value: o.value, selected: o.value === v ? 'selected' : null }, o.label)));
  }
  function mediaInput(path, kind) {
    const input = text(path, { placeholder: kind === 'model' ? 'URL ou chemin du fichier .glb' : 'URL de l\'image' });
    const btn = h('button', { type: 'button', class: 'button', onclick: () => {
      if (A.media) { // Supabase : envoi dans le stockage public « catalog »
        A.media(kind).then((url) => { if (!url) return; setP(P(), path, url); input.value = url; markDirty(); }).catch((e) => toast(e.message, true));
        return;
      }
      if (!window.wp?.media) { toast('Médiathèque indisponible.', true); return; }
      const f = wp.media({ title: kind === 'model' ? 'Modèle 3D (.glb)' : 'Image', multiple: false, library: kind === 'model' ? {} : { type: 'image' } });
      f.on('select', () => { const a = f.state().get('selection').first().toJSON(); setP(P(), path, a.url); input.value = a.url; markDirty(); });
      f.open();
    } }, 'Médiathèque');
    return h('div', { class: 'sk-inline' }, input, btn);
  }

  /* tableau éditable : rows = tableau d'objets ; cols = [{label, key | get/set, type, options, width}] */
  function table(rows, cols, opts = {}) {
    const wrap = h('div', { class: 'sk-table-wrap' });
    const draw = () => {
      wrap.innerHTML = '';
      const t = h('table', { class: 'sk-table' },
        h('thead', {}, h('tr', {}, cols.map((c) => h('th', { style: c.width ? `width:${c.width}` : null, title: c.hint || null }, c.label)), h('th', { style: 'width:36px' }))),
        h('tbody', {}, rows.map((row, i) => h('tr', {}, cols.map((c) => h('td', {}, cell(row, i, c))),
          opts.remove === false ? null : h('td', {}, h('button', { type: 'button', class: 'sk-x', title: 'Supprimer la ligne', onclick: () => { opts.onRemove ? opts.onRemove(row, i) : rows.splice(i, 1); markDirty(); draw(); opts.after?.(); } }, '×'))))));
      wrap.append(t);
      if (opts.add !== false) wrap.append(h('button', { type: 'button', class: 'button sk-add', onclick: () => { const r = opts.newRow ? opts.newRow() : {}; if (opts.onAdd) opts.onAdd(r); else rows.push(r); markDirty(); draw(); opts.after?.(); } }, opts.addLabel || '+ Ajouter'));
    };
    const cell = (row, i, c) => {
      const get = () => (c.get ? c.get(row, i) : getP(row, c.key));
      const put = (v) => { c.set ? c.set(row, v, i) : setP(row, c.key, v); markDirty(); opts.after?.(); };
      const v = get();
      switch (c.type) {
        case 'number': return h('input', { type: 'number', step: c.step || 'any', value: v ?? '', placeholder: c.placeholder || 'à définir', oninput: (e) => put(num(e.target.value)) });
        case 'check': return h('input', { type: 'checkbox', checked: !!v, onchange: (e) => put(e.target.checked) });
        case 'color': return h('div', { class: 'sk-inline' }, h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(v || '') ? v : '#000000', oninput: (e) => { put(e.target.value); e.target.nextSibling.value = e.target.value; } }), h('input', { type: 'text', value: v ?? '', class: 'sk-hex', oninput: (e) => put(e.target.value) }));
        case 'select': return h('select', { onchange: (e) => put(e.target.value) }, (typeof c.options === 'function' ? c.options() : c.options).map((o) => h('option', { value: o.value, selected: o.value === v ? 'selected' : null }, o.label)));
        case 'multi': {
          const cur = new Set(v || []);
          return h('div', { class: 'sk-multi' }, (typeof c.options === 'function' ? c.options() : c.options).map((o) => h('label', {}, h('input', { type: 'checkbox', checked: cur.has(o.value), onchange: (e) => { e.target.checked ? cur.add(o.value) : cur.delete(o.value); put([...cur]); } }), o.label)));
        }
        default: return h('input', { type: 'text', value: v ?? '', placeholder: c.placeholder || '', oninput: (e) => put(c.slug ? slug(e.target.value) : e.target.value), onblur: c.slug ? (e) => { e.target.value = get() ?? ''; } : null });
      }
    };
    draw();
    return wrap;
  }

  /* ---------- vues ---------- */
  async function loadList() {
    [S.products, S.categories] = await Promise.all([api('admin/products'), api('admin/categories')]);
  }

  function shell(title, actions, body) {
    root.innerHTML = '';
    root.append(h('div', { class: 'sk-head' }, h('h1', {}, title), h('div', { class: 'sk-actions' }, actions)), body);
  }

  function viewList() {
    S.view = 'list';
    const catName = (id) => S.categories.find((c) => c.id === id)?.label || id || '—';
    const rows = S.products.map((p) => h('tr', {},
      h('td', {}, h('strong', {}, h('a', { href: '#', onclick: (e) => { e.preventDefault(); openProduct(p.id); } }, p.name)), h('div', { class: 'sk-sub' }, p.id)),
      h('td', {}, catName(p.category)),
      h('td', {}, String(p.variants)),
      h('td', {}, h('span', { class: `sk-pill ${p.status}` }, p.status === 'publish' ? 'En ligne' : 'Brouillon')),
      h('td', {}, new Date(p.modified).toLocaleString('fr-FR')),
      h('td', { class: 'sk-row-actions' },
        h('button', { class: 'button', onclick: () => openProduct(p.id) }, 'Modifier'),
        h('button', { class: 'button', onclick: () => duplicate(p.id) }, 'Dupliquer'),
        A.configuratorUrl ? h('a', { class: 'button', target: '_blank', href: `${A.configuratorUrl.replace(/\/$/, '')}/configurateur.html?produit=${p.id}` }, 'Voir') : null,
        h('button', { class: 'button sk-danger', onclick: () => remove(p.id, p.name) }, 'Supprimer'))));
    const fileIn = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: importJson });
    shell('Configurateur — produits', [
      h('button', { class: 'button button-primary', onclick: () => newProduct() }, '+ Nouveau produit'),
      h('button', { class: 'button', onclick: () => fileIn.click() }, 'Importer un JSON'), fileIn,
      h('button', { class: 'button', onclick: viewCategories }, 'Catégories'),
      A.projects ? h('button', { class: 'button', onclick: viewProjects }, 'Projets clients') : null,
      A.logout ? h('button', { class: 'button', onclick: A.logout }, 'Déconnexion') : null,
    ], h('div', {},
      S.products.length
        ? h('table', { class: 'widefat striped sk-list' }, h('thead', {}, h('tr', {}, ['Produit', 'Catégorie', 'Variantes', 'Statut', 'Modifié', ''].map((t) => h('th', {}, t)))), h('tbody', {}, rows))
        : h('p', {}, 'Aucun produit. Créez-en un ou importez un fichier product.json.'),
      h('p', { class: 'sk-help' }, 'Un produit « En ligne » apparaît sur l\'accueil des configurateurs et peut être configuré. Les prix vides restent « sur devis » côté client.')));
  }

  /* ---------- projets clients (Supabase) ---------- */
  const INTENT = { quote: 'Devis', order: 'Commande', save: 'Projet enregistré' };
  const PSTATUS = { new: 'Nouveau', in_progress: 'En cours', quoted: 'Devis envoyé', ordered: 'Commandé', done: 'Terminé', cancelled: 'Annulé' };
  async function viewProjects() {
    S.view = 'projects';
    let list = [];
    try { list = await A.projects.list(); } catch (e) { toast(e.message, true); }
    const detail = h('pre', { class: 'sk-json-view', hidden: true });
    const price = (pr) => (pr && pr.unit !== null && pr.unit !== undefined ? `${money(pr.unit, pr.currency)} / u · ${money(pr.total, pr.currency)}${pr.taxLabel ? ` ${pr.taxLabel}` : ''}` : 'Sur devis');
    const rows = list.map((r) => h('tr', {},
      h('td', {}, new Date(r.created_at).toLocaleString('fr-FR')),
      h('td', {}, h('strong', {}, r.reference)),
      h('td', {}, INTENT[r.intent] || r.intent),
      h('td', {}, r.product_id || '—'),
      h('td', {}, String(r.quantity ?? '—')),
      h('td', {}, price(r.price_server)),
      h('td', {}, h('select', { onchange: async (e) => { try { await A.projects.setStatus(r.id, e.target.value); toast('Statut mis à jour.'); } catch (err) { toast(err.message, true); } } },
        Object.entries(PSTATUS).map(([v, l]) => h('option', { value: v, selected: v === r.status ? 'selected' : null }, l)))),
      h('td', {}, Object.entries(r.files || {}).map(([k, path]) => h('button', { type: 'button', class: 'button-link', onclick: async () => { try { window.open(await A.projects.fileUrl(path), '_blank'); } catch (e) { toast(e.message, true); } } }, k)), r.wc_order_id ? h('div', { class: 'sk-sub' }, `Commande WooCommerce n° ${r.wc_order_id}`) : null),
      h('td', {}, h('button', { class: 'button', onclick: () => { detail.hidden = false; detail.textContent = JSON.stringify(r.project, null, 2); detail.scrollIntoView({ behavior: 'smooth' }); } }, 'Détail'))));
    shell('Projets clients', [h('button', { class: 'button', onclick: () => viewList() }, '← Produits'), h('button', { class: 'button', onclick: viewProjects }, 'Actualiser')],
      h('div', {}, list.length
        ? h('table', { class: 'widefat striped sk-list' }, h('thead', {}, h('tr', {}, ['Date', 'Référence', 'Demande', 'Produit', 'Qté', 'Prix (serveur)', 'Statut', 'Fichiers', ''].map((t) => h('th', {}, t)))), h('tbody', {}, rows))
        : h('p', {}, 'Aucun projet pour le moment.'), detail));
  }

  function viewCategories() {
    S.view = 'categories';
    const cats = clone(S.categories);
    shell('Catégories', [
      h('button', { class: 'button', onclick: viewList }, '← Produits'),
      h('button', { class: 'button button-primary', onclick: async () => { try { S.categories = await api('admin/categories', { method: 'PUT', body: JSON.stringify(cats) }); S.dirty = false; toast('Catégories enregistrées.'); } catch (e) { toast(e.message, true); } } }, 'Enregistrer'),
    ], h('div', { class: 'sk-card' },
      h('p', { class: 'sk-help' }, 'L\'ordre des lignes est l\'ordre des filtres sur l\'accueil. Une catégorie sans produit en ligne s\'affiche « À venir ».'),
      table(cats, [
        { label: 'Identifiant', key: 'id', slug: true, width: '160px' },
        { label: 'Nom', key: 'label' },
        { label: 'Description', key: 'desc' },
      ], { newRow: () => ({ id: '', label: '', desc: '' }), addLabel: '+ Ajouter une catégorie' })));
  }

  async function openProduct(id) {
    if (S.dirty && !confirm('Des modifications ne sont pas enregistrées. Continuer ?')) return;
    try {
      const r = await api(`admin/products/${id}`);
      S.cur = { id, isNew: false, status: r.status, product: r.product };
      S.dirty = false; S.tab = 'general'; viewEdit();
    } catch (e) { toast(e.message, true); }
  }

  function newProduct(from) {
    const p = clone(from || A.template || {});
    p.id = ''; p.name = from ? `${from.name} (copie)` : 'Nouveau produit';
    S.cur = { id: '', isNew: true, status: 'draft', product: p };
    S.dirty = true; S.tab = 'general'; viewEdit();
  }

  async function duplicate(id) {
    try { const r = await api(`admin/products/${id}`); newProduct(r.product); toast('Copie créée : choisissez un identifiant puis enregistrez.'); } catch (e) { toast(e.message, true); }
  }

  async function remove(id, name) {
    if (!confirm(`Supprimer définitivement « ${name} » ?`)) return;
    try { await api(`admin/products/${id}`, { method: 'DELETE' }); await loadList(); viewList(); toast('Produit supprimé.'); } catch (e) { toast(e.message, true); }
  }

  function importJson(e) {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    f.text().then((t) => {
      const p = JSON.parse(t);
      if (!p || !p.sizes) throw new Error('Ce fichier ne ressemble pas à un product.json.');
      S.cur = { id: p.id || '', isNew: true, status: 'draft', product: p };
      S.dirty = true; S.tab = 'general'; viewEdit(); toast('Produit importé : vérifiez puis enregistrez.');
    }).catch((err) => toast(err.message, true));
  }

  async function save() {
    const p = P();
    const id = S.cur.isNew ? slug(S.cur.id || p.id || p.name) : S.cur.id;
    if (!id || id.length < 2) { toast('Choisissez un identifiant (onglet Général).', true); S.tab = 'general'; viewEdit(); return; }
    if (S.cur.isNew && S.products.some((x) => x.id === id) && !confirm(`L'identifiant « ${id} » existe déjà. Le remplacer ?`)) return;
    try {
      const r = await api(`admin/products/${id}`, { method: 'PUT', body: JSON.stringify({ status: S.cur.status, product: p }) });
      S.cur = { id, isNew: false, status: r.status, product: r.product };
      S.dirty = false; await loadList(); viewEdit(); toast('Produit enregistré.');
    } catch (e) { toast(e.message, true); }
  }

  /* ---------- éditeur ---------- */
  const TABS = [['general', 'Général'], ['variants', 'Variantes'], ['materials', 'Matières & finitions'], ['colors', 'Couleurs & pièces'], ['marking', 'Marquage'], ['pricing', 'Prix & quantités'], ['advanced', 'Avancé (JSON)']];

  function viewEdit() {
    S.view = 'edit';
    const p = P();
    p.pricing = p.pricing || {}; p.quantity = p.quantity || {}; p.card = p.card || {}; p.colors = p.colors || { catalog: [], defaults: {} };
    const body = h('div', { class: 'sk-card' });
    const tabs = h('nav', { class: 'sk-tabs' }, TABS.map(([k, l]) => h('button', { type: 'button', class: S.tab === k ? 'is-active' : '', onclick: () => { S.tab = k; viewEdit(); } }, l)));
    shell(S.cur.isNew ? 'Nouveau produit' : p.name, [
      h('button', { class: 'button', onclick: () => { if (S.dirty && !confirm('Quitter sans enregistrer ?')) return; S.dirty = false; viewList(); } }, '← Produits'),
      h('span', { class: 'sk-dirty', hidden: !S.dirty }, 'Non enregistré'),
      h('select', { class: 'sk-status', onchange: (e) => { S.cur.status = e.target.value; markDirty(); } },
        h('option', { value: 'draft', selected: S.cur.status !== 'publish' ? 'selected' : null }, 'Brouillon'),
        h('option', { value: 'publish', selected: S.cur.status === 'publish' ? 'selected' : null }, 'En ligne')),
      h('button', { class: 'button button-primary sk-save', disabled: !S.dirty, onclick: save }, 'Enregistrer'),
    ], h('div', {}, tabs, body));
    ({ general, variants, materials, colors, marking, pricing, advanced })[S.tab](body, p);
  }

  const sizeOpts = () => (P().sizes || []).map((s) => ({ value: s.id, label: s.label || s.id }));
  const matOpts = () => (P().materials || []).map((m) => ({ value: m.id, label: m.label || m.id }));
  const finOpts = () => Object.entries(P().finishes || {}).map(([id, f]) => ({ value: id, label: f.label || id }));
  const zoneOpts = () => (P().printZones || []).map((z) => ({ value: z.id, label: z.label || z.id }));

  function general(body, p) {
    body.append(h('div', { class: 'sk-grid' },
      field('Identifiant', S.cur.isNew
        ? h('input', { type: 'text', value: S.cur.id, placeholder: 'ex. bouteille-sport-750', oninput: (e) => { S.cur.id = slug(e.target.value); markDirty(); }, onblur: (e) => { e.target.value = S.cur.id; } })
        : h('input', { type: 'text', value: S.cur.id, disabled: true }), 'Utilisé dans l\'adresse : configurateur?produit=identifiant'),
      field('Nom', text('name')),
      field('Catégorie', select('category', [{ value: '', label: '—' }, ...S.categories.map((c) => ({ value: c.id, label: c.label }))])),
      field('Sous-titre (bandeau)', text('subtitle')),
      field('Accroche de la carte d\'accueil', text('card.subtitle')),
      field('Capacité affichée', text('card.capacity', { placeholder: 'ex. 500 ml' })),
      field('Matière affichée', text('card.material')),
      field('Étiquettes (séparées par des virgules)', h('input', { type: 'text', value: (p.card.tags || []).join(', '), oninput: (e) => { p.card.tags = e.target.value.split(',').map((s) => s.trim()).filter(Boolean); markDirty(); } })),
      field('Ordre sur l\'accueil', number('card.order', { step: 1, placeholder: '0' })),
      field('Vignette (accueil)', mediaInput('card.thumbnail', 'image'), 'Image portrait sur fond transparent (webp ou png).'),
      field('Modèle 3D par défaut', mediaInput('master.model', 'model'), 'Fichier .glb. Une variante peut avoir le sien (onglet Variantes).'),
      field('Rayon du corps (unités du modèle)', number('master.bodyRadius'), 'Sert au placement du marquage. Fourni avec le master 3D.'),
      field('Hauteur totale (unités du modèle)', number('master.totalHeight')),
      field('Variante par défaut', select('defaultSize', sizeOpts())),
      field('Matière par défaut', select('defaultMaterial', matOpts())),
    ));
  }

  function variants(body, p) {
    p.sizes = p.sizes || [];
    body.append(h('p', { class: 'sk-help' }, 'Une variante = un format (capacité, taille). Chaque variante a ses paliers de prix (onglet Prix) et peut avoir son propre modèle 3D.'),
      table(p.sizes, [
        { label: 'Identifiant', key: 'id', slug: true, width: '130px' },
        { label: 'Libellé', key: 'label', width: '160px' },
        { label: 'Capacité', key: 'capacity', placeholder: 'ex. 500 ml', width: '120px' },
        { label: 'Confirmée usine', key: 'confirmed', type: 'check', width: '90px' },
        { label: 'Zone impr. bas', key: 'printZone.bottom', type: 'number', width: '90px', hint: 'Hauteur en unités BODY_HEIGHT (0 = fond)' },
        { label: 'Zone impr. haut', key: 'printZone.top', type: 'number', width: '90px' },
        { label: 'Modèle 3D propre (optionnel)', key: 'master.model', placeholder: 'vide = modèle par défaut' },
      ], { newRow: () => ({ id: `v${p.sizes.length + 1}`, label: 'Nouvelle variante', capacity: '', confirmed: false, printZone: { bottom: 0.065, top: 0.825 } }), addLabel: '+ Ajouter une variante' }));
  }

  function materials(body, p) {
    p.materials = p.materials || []; p.finishes = p.finishes || {};
    const pr = p.pricing; pr.materialSurcharge = pr.materialSurcharge || {}; pr.finishSurcharge = pr.finishSurcharge || {};
    body.append(h('h3', {}, 'Matières'),
      table(p.materials, [
        { label: 'Identifiant', key: 'id', slug: true, width: '120px' },
        { label: 'Nom', key: 'label', width: '180px' },
        { label: 'Description client', key: 'desc', placeholder: 'vide = techniques possibles', width: '180px' },
        { label: 'Finitions possibles', key: 'finishes', type: 'multi', options: finOpts },
        { label: 'Finition par défaut', key: 'defaultFinish', type: 'select', options: finOpts, width: '150px' },
        { label: 'Supplément € / u', type: 'number', width: '100px', get: (r) => pr.materialSurcharge[r.id], set: (r, v) => { pr.materialSurcharge[r.id] = v; } },
        { label: 'Confirmée', key: 'confirmed', type: 'check', width: '70px' },
      ], { newRow: () => ({ id: 'matiere', label: 'Nouvelle matière', finishes: Object.keys(p.finishes).slice(0, 1), defaultFinish: Object.keys(p.finishes)[0], confirmed: false }) }));
    p.materialsOnRequest = p.materialsOnRequest || [];
    body.append(h('h3', {}, 'Matières sur demande (affichées, non configurables en 3D)'),
      h('p', { class: 'sk-help' }, 'Listées dans l\'étape « Matière & couleur » avec la mention « Sur demande » : le client les précise dans sa demande de devis.'),
      table(p.materialsOnRequest, [
        { label: 'Nom', key: 'label', width: '200px' },
        { label: 'Description', key: 'desc' },
      ], { newRow: () => ({ label: 'Nouvelle matière', desc: '' }), addLabel: '+ Ajouter une matière sur demande' }),
      field('Message au clic', text('materialsOnRequestNote', { placeholder: 'ex. Précisez-la dans votre demande de devis.' })));
    // finitions : objet -> lignes
    const rows = Object.entries(p.finishes).map(([id, f]) => ({ id, ...f }));
    const sync = () => { const o = {}; rows.forEach((r) => { const { id, ...rest } = r; if (id) o[id] = rest; }); p.finishes = o; };
    body.append(h('h3', {}, 'Finitions (rendu 3D + supplément)'),
      table(rows, [
        { label: 'Identifiant', key: 'id', slug: true, width: '110px' },
        { label: 'Nom', key: 'label', width: '170px' },
        { label: 'Rugosité 0–1', key: 'roughness', type: 'number', width: '80px' },
        { label: 'Métal 0–1', key: 'metalness', type: 'number', width: '80px' },
        { label: 'Vernis 0–1', key: 'clearcoat', type: 'number', width: '80px' },
        { label: 'Transparence 0–1', key: 'transmission', type: 'number', width: '90px' },
        { label: 'Couleur libre', key: 'colorable', type: 'check', invert: false, width: '70px', get: (r) => r.colorable !== false, set: (r, v) => { r.colorable = v; } },
        { label: 'Couleur fixe', key: 'fixedColor', type: 'color', width: '150px' },
        { label: 'Supplément € / u', type: 'number', width: '100px', get: (r) => pr.finishSurcharge[r.id], set: (r, v) => { pr.finishSurcharge[r.id] = v; } },
      ], { newRow: () => ({ id: `finition${rows.length + 1}`, label: 'Nouvelle finition', roughness: 0.5, metalness: 0, clearcoat: 0, colorable: true }), after: sync,
        onAdd: (r) => { rows.push(r); sync(); }, onRemove: (r, i) => { rows.splice(i, 1); sync(); } }));
  }

  function colors(body, p) {
    p.colors.catalog = p.colors.catalog || []; p.colors.defaults = p.colors.defaults || {};
    p.ringFinishes = p.ringFinishes || []; const pr = p.pricing; pr.ringSurcharge = pr.ringSurcharge || {};
    body.append(h('h3', {}, 'Nuancier'),
      table(p.colors.catalog, [
        { label: 'Identifiant', key: 'id', slug: true, width: '130px' },
        { label: 'Nom', key: 'label', width: '200px' },
        { label: 'Couleur', key: 'hex', type: 'color' },
      ], { newRow: () => ({ id: 'couleur', label: 'Nouvelle couleur', hex: '#888888' }), addLabel: '+ Ajouter une couleur' }),
      h('h3', {}, 'Couleurs par défaut'),
      h('div', { class: 'sk-grid' }, ['body', 'cap', 'handle'].map((k) => field({ body: 'Corps', cap: 'Bouchon', handle: 'Anse' }[k],
        h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(p.colors.defaults[k] || '') ? p.colors.defaults[k] : '#000000', oninput: (e) => { p.colors.defaults[k] = e.target.value; markDirty(); } })))),
      field('Supplément couleur personnalisée (Pantone) € / u', number('pricing.customColorSurcharge'), 'Vide = pas de supplément affiché.'),
      h('h3', {}, 'Bague métallique'),
      table(p.ringFinishes, [
        { label: 'Identifiant', key: 'id', slug: true, width: '120px' },
        { label: 'Nom', key: 'label', width: '180px' },
        { label: 'Couleur', key: 'color', type: 'color', width: '170px' },
        { label: 'Métal 0–1', key: 'metalness', type: 'number', width: '80px' },
        { label: 'Rugosité 0–1', key: 'roughness', type: 'number', width: '80px' },
        { label: 'Supplément € / u', type: 'number', width: '100px', get: (r) => pr.ringSurcharge[r.id], set: (r, v) => { pr.ringSurcharge[r.id] = v; } },
        { label: 'Confirmée', key: 'confirmed', type: 'check', width: '70px', get: (r) => r.confirmed !== false, set: (r, v) => { r.confirmed = v; } },
      ], { newRow: () => ({ id: 'bague', label: 'Nouvelle finition', color: '#cccccc', metalness: 1, roughness: 0.2 }) }));
  }

  function marking(body, p) {
    p.printingMethods = p.printingMethods || []; p.printZones = p.printZones || []; p.rules = p.rules || {};
    p.rules.methodsByMaterial = p.rules.methodsByMaterial || {}; p.rules.zonesByMethod = p.rules.zonesByMethod || {};
    const pr = p.pricing; pr.methodUnitPrice = pr.methodUnitPrice || {}; pr.setupFee = pr.setupFee || {};
    const matsOf = (mid) => Object.entries(p.rules.methodsByMaterial).filter(([, ms]) => ms.includes(mid)).map(([m]) => m);
    const setMats = (mid, mats) => { (p.materials || []).forEach((m) => { const l = new Set(p.rules.methodsByMaterial[m.id] || []); mats.includes(m.id) ? l.add(mid) : l.delete(mid); p.rules.methodsByMaterial[m.id] = [...l]; }); };
    body.append(h('h3', {}, 'Techniques de marquage'),
      h('p', { class: 'sk-help' }, 'Une technique n\'est proposée que sur les matières et zones cochées. Prix vide = sur devis.'),
      table(p.printingMethods, [
        { label: 'Identifiant', key: 'id', slug: true, width: '100px' },
        { label: 'Nom', key: 'label', width: '150px' },
        { label: 'Rendu 3D', key: 'render', type: 'select', options: [{ value: 'print', label: 'Impression' }, { value: 'engrave', label: 'Gravure' }], width: '120px' },
        { label: 'Matières', type: 'multi', options: matOpts, get: (r) => matsOf(r.id), set: (r, v) => setMats(r.id, v) },
        { label: 'Zones', type: 'multi', options: zoneOpts, get: (r) => p.rules.zonesByMethod[r.id] || [], set: (r, v) => { p.rules.zonesByMethod[r.id] = v; } },
      ], { newRow: () => ({ id: 'technique', label: 'Nouvelle technique', render: 'print', maxColors: null }) }),
      h('h3', {}, 'Prix du marquage'),
      h('p', { class: 'sk-help' }, 'Prix par pièce marquée (s\'ajoute au prix du produit) et frais de calage (fixes, répartis sur la quantité). « Au nombre de couleurs » (sérigraphie, tampographie) : le client choisit le nombre de couleurs ; chaque couleur en plus ajoute le prix « couleur supplémentaire » par pièce, et le calage est compté par couleur. MOQ : quantité minimum pour cette technique. Prix dégressif par quantité : onglet « Prix & quantités ». Vide = sur devis.'),
      table(p.printingMethods, [
        { label: 'Technique', key: 'label', width: '150px' },
        { label: 'Prix € / pièce', type: 'number', width: '100px', get: (r) => pr.methodUnitPrice[r.id], set: (r, v) => { pr.methodUnitPrice[r.id] = v; } },
        { label: 'Calage €', type: 'number', width: '90px', get: (r) => pr.setupFee[r.id], set: (r, v) => { pr.setupFee[r.id] = v; } },
        { label: 'Au nombre de couleurs', key: 'perColor', type: 'check', width: '90px' },
        { label: 'Couleurs max', type: 'number', step: 1, width: '80px', placeholder: 'illimité', get: (r) => (typeof r.maxColors === 'number' ? r.maxColors : null), set: (r, v) => { r.maxColors = v; } },
        { label: 'Couleur supp. € / pièce', type: 'number', width: '110px', get: (r) => (pr.colorUnitPrice || {})[r.id], set: (r, v) => { pr.colorUnitPrice = pr.colorUnitPrice || {}; pr.colorUnitPrice[r.id] = v; } },
        { label: 'MOQ technique', type: 'number', step: 1, width: '90px', placeholder: '—', get: (r) => (pr.methodMoq || {})[r.id], set: (r, v) => { pr.methodMoq = pr.methodMoq || {}; pr.methodMoq[r.id] = v; } },
      ], { add: false, remove: false }),
      h('h3', {}, 'Textes des techniques (étape « Méthode d\'impression »)'),
      table(p.printingMethods, [
        { label: 'Technique', key: 'label', width: '150px' },
        { label: 'Description', key: 'desc' },
        { label: 'Avantages (séparés par ;)', get: (r) => (r.benefits || []).join(' ; '), set: (r, v) => { r.benefits = v.split(';').map((x) => x.trim()).filter(Boolean); } },
      ], { add: false, remove: false }),
      h('h3', {}, 'Zones d\'impression'),
      table(p.printZones, [
        { label: 'Identifiant', key: 'id', slug: true, width: '120px' },
        { label: 'Nom', key: 'label' },
        { label: 'Largeur (part du tour, 0–1)', key: 'widthRatio', type: 'number', width: '140px' },
        { label: 'Centre (0 = dos, 0,5 = face)', key: 'centerU', type: 'number', width: '140px' },
      ], { newRow: () => ({ id: 'zone', label: 'Nouvelle zone', widthRatio: 0.3, centerU: 0.5 }) }));
  }

  function pricing(body, p) {
    const pr = p.pricing; pr.tiers = pr.tiers || {};
    p.production = p.production || {};
    const sim = h('div', { class: 'sk-sim' });
    const drawSim = () => simulate(sim, p);
    body.append(h('div', { class: 'sk-grid' },
      field('Devise', select('pricing.currency', [{ value: 'EUR', label: 'EUR (€)' }, { value: 'USD', label: 'USD ($)' }, { value: 'GBP', label: 'GBP (£)' }, { value: 'CHF', label: 'CHF' }], { after: drawSim })),
      field('Affichage du prix', select('pricing.priceMode', [{ value: 'instant', label: 'Prix instantané' }, { value: 'estimated', label: 'Prix estimé (confirmé ensuite)' }])),
      field('Minimum de commande (MOQ)', number('quantity.moq', { step: 1, placeholder: 'vide = premier palier', after: drawSim })),
      field('Quantité proposée par défaut', number('quantity.default', { step: 1, placeholder: '100' })),
      field('Délai de production', text('production.leadTime', { placeholder: 'ex. 15 jours ouvrés' })),
      field('Mention des prix', select('pricing.taxLabel', [{ value: '', label: 'Aucune' }, { value: 'HT', label: 'HT' }, { value: 'TTC', label: 'TTC' }]))),
      h('p', { class: 'sk-help' }, 'Prix unitaire de base par palier, pour chaque variante. Les suppléments (matière, finition, bague, marquage) s\'ajoutent par unité ; les frais de calage sont répartis sur la quantité. Prix vide = sur devis.'));
    (p.sizes || []).forEach((s) => {
      pr.tiers[s.id] = pr.tiers[s.id] || [];
      const rows = pr.tiers[s.id];
      const others = (p.sizes || []).filter((o) => o.id !== s.id && (pr.tiers[o.id] || []).length);
      body.append(h('div', { class: 'sk-tier-head' }, h('h3', {}, `Paliers — ${s.label || s.id}`),
        others.length ? h('select', { onchange: (e) => { if (!e.target.value) return; pr.tiers[s.id] = clone(pr.tiers[e.target.value]); markDirty(); viewEdit(); } },
          h('option', { value: '' }, 'Copier les paliers de…'), others.map((o) => h('option', { value: o.id }, o.label || o.id))) : null),
      table(rows, [
        { label: 'À partir de (pièces)', key: 'min', type: 'number', step: 1, width: '160px', placeholder: 'ex. 100' },
        { label: 'Prix de base € / u', key: 'unit', type: 'number', width: '160px' },
        { label: '« Le plus choisi »', key: 'popular', type: 'check', width: '120px' },
      ], { newRow: () => ({ min: rows.length ? Math.round((rows.at(-1).min || 100) * 2) : 100, unit: null, popular: false }), addLabel: '+ Ajouter un palier', after: drawSim }));
    });
    pr.methodTiers = pr.methodTiers || {};
    body.append(h('h3', {}, 'Prix du marquage par quantité (optionnel)'),
      h('p', { class: 'sk-help' }, 'Rempli pour une technique, ce tableau remplace son prix unique (onglet Marquage) : à partir de N pièces, prix du marquage par pièce. Le premier palier sert aussi de minimum pour cette technique.'));
    (p.printingMethods || []).forEach((m) => {
      pr.methodTiers[m.id] = pr.methodTiers[m.id] || [];
      const rows = pr.methodTiers[m.id];
      body.append(h('div', { class: 'sk-tier-head' }, h('h4', { style: 'margin:14px 0 4px' }, m.label || m.id)),
        table(rows, [
          { label: 'À partir de (pièces)', key: 'min', type: 'number', step: 1, width: '160px', placeholder: 'ex. 100' },
          { label: 'Marquage € / pièce', key: 'unit', type: 'number', width: '160px' },
        ], { newRow: () => ({ min: rows.length ? Math.round((rows.at(-1).min || 100) * 2) : 100, unit: null }), addLabel: '+ Ajouter un palier de marquage', after: drawSim }));
    });
    body.append(h('h3', {}, 'Simulation'), sim);
    drawSim();
  }

  // simulation avec le moteur de prix du configurateur lui-même (js/pricing.js) : mêmes règles partout
  let engine = null;
  const loadEngine = () => (engine ||= import(A.pricingUrl || new URL('../js/pricing.js', document.currentScript?.src || location.href).href));
  const SIM = { method: null, colors: 1, art: true };
  function simulate(box, p) {
    box.innerHTML = '<p class="sk-help">Calcul…</p>';
    loadEngine().then(({ computePrice, printColorRange }) => {
      const pr = p.pricing || {}; const cur = pr.currency || 'EUR';
      const mat = p.defaultMaterial || p.materials?.[0]?.id;
      const fin = p.materials?.find((m) => m.id === mat)?.defaultFinish;
      if (!SIM.method || !(p.printingMethods || []).some((m) => m.id === SIM.method)) SIM.method = p.printingMethods?.[0]?.id;
      const range = printColorRange(p, SIM.method);
      const base = { material: mat, finish: fin, colors: { ...(p.colors?.defaults || {}), ring: p.colors?.defaults?.ring || p.ringFinishes?.[0]?.id }, zone: null, method: SIM.method, printColors: range ? SIM.colors : 1, customColor: false };
      box.innerHTML = '';
      const controls = h('div', { class: 'sk-inline', style: 'gap:12px;margin-bottom:8px' },
        h('label', {}, 'Technique ', h('select', { onchange: (e) => { SIM.method = e.target.value; simulate(box, p); } }, (p.printingMethods || []).map((m) => h('option', { value: m.id, selected: m.id === SIM.method ? 'selected' : null }, m.label || m.id)))),
        range ? h('label', {}, 'Couleurs ', h('select', { onchange: (e) => { SIM.colors = +e.target.value; simulate(box, p); } }, Array.from({ length: range.max }, (_, i) => h('option', { value: i + 1, selected: i + 1 === SIM.colors ? 'selected' : null }, String(i + 1))))) : null);
      box.append(controls);
      (p.sizes || []).forEach((s) => {
        const mins = [...new Set([...(pr.tiers?.[s.id] || []).map((t) => +t.min), ...((pr.methodTiers || {})[SIM.method] || []).map((t) => +t.min)].filter((x) => x > 0))].sort((a, b) => a - b);
        if (!mins.length) { box.append(h('p', { class: 'sk-help' }, `${s.label || s.id} : ajoutez des paliers pour voir les prix.`)); return; }
        const t = h('table', { class: 'sk-table sk-simt' }, h('thead', {}, h('tr', {}, ['Quantité', 'Sans marquage € / pièce', 'Avec marquage € / pièce', 'Total avec marquage', 'Remarque'].map((x) => h('th', {}, x)))),
          h('tbody', {}, mins.map((q) => {
            const plain = computePrice(p, { ...base, size: s.id, quantity: q, hasArtwork: false });
            const marked = computePrice(p, { ...base, size: s.id, quantity: q, hasArtwork: true });
            const note = marked.status === 'factory' ? (marked.belowMoq ? `minimum ${marked.moq} pcs` : `à renseigner : ${marked.reasons.join(', ')}`) : '';
            return h('tr', {}, h('td', {}, `${q} pcs`), h('td', {}, money(plain.unit, cur)), h('td', {}, money(marked.unit, cur)), h('td', {}, money(marked.total, cur)), h('td', { class: 'sk-help' }, note));
          })));
        box.append(h('div', { class: 'sk-sub' }, s.label || s.id), t);
      });
    }).catch((e) => { box.innerHTML = `<p class="sk-help warn">Simulation indisponible : ${e.message}</p>`; });
  }


  function advanced(body, p) {
    const ta = h('textarea', { class: 'sk-json', spellcheck: 'false' });
    ta.value = JSON.stringify(p, null, 2);
    body.append(h('p', { class: 'sk-help' }, 'Fiche complète du produit. Pour les réglages non couverts par les onglets (rendu 3D, références, notes).'), ta,
      h('div', { class: 'sk-inline' },
        h('button', { class: 'button', onclick: () => { try { S.cur.product = JSON.parse(ta.value); markDirty(); toast('JSON appliqué : pensez à enregistrer.'); } catch (e) { toast(`JSON invalide : ${e.message}`, true); } } }, 'Appliquer le JSON'),
        h('button', { class: 'button', onclick: () => { const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(P(), null, 2)], { type: 'application/json' })), download: `${S.cur.id || 'produit'}.json` }); a.click(); } }, 'Télécharger le JSON')));
  }

  /* ---------- démarrage ---------- */
  loadList().then(viewList).catch((e) => { root.textContent = `Impossible de charger le configurateur : ${e.message}`; });
})();
