// Source des données produits : API WordPress (extension « SKLUBS Configurateur ») si elle est déclarée,
// sinon les fichiers JSON du dépôt. En cas d'erreur de l'API, repli automatique sur les fichiers.
// Déclarer l'API : <meta name="sklubs-api" content="https://sklubs.fr/wp-json/sklubs/v1"> dans la page.
const API = (document.querySelector('meta[name="sklubs-api"]')?.content || '').trim().replace(/\/$/, '');

async function getJson(url) {
  // page d'aperçu autonome : données intégrées dans la page (voir tools/build_preview.py)
  const inline = window.SKLUBS_INLINE?.[url];
  if (inline) return JSON.parse(inline);
  const r = await fetch(url, { credentials: 'omit' });
  if (!r.ok) throw new Error(`${url} : ${r.status}`);
  return r.json();
}

export async function loadCatalog() {
  if (API) {
    try { return await getJson(`${API}/catalog`); } catch (e) { console.warn('API catalogue indisponible, repli sur les fichiers', e); }
  }
  return getJson('products/catalog.json');
}

export async function loadProduct(id) {
  const safe = String(id).replace(/[^a-z0-9-]/gi, '');
  if (API) {
    try { return await getJson(`${API}/products/${safe}`); } catch (e) { console.warn('API produit indisponible, repli sur les fichiers', e); }
  }
  return getJson(`products/${safe}/product.json`);
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
