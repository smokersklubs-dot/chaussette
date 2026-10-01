// COPIE de js/pricing.js (même calcul que le configurateur). Ne pas modifier ici : lancer tools/supabase_sync.py.
// Moteur de règles + prix, piloté uniquement par product.json.
// Aucune valeur n'est inventée : tant qu'un champ vaut null / "TO_DEFINE",
// le statut renvoyé est « factory » (validation usine requise).

const isDefined = (v) => v !== null && v !== undefined && v !== 'TO_DEFINE' && !Number.isNaN(v);

export function allowedMethods(product, materialId) {
  const ids = product.rules?.methodsByMaterial?.[materialId] || [];
  return product.printingMethods.filter((m) => ids.includes(m.id));
}

export function allowedZones(product, methodId) {
  const ids = product.rules?.zonesByMethod?.[methodId] || [];
  return product.printZones.filter((z) => ids.includes(z.id));
}

export function allowedFinishes(product, materialId) {
  const mat = product.materials.find((m) => m.id === materialId);
  return (mat?.finishes || []).map((id) => ({ id, ...product.finishes[id] }));
}

// Corrige une configuration pour qu'elle reste toujours faisable.
export function sanitize(product, cfg) {
  const finishes = allowedFinishes(product, cfg.material).map((f) => f.id);
  if (!finishes.includes(cfg.finish)) {
    cfg.finish = product.materials.find((m) => m.id === cfg.material)?.defaultFinish || finishes[0];
  }
  const methods = allowedMethods(product, cfg.material).map((m) => m.id);
  if (cfg.method && !methods.includes(cfg.method)) cfg.method = methods[0] || null;
  const zones = allowedZones(product, cfg.method).map((z) => z.id);
  if (!zones.includes(cfg.zone)) cfg.zone = zones[0] || null;
  return cfg;
}

// Prix : paliers de quantité par variante (pricing.tiers[sizeId] = [{ min, unit }]) + suppléments par unité
// + frais de calage répartis. Une valeur vide (null / "TO_DEFINE") = inconnue -> « validation usine ».
// 0 = gratuit. Ancien format accepté : pricing.basePriceBySize[sizeId].
export function tiersFor(product, sizeId) {
  const t = product.pricing?.tiers?.[sizeId];
  if (!Array.isArray(t)) return null;
  return t.filter((x) => isDefined(x?.min)).map((x) => ({ min: Number(x.min), unit: isDefined(x.unit) ? Number(x.unit) : null }))
    .sort((a, b) => a.min - b.min);
}

// Nombre de couleurs du marquage : techniques « au nombre de couleurs » (sérigraphie, tampographie)
export function printColorRange(product, methodId) {
  const m = (product.printingMethods || []).find((x) => x.id === methodId);
  if (!m?.perColor) return null;
  return { min: 1, max: typeof m.maxColors === 'number' && m.maxColors > 0 ? m.maxColors : 6 };
}

// Prix du marquage par quantité : pricing.methodTiers[methodId] = [{ min, unit }] (sinon prix unique methodUnitPrice)
export function methodTiersFor(product, methodId) {
  const t = product.pricing?.methodTiers?.[methodId];
  if (!Array.isArray(t)) return null;
  const rows = t.filter((x) => isDefined(x?.min)).map((x) => ({ min: Number(x.min), unit: isDefined(x.unit) ? Number(x.unit) : null })).sort((a, b) => a.min - b.min);
  return rows.length ? rows : null;
}

const tierAt = (rows, qty) => [...rows].reverse().find((t) => qty >= t.min) || null;

// Règles de prix (toutes les valeurs viennent de la fiche produit ; vide = « sur devis ») :
//   prix unitaire = produit nu (palier de quantité de la variante)
//                 + options (matière, finition, bague, couleur personnalisée)
//                 + marquage (palier de quantité de la technique, + couleurs supplémentaires si « au nombre de couleurs »)
//                 + frais de calage ÷ quantité (par couleur pour les techniques au nombre de couleurs)
//   minimum de commande = le plus grand de : MOQ produit (sinon 1er palier), MOQ de la technique, 1er palier de la technique
export function computePrice(product, cfg) {
  const p = product.pricing || {};
  const qty = Math.max(1, Math.round(cfg.quantity || 0));
  const reasons = [];
  const need = (label, v) => { if (!isDefined(v)) { if (!reasons.includes(label)) reasons.push(label); return 0; } return Number(v); };

  const tiers = tiersFor(product, cfg.size);
  const mTiers = cfg.hasArtwork ? methodTiersFor(product, cfg.method) : null;
  const range = cfg.hasArtwork ? printColorRange(product, cfg.method) : null;
  const colors = range ? Math.min(range.max, Math.max(1, Math.round(cfg.printColors || 1))) : 1;
  const methodLabel = (product.printingMethods || []).find((m) => m.id === cfg.method)?.label || 'Marquage';

  // détail du prix pour une quantité donnée (q) : lignes par unité + frais fixes
  const detail = (q, collect) => {
    const n = collect ? need : (l, v) => (isDefined(v) ? Number(v) : 0);
    const lines = [];
    let base = 0;
    let tier = null;
    if (tiers && tiers.length) {
      tier = tierAt(tiers, q);
      base = tier ? n('prix du palier', tier.unit) : 0;
    } else base = n('prix de base', p.basePriceBySize?.[cfg.size]);
    lines.push({ key: 'base', label: tier ? `Produit (dès ${tier.min} pcs)` : 'Produit', unit: base });
    const add = (key, label, v) => { const x = n(label, v); if (x) lines.push({ key, label: label.replace(/^supplément /, '').replace(/^./, (c) => c.toUpperCase()), unit: x }); };
    add('material', 'supplément matière', p.materialSurcharge?.[cfg.material]);
    add('finish', 'supplément finition', p.finishSurcharge?.[cfg.finish]);
    if (p.ringSurcharge) add('ring', 'supplément bague', p.ringSurcharge[cfg.colors?.ring]);
    if (cfg.customColor && p.customColorSurcharge !== undefined) add('custom', 'supplément couleur personnalisée', p.customColorSurcharge);
    let setup = 0;
    if (cfg.hasArtwork) {
      let mu;
      if (mTiers) { const t = tierAt(mTiers, q); mu = n('prix marquage', t ? t.unit : null); }
      else mu = n('prix marquage', p.methodUnitPrice?.[cfg.method]);
      lines.push({ key: 'method', label: `Marquage ${methodLabel}${range ? ` (1 couleur)` : ''}`, unit: mu });
      if (range && colors > 1) lines.push({ key: 'colors', label: `Couleurs supplémentaires (${colors - 1})`, unit: (colors - 1) * n('prix par couleur supplémentaire', p.colorUnitPrice?.[cfg.method]) });
      setup = n('frais de calage', p.setupFee?.[cfg.method]) * (range ? colors : 1);
      if (setup) lines.push({ key: 'setup', label: `Frais de calage${range && colors > 1 ? ` (${colors} couleurs)` : ''}`, unit: setup / q, total: setup });
    }
    let discount = 0;
    if (Array.isArray(p.quantityDiscounts)) for (const t of p.quantityDiscounts) if (q >= t.min) discount = t.discount;
    const perUnit = lines.filter((l) => l.key !== 'setup').reduce((s, l) => s + l.unit, 0);
    const unit = perUnit * (1 - discount) + setup / q;
    return { lines, unit, setup, tier, discount, belowFirstTier: !!(tiers && tiers.length && !tier) };
  };

  const d = detail(qty, true);
  const moqs = [];
  const moqRaw = product.quantity?.moq;
  if (isDefined(moqRaw)) moqs.push(Number(moqRaw)); else if (tiers?.length) moqs.push(tiers[0].min);
  if (cfg.hasArtwork) {
    if (isDefined(p.methodMoq?.[cfg.method])) moqs.push(Number(p.methodMoq[cfg.method]));
    if (mTiers) moqs.push(mTiers[0].min);
  }
  const moq = moqs.length ? Math.max(...moqs) : null;
  if (moq === null) reasons.push('MOQ');
  const belowMoq = (moq !== null && qty < moq) || d.belowFirstTier;
  const known = !reasons.length && !belowMoq;
  const status = known ? (p.priceMode === 'estimated' ? 'estimated' : 'instant') : 'factory';

  // tableau des paliers (même configuration) : chaque palier recalculé avec ses propres prix de marquage
  let table = null;
  if (tiers && tiers.length && !reasons.length) {
    table = tiers.filter((t) => moq === null || t.min >= moq || t === tiers[0]).map((t) => ({ min: Math.max(t.min, moq || 0), unit: isDefined(t.unit) ? detail(Math.max(t.min, moq || 0), false).unit : null }));
    table = table.filter((r, i) => table.findIndex((o) => o.min === r.min) === i);
    const first = table[0]?.unit;
    table.forEach((r) => { r.saving = first && r.unit !== null ? Math.max(0, 1 - r.unit / first) : 0; r.active = !!(d.tier && r.min <= qty && !table.some((o) => o.min > r.min && o.min <= qty)); });
  }
  const firstUnit = table?.[0]?.unit;
  return {
    status,
    reasons,
    belowMoq,
    moq,
    quantity: qty,
    unit: known ? d.unit : null,
    total: known ? d.unit * qty : null,
    saving: known && firstUnit ? Math.max(0, 1 - d.unit / firstUnit) : 0,
    setup: cfg.hasArtwork ? d.setup : 0,
    lines: known ? d.lines : null,
    printColors: range ? colors : null,
    tiers: table,
    leadTime: product.production?.leadTime || null,
    discount: d.discount,
    currency: p.currency || 'EUR',
  };
}
