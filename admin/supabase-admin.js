/* Back-office SKLUBS sur Supabase : connexion (Supabase Auth) puis admin/app.js branché sur la base.
   Configuration : <meta name="sklubs-supabase"> et <meta name="sklubs-supabase-key"> (clé anon publique).
   Accès : comptes listés dans la table public.admins (voir supabase/README.md). */
(function () {
  'use strict';
  const meta = (n) => (document.querySelector(`meta[name="${n}"]`)?.content || '').trim().replace(/\/$/, '');
  const URL_ = meta('sklubs-supabase'), KEY = meta('sklubs-supabase-key');
  const mount = document.getElementById('sklubs-admin');
  const who = document.getElementById('sk-who');
  const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; };

  if (!URL_ || !KEY || !window.supabase) {
    mount.append(el('<div class="sk-login"><h1>Back-office SKLUBS</h1><p class="err">Supabase n\'est pas configuré : renseigner les balises sklubs-supabase et sklubs-supabase-key de admin.html.</p></div>'));
    return;
  }
  const sb = window.supabase.createClient(URL_, KEY);
  const fail = (error) => { if (error) throw new Error(error.message || String(error)); };
  const rpc = async (name, args) => { const { data, error } = await sb.rpc(name, args); fail(error); return data; };

  // routes de l'admin (mêmes chemins que l'API WordPress)
  async function api(path, opts = {}) {
    const method = (opts.method || 'GET').toUpperCase();
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (path === 'admin/products') return rpc('admin_products');
    if (path === 'admin/categories') {
      if (method === 'PUT') return rpc('save_categories', { p_categories: body });
      return (await rpc('catalog')).categories;
    }
    const m = /^admin\/products\/([a-z0-9-]+)$/.exec(path);
    if (m) {
      if (method === 'PUT') return rpc('save_product', { p_id: m[1], p_status: body.status, p_product: body.product });
      if (method === 'DELETE') { await rpc('delete_product', { p_id: m[1] }); return { ok: true }; }
      return rpc('admin_product', { p_id: m[1] });
    }
    throw new Error(`Route inconnue : ${path}`);
  }

  // images et modèles 3D : stockage public « catalog »
  function media(kind) {
    return new Promise((resolve, reject) => {
      const input = Object.assign(document.createElement('input'), { type: 'file', accept: kind === 'model' ? '.glb,.gltf,model/gltf-binary' : 'image/*' });
      input.onchange = async () => {
        const f = input.files[0];
        if (!f) return resolve(null);
        const path = `${kind === 'model' ? 'models' : 'images'}/${Date.now()}-${f.name.toLowerCase().replace(/[^a-z0-9.]+/g, '-')}`;
        const { error } = await sb.storage.from('catalog').upload(path, f, { contentType: f.type || (kind === 'model' ? 'model/gltf-binary' : undefined) });
        if (error) return reject(new Error(error.message));
        resolve(sb.storage.from('catalog').getPublicUrl(path).data.publicUrl);
      };
      input.click();
    });
  }

  const projects = {
    async list() {
      const { data, error } = await sb.from('projects').select('*').order('created_at', { ascending: false }).limit(300);
      fail(error); return data;
    },
    async setStatus(id, status) { const { error } = await sb.from('projects').update({ status }).eq('id', id); fail(error); },
    async fileUrl(path) { const { data, error } = await sb.storage.from('projects').createSignedUrl(path, 600); fail(error); return data.signedUrl; },
  };

  function start(user) {
    who.textContent = user.email;
    window.SKLUBS_ADMIN = { api, media, projects, configuratorUrl: './', pricingUrl: new URL('js/pricing.js', location.href).href, logout: async () => { await sb.auth.signOut(); location.reload(); } };
    fetch('admin/template.json').then((r) => (r.ok ? r.json() : null)).catch(() => null).then((tpl) => {
      window.SKLUBS_ADMIN.template = tpl;
      const s = document.createElement('script');
      s.src = 'admin/app.js';
      document.body.append(s);
    });
  }

  function login(msg = '') {
    mount.innerHTML = '';
    const f = el(`<form class="sk-login"><h1>Back-office SKLUBS</h1><p>Produits, prix, catégories et projets clients.</p>
      <input type="email" name="email" placeholder="E-mail" autocomplete="username" required>
      <input type="password" name="password" placeholder="Mot de passe" autocomplete="current-password" required>
      <button class="button button-primary" type="submit">Se connecter</button><p class="err">${msg}</p></form>`);
    f.onsubmit = async (e) => {
      e.preventDefault();
      const { data, error } = await sb.auth.signInWithPassword({ email: f.email.value, password: f.password.value });
      if (error) return login('Connexion refusée : vérifiez l\'e-mail et le mot de passe.');
      check(data.user);
    };
    mount.append(f);
  }

  async function check(user) {
    const isAdmin = await rpc('is_admin').catch(() => false);
    if (!isAdmin) { await sb.auth.signOut(); return login('Ce compte n\'a pas accès au back-office (table admins).'); }
    mount.innerHTML = '';
    start(user);
  }

  sb.auth.getSession().then(({ data }) => (data.session ? check(data.session.user) : login()));
})();
