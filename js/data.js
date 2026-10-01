// Sources des données (dans cet ordre) :
//   1. Supabase (base de données principale : produits, prix, catégories, projets)
//        <meta name="sklubs-supabase" content="https://xxxx.supabase.co">
//        <meta name="sklubs-supabase-key" content="clé anon publique">
//   2. API WordPress (extension « SKLUBS Configurateur ») : <meta name="sklubs-api" content="https://sklubs.fr/wp-json/sklubs/v1">
//      Toujours utilisée pour le panier WooCommerce (« Commander »).
//   3. Fichiers JSON du dépôt (products/) : repli automatique si une source ne répond pas.
const meta = (n) => (document.querySelector(`meta[name="${n}"]`)?.content || '').trim().replace(/\/$/, '');
export const API = meta('sklubs-api');
export const SHOP = meta('sklubs-shop'); // boutique WooCommerce (formulaire « Commander » vers son panier)
export const SUPABASE = { url: meta('sklubs-supabase'), key: meta('sklubs-supabase-key') };
const HAS_SUPABASE = !!(SUPABASE.url && SUPABASE.key);
export const supabaseHeaders = () => ({ apikey: SUPABASE.key, Authorization: `Bearer ${SUPABASE.key}`, 'Content-Type': 'application/json' });
export const SUBMIT_URL = HAS_SUPABASE ? `${SUPABASE.url}/functions/v1/submit` : '';

async function getJson(url) {
  // page d'aperçu autonome : données intégrées dans la page (voir tools/build_preview.py)
  const inline = window.SKLUBS_INLINE?.[url];
  if (inline) return JSON.parse(inline);
  const r = await fetch(url, { credentials: 'omit' });
  if (!r.ok) throw new Error(`${url} : ${r.status}`);
  return r.json();
}

async function rpc(name, args = {}) {
  const r = await fetch(`${SUPABASE.url}/rest/v1/rpc/${name}`, { method: 'POST', headers: supabaseHeaders(), body: JSON.stringify(args), credentials: 'omit' });
  if (!r.ok) throw new Error(`Supabase ${name} : ${r.status}`);
  const data = await r.json();
  if (data === null) throw new Error(`Supabase ${name} : introuvable`);
  return data;
}

async function firstOf(sources) {
  let last;
  for (const [label, fn] of sources) {
    try { return await fn(); } catch (e) { last = e; console.warn(`${label} indisponible, source suivante`, e); }
  }
  throw last;
}

export function loadCatalog() {
  return firstOf([
    ...(HAS_SUPABASE ? [['Supabase', () => rpc('catalog')]] : []),
    ...(API ? [['API WordPress', () => getJson(`${API}/catalog`)]] : []),
    ['Fichiers', () => getJson('products/catalog.json')],
  ]);
}

export function loadProduct(id) {
  const safe = String(id).replace(/[^a-z0-9-]/gi, '');
  return firstOf([
    ...(HAS_SUPABASE ? [['Supabase', () => rpc('product', { p_id: safe })]] : []),
    ...(API ? [['API WordPress', () => getJson(`${API}/products/${safe}`)]] : []),
    ['Fichiers', () => getJson(`products/${safe}/product.json`)],
  ]);
}

// Site SKLUBS qui intègre le configurateur (iframe). Mémorisé pour la session : après un passage
// accueil -> configurateur dans l'iframe, le referrer n'est plus la page du site.
export const PARENT_ORIGINS = ['https://sklubs.fr', 'https://www.sklubs.fr', 'https://sklubs.com', 'https://www.sklubs.com'];
export function detectParentOrigin() {
  if (window.parent === window) return null;
  // la page parente peut aussi être sur le même domaine (configurateur servi par l'extension WordPress)
  const allowed = [...PARENT_ORIGINS, location.origin];
  const candidates = [location.ancestorOrigins?.[0], (() => { try { return document.referrer ? new URL(document.referrer).origin : null; } catch { return null; } })()];
  for (const o of candidates) {
    if (allowed.includes(o)) { try { sessionStorage.setItem('sklubs-parent', o); } catch { /* stockage bloqué */ } return o; }
  }
  try { const o = sessionStorage.getItem('sklubs-parent'); return allowed.includes(o) ? o : null; } catch { return null; }
}
