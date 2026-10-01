// Fonction Edge « submit » : reçoit les projets du configurateur (devis, commande, projet enregistré).
//   POST /functions/v1/submit                 projet JSON -> { reference, price, rows, preview_url }
//   POST /functions/v1/submit?action=link-order   { reference, order_id } (WordPress, secret partagé)
// Autorisé depuis les domaines SKLUBS (CORS) ou par le site WordPress (en-tête x-sklubs-secret).
// Le prix est recalculé ici à partir de la base : celui du navigateur n'est gardé qu'à titre indicatif.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { configFromProject, decodeImage, InputError, serverPrice, summaryRows } from '../_shared/project.ts';

// deno-lint-ignore no-explicit-any
type Json = any;
const MAX_BYTES = 12 * 1024 * 1024;
const INTENTS = ['quote', 'order', 'save'];

export interface Deps {
  product(id: string): Promise<Json | null>;
  insertProject(row: Json): Promise<void>;
  linkOrder(reference: string, orderId: number): Promise<boolean>;
  upload(path: string, bytes: Uint8Array, type: string): Promise<string | null>; // renvoie une URL signée
  notify?(payload: Json): Promise<void>;
  secret?: string;
  allowedHosts: string[];
}

export function originAllowed(origin: string | null, hosts: string[]): boolean {
  if (!origin) return false;
  let u: URL;
  try { u = new URL(origin); } catch { return false; }
  if (u.protocol !== 'https:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') return false;
  return hosts.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
}

function cors(origin: string | null, hosts: string[]): Record<string, string> {
  const h: Record<string, string> = { 'Vary': 'Origin' };
  if (originAllowed(origin, hosts)) {
    h['Access-Control-Allow-Origin'] = origin!;
    h['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    h['Access-Control-Allow-Headers'] = 'authorization, apikey, content-type, x-client-info';
    h['Access-Control-Max-Age'] = '86400';
  }
  return h;
}

const reference = () => {
  const d = new Date();
  const ymd = `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const rnd = crypto.getRandomValues(new Uint8Array(5));
  return `PRJ-${ymd}-${Array.from(rnd, (n) => abc[n % abc.length]).join('')}`;
};

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const origin = req.headers.get('origin');
  const headers = { ...cors(origin, deps.allowedHosts), 'Content-Type': 'application/json' };
  const reply = (status: number, body: Json) => new Response(JSON.stringify(body), { status, headers });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return reply(405, { message: 'Méthode non autorisée.' });

  const fromSite = !!deps.secret && req.headers.get('x-sklubs-secret') === deps.secret;
  if (!fromSite && !originAllowed(origin, deps.allowedHosts)) return reply(403, { message: 'Origine non autorisée.' });

  const raw = await req.text();
  if (raw.length > MAX_BYTES) return reply(413, { message: 'Projet trop volumineux.' });
  let p: Json;
  try { p = JSON.parse(raw); } catch { return reply(400, { message: 'Projet invalide.' }); }

  const action = new URL(req.url).searchParams.get('action');
  if (action === 'link-order') {
    if (!fromSite) return reply(403, { message: 'Réservé au site.' });
    const ok = await deps.linkOrder(String(p.reference || ''), Number(p.order_id) || 0);
    return reply(ok ? 200 : 404, { ok });
  }

  if (!p || typeof p !== 'object' || !/^[a-z0-9-]{2,60}$/.test(String(p.product_id || ''))) return reply(400, { message: 'Projet invalide.' });
  const product = await deps.product(p.product_id);
  if (!product || product.status !== 'publish') return reply(404, { message: 'Produit introuvable.' });

  let cfg: Json;
  try { cfg = configFromProject(product, p); } catch (e) {
    return reply(e instanceof InputError ? e.status : 400, { message: (e as Error).message });
  }
  const intent = INTENTS.includes(p.intent) ? p.intent : 'quote';
  const price = serverPrice(product, cfg);
  // une commande n'est acceptée qu'avec un prix confirmé (sinon : devis)
  if (intent === 'order' && price.status !== 'instant') {
    return reply(409, { message: 'Cette configuration doit être chiffrée par SKLUBS : demandez un devis.', reasons: price.reasons });
  }

  const ref = reference();
  const files: Record<string, string> = {};
  const urls: Record<string, string> = {};
  const put = async (name: string, data: unknown) => {
    const img = decodeImage(data);
    if (!img) return;
    const path = `${ref}/${name}.${img.ext}`;
    const url = await deps.upload(path, img.bytes, img.type);
    files[name] = path;
    if (url) urls[name] = url;
  };
  await put('apercu', p.preview_image);
  await put('visuel', p.artwork?.data_url);
  const layers = Array.isArray(p.artwork_layers) ? p.artwork_layers.slice(0, 6) : [];
  for (let i = 0; i < layers.length; i++) await put(`logo-${i + 1}`, layers[i]?.data_url);

  // projet sans les images (elles sont dans le stockage)
  const clean = { ...p, intent, preview_image: undefined, artwork: p.artwork ? { ...p.artwork, data_url: undefined } : null,
    artwork_layers: layers.map((l: Json) => ({ ...l, data_url: undefined })) };
  await deps.insertProject({ reference: ref, intent, product_id: product.id, quantity: cfg.quantity, price_server: price, project: clean, files });

  const rows = summaryRows(product, cfg);
  await deps.notify?.({ reference: ref, intent, product: product.name, quantity: cfg.quantity, price, rows, files: urls }).catch(() => {});
  return reply(200, { ok: true, reference: ref, intent, price, rows, product: { id: product.id, name: product.name }, preview_url: urls.apercu || null });
}

// ---------------------------------------------------------------- exécution sur Supabase
if (import.meta.main) {
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const webhook = Deno.env.get('SKLUBS_NOTIFY_WEBHOOK');
  const deps: Deps = {
    allowedHosts: (Deno.env.get('SKLUBS_ALLOWED_HOSTS') || 'sklubs.fr,sklubs.com').split(',').map((s) => s.trim()).filter(Boolean),
    secret: Deno.env.get('SKLUBS_SHARED_SECRET') || undefined,
    async product(id) {
      const { data, error } = await db.rpc('product', { p_id: id });
      if (error) throw error;
      return data;
    },
    async insertProject(row) {
      const { error } = await db.from('projects').insert(row);
      if (error) throw error;
    },
    async linkOrder(reference, orderId) {
      const { data, error } = await db.from('projects').update({ wc_order_id: orderId, status: 'ordered' }).eq('reference', reference).select('id');
      if (error) throw error;
      return (data || []).length > 0;
    },
    async upload(path, bytes, type) {
      const { error } = await db.storage.from('projects').upload(path, bytes, { contentType: type, upsert: false });
      if (error) return null;
      const { data } = await db.storage.from('projects').createSignedUrl(path, 60 * 60 * 24 * 365);
      return data?.signedUrl || null;
    },
    notify: webhook ? async (payload) => { await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); } : undefined,
  };
  Deno.serve(async (req) => {
    try { return await handle(req, deps); } catch (e) {
      console.error(e);
      return new Response(JSON.stringify({ message: 'Erreur serveur. Réessayez ou contactez SKLUBS.' }), { status: 500, headers: { ...cors(req.headers.get('origin'), deps.allowedHosts), 'Content-Type': 'application/json' } });
    }
  });
}
