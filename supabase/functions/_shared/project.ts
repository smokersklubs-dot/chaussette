// Vérification d'un projet envoyé par le configurateur et prix serveur (le prix du navigateur n'est jamais utilisé).
import { computePrice } from './pricing.js';

// deno-lint-ignore no-explicit-any
type Json = any;

export class InputError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

const ids = (list: Json[] | undefined) => (list || []).map((x) => String(x?.id ?? ''));

export function configFromProject(product: Json, p: Json) {
  const size = String(p.size ?? product.defaultSize ?? '');
  if (!ids(product.sizes).includes(size)) throw new InputError('Variante inconnue.');
  const mat = String(p.materials?.material ?? '');
  const material = (product.materials || []).find((m: Json) => m.id === mat);
  if (!material) throw new InputError('Matière inconnue.');
  const finish = String(p.materials?.finish ?? '');
  if (!(material.finishes || []).includes(finish)) throw new InputError('Finition non disponible pour cette matière.');
  const hasArtwork = !!p.artwork || (Array.isArray(p.artwork_layers) && p.artwork_layers.length > 0);
  const method = hasArtwork ? String(p.printing_method ?? '') : null;
  const zone = hasArtwork ? String((p.print_zones || [])[0] ?? '') : null;
  if (hasArtwork) {
    if (!(product.rules?.methodsByMaterial?.[mat] || []).includes(method)) throw new InputError('Technique non compatible avec la matière.');
    if (!(product.rules?.zonesByMethod?.[method!] || []).includes(zone)) throw new InputError('Zone non compatible avec la technique.');
  }
  const colors: Record<string, string> = {};
  for (const part of ['body', 'cap', 'handle']) {
    const hex = String(p.colors?.[part] ?? '').toUpperCase();
    if (!/^#[0-9A-F]{6}$/.test(hex)) throw new InputError('Couleur invalide.');
    colors[part] = hex;
  }
  const ring = String(p.colors?.ring ?? '');
  if (!ids(product.ringFinishes).includes(ring)) throw new InputError('Finition de bague inconnue.');
  colors.ring = ring;
  const catalog = (product.colors?.catalog || []).map((c: Json) => String(c.hex).toUpperCase());
  const colorable = product.finishes?.[finish]?.colorable !== false;
  const customColor = ['body', 'cap', 'handle'].some((k) => (k !== 'body' || colorable) && !catalog.includes(colors[k]));
  const quantity = Math.max(1, Math.min(1_000_000, Math.round(Number(p.quantity) || 0)));
  return { size, material: mat, finish, method, zone, colors, customColor, hasArtwork, quantity, layers: (p.artwork_layers || []).length };
}

export function serverPrice(product: Json, cfg: Json) {
  const r = computePrice(product, cfg);
  return { status: r.status, unit: r.unit, total: r.total, quantity: r.quantity, moq: r.moq, reasons: r.reasons,
    currency: r.currency, taxLabel: product.pricing?.taxLabel || '', leadTime: r.leadTime };
}

const label = (list: Json[] | undefined, id: string | null) => (list || []).find((x) => x.id === id)?.label ?? id ?? '';
function colorName(product: Json, hex: string) {
  const c = (product.colors?.catalog || []).find((x: Json) => String(x.hex).toUpperCase() === hex);
  return c ? `${c.label} (${hex})` : `${hex} (personnalisée)`;
}

// Lignes lisibles (panier, commande, e-mail)
export function summaryRows(product: Json, cfg: Json): Record<string, string> {
  const fin = product.finishes?.[cfg.finish] || {};
  const rows: Record<string, string> = {};
  if ((product.sizes || []).length > 1) rows['Variante'] = label(product.sizes, cfg.size);
  rows['Matière'] = label(product.materials, cfg.material);
  rows['Finition'] = fin.label ?? cfg.finish;
  rows['Couleur corps'] = fin.colorable === false ? 'Métal naturel' : colorName(product, cfg.colors.body);
  rows['Couleur bouchon'] = colorName(product, cfg.colors.cap);
  rows['Couleur anse'] = colorName(product, cfg.colors.handle);
  rows['Anneau métallique'] = label(product.ringFinishes, cfg.colors.ring);
  rows['Marquage'] = cfg.hasArtwork
    ? `${label(product.printingMethods, cfg.method)} · ${label(product.printZones, cfg.zone)} · ${cfg.layers} élément(s)`
    : 'Sans marquage';
  return rows;
}

// Image data:URL PNG / JPEG vérifiée (signature du fichier)
export function decodeImage(dataUrl: unknown): { bytes: Uint8Array; ext: string; type: string } | null {
  if (typeof dataUrl !== 'string') return null;
  const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return null;
  let bin: string;
  try { bin = atob(m[2]); } catch { return null; }
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const jpg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!png && !jpg) return null;
  return { bytes, ext: png ? 'png' : 'jpg', type: png ? 'image/png' : 'image/jpeg' };
}
