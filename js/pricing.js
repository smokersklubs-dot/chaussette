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

export function computePrice(product, cfg) {
  const p = product.pricing || {};
  const qty = Math.max(1, Math.round(cfg.quantity || 0));
  const reasons = [];
  const need = (label, v) => { if (!isDefined(v)) { if (!reasons.includes(label)) reasons.push(label); return 0; } return Number(v); };

  // suppléments par unité (indépendants de la quantité)
  const mat = need('supplément matière', p.materialSurcharge?.[cfg.material]);
  const fin = need('supplément finition', p.finishSurcharge?.[cfg.finish]);
  const ring = p.ringSurcharge ? need('supplément bague', p.ringSurcharge[cfg.colors?.ring]) : 0;
  const custom = cfg.customColor && p.customColorSurcharge !== undefined ? need('supplément couleur personnalisée', p.customColorSurcharge) : 0;
  let method = 0;
  let setup = 0;
  if (cfg.hasArtwork) {
    method = need('prix marquage', p.methodUnitPrice?.[cfg.method]);
    setup = need('frais de calage', p.setupFee?.[cfg.method]);
  }
  const addons = mat + fin + ring + custom + method;

  // base selon les paliers
  const tiers = tiersFor(product, cfg.size);
  let base = 0;
  let tier = null;
  let belowMin = false;
  if (tiers && tiers.length) {
    tier = [...tiers].reverse().find((t) => qty >= t.min) || null;
    if (!tier) belowMin = true;
    else base = need('prix du palier', tier.unit);
  } else {
    base = need('prix de base', p.basePriceBySize?.[cfg.size]);
  }

  const moqRaw = product.quantity?.moq;
  const moq = isDefined(moqRaw) ? Number(moqRaw) : tiers?.length ? tiers[0].min : null;
  if (moq === null) reasons.push('MOQ');
  const belowMoq = moq !== null && qty < moq;

  let discount = 0;
  if (Array.isArray(p.quantityDiscounts)) for (const t of p.quantityDiscounts) if (qty >= t.min) discount = t.discount;

  const unitAt = (q, b) => (b + addons) * (1 - discount) + setup / q;
  const unit = unitAt(qty, base);
  const known = !reasons.length && !belowMoq && !belowMin;
  const status = known ? (p.priceMode === 'estimated' ? 'estimated' : 'instant') : 'factory';

  // tableau des paliers (même configuration) pour l'affichage
  let table = null;
  if (tiers && tiers.length && !reasons.length) {
    table = tiers.map((t) => ({ min: t.min, unit: isDefined(t.unit) ? (t.unit + addons) * (1 - discount) + setup / t.min : null }));
    const first = table[0]?.unit;
    table.forEach((r) => { r.saving = first && r.unit !== null ? Math.max(0, 1 - r.unit / first) : 0; r.active = tier && r.min === tier.min; });
  }
  const firstUnit = table?.[0]?.unit;
  return {
    status,
    reasons,
    belowMoq: belowMoq || belowMin,
    moq,
    quantity: qty,
    unit: known ? unit : null,
    total: known ? unit * qty : null,
    saving: known && firstUnit ? Math.max(0, 1 - unit / firstUnit) : 0,
    setup: cfg.hasArtwork ? setup : 0,
    tiers: table,
    leadTime: product.production?.leadTime || null,
    discount,
    currency: p.currency || 'EUR',
  };
}
