// Tests : deno test --allow-read --allow-env --allow-net supabase/functions/submit/index_test.ts
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { handle, type Deps } from './index.ts';
import { computePrice } from '../_shared/pricing.js';

const base = JSON.parse(await Deno.readTextFile(new URL('../../../products/cricket-bottle/product.json', import.meta.url)));
const product = { ...base, status: 'publish' };
const priced = structuredClone(product);
Object.assign(priced.pricing, {
  tiers: { master: [{ min: 100, unit: 5.9 }, { min: 250, unit: 4.8 }, { min: 500, unit: 4.25 }] },
  materialSurcharge: { steel: 0 }, finishSurcharge: { matte: 0, gloss: 0, softtouch: 0.35, brushed: 0 },
  ringSurcharge: { polished: 0, black: 0.3 }, methodUnitPrice: { laser: 0.6, uv: 0.6, screen: 0.6, pad: 0.6, wrap360: 0.6 },
  setupFee: { laser: 45, uv: 45, screen: 45, pad: 45, wrap360: 45 },
});
priced.quantity.moq = 100;

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
function deps(p = product) {
  const rows: unknown[] = []; const uploads: string[] = [];
  const d: Deps & { rows: unknown[]; uploads: string[] } = {
    rows, uploads, allowedHosts: ['sklubs.fr', 'sklubs.com'], secret: 'chut',
    product: async (id) => (id === p.id ? p : null),
    insertProject: async (r) => { rows.push(r); },
    linkOrder: async (ref) => ref === 'PRJ-1',
    upload: async (path) => { uploads.push(path); return `https://signed/${path}`; },
  };
  return d;
}
const project = (o: Record<string, unknown> = {}) => ({
  intent: 'quote', product_id: 'cricket-bottle', size: 'master', materials: { material: 'steel', finish: 'matte' },
  colors: { body: '#FF6B00', cap: '#202023', handle: '#202023', ring: 'black' }, printing_method: 'laser', print_zones: ['front'],
  quantity: 500, artwork: { file: 'logo.png', data_url: PNG }, artwork_layers: [{ kind: 'image', data_url: PNG }, { kind: 'text', data_url: null }],
  preview_image: PNG, pricing: { unit: 0.01 }, ...o,
});
const post = (body: unknown, headers: Record<string, string> = { origin: 'https://bouteille.sklubs.fr' }, qs = '') =>
  new Request(`https://x.supabase.co/functions/v1/submit${qs}`, { method: 'POST', headers, body: JSON.stringify(body) });

Deno.test('CORS : domaine SKLUBS accepté, autre refusé', async () => {
  const ok = await handle(new Request('https://x/functions/v1/submit', { method: 'OPTIONS', headers: { origin: 'https://bouteille.sklubs.fr' } }), deps());
  assertEquals(ok.headers.get('access-control-allow-origin'), 'https://bouteille.sklubs.fr');
  const bad = await handle(post(project(), { origin: 'https://pirate.example' }), deps());
  assertEquals(bad.status, 403);
  const fake = await handle(post(project(), { origin: 'https://sklubs.fr.pirate.example' }), deps());
  assertEquals(fake.status, 403);
});

Deno.test('devis sans prix en base : enregistré, statut sur devis, images stockées', async () => {
  const d = deps();
  const r = await handle(post(project()), d);
  const j = await r.json();
  assertEquals(r.status, 200);
  assert(/^PRJ-\d{6}-[A-Z0-9]{5}$/.test(j.reference));
  assertEquals(j.price.status, 'factory');
  assertEquals(d.uploads.length, 3); // aperçu, visuel, logo 1 (le texte n'a pas d'image)
  const row = d.rows[0] as Record<string, any>;
  assertEquals(row.project.preview_image, undefined);
  assertEquals(row.project.artwork_layers[0].data_url, undefined);
  assertEquals(j.rows['Anneau métallique'], 'Métal noir');
});

Deno.test('commande refusée sans prix confirmé', async () => {
  const r = await handle(post(project({ intent: 'order' })), deps());
  assertEquals(r.status, 409);
});

Deno.test('commande : prix serveur identique au configurateur, prix navigateur ignoré', async () => {
  const r = await handle(post(project({ intent: 'order' })), deps(priced));
  const j = await r.json();
  assertEquals(r.status, 200);
  const front = computePrice(priced, { size: 'master', material: 'steel', finish: 'matte', method: 'laser', zone: 'front', colors: { ring: 'black' }, quantity: 500, hasArtwork: true, customColor: true });
  assertEquals(j.price.unit, front.unit);
  assertEquals(j.price.status, 'instant');
  assert(Math.abs(j.price.unit - (4.25 + 0.3 + 0.6 + 45 / 500)) < 1e-9);
});

Deno.test('configuration impossible refusée', async () => {
  assertEquals((await handle(post(project({ colors: { body: 'red', cap: '#000000', handle: '#000000', ring: 'black' } })), deps())).status, 400);
  assertEquals((await handle(post(project({ printing_method: 'sublimation' })), deps())).status, 400);
  assertEquals((await handle(post(project({ product_id: 'inconnu' })), deps())).status, 404);
  assertEquals((await handle(post(project({ preview_image: 'data:image/png;base64,PHN2Zz4=' })), deps())).status, 200); // faux PNG ignoré
});

Deno.test('lien commande : secret obligatoire', async () => {
  assertEquals((await handle(post({ reference: 'PRJ-1', order_id: 9 }, { origin: 'https://sklubs.fr' }, '?action=link-order'), deps())).status, 403);
  assertEquals((await handle(post({ reference: 'PRJ-1', order_id: 9 }, { 'x-sklubs-secret': 'chut' }, '?action=link-order'), deps())).status, 200);
});
