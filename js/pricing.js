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

export function computePrice(product, cfg) {
  const p = product.pricing || {};
  const qty = Math.max(1, Math.round(cfg.quantity || 0));
  const reasons = [];
  const need = (label, v) => { if (!isDefined(v)) reasons.push(label); return isDefined(v) ? Number(v) : 0; };

  const base = need('prix de base', p.basePriceBySize?.[cfg.size]);
  const mat = need('supplément matière', p.materialSurcharge?.[cfg.material]);
  const fin = need('supplément finition', p.finishSurcharge?.[cfg.finish]);
  let method = 0;
  let setup = 0;
  if (cfg.hasArtwork) {
    method = need('prix marquage', p.methodUnitPrice?.[cfg.method]);
    setup = need('frais de calage', p.setupFee?.[cfg.method]);
  }

  const moq = product.quantity?.moq;
  const belowMoq = isDefined(moq) && qty < Number(moq);
  if (!isDefined(moq)) reasons.push('MOQ');

  let discount = 0;
  if (Array.isArray(p.quantityDiscounts)) {
    for (const t of p.quantityDiscounts) if (qty >= t.min) discount = t.discount;
  }

  const unit = (base + mat + fin + method) * (1 - discount) + setup / qty;
  const status = reasons.length ? 'factory' : belowMoq ? 'factory' : p.priceMode === 'estimated' ? 'estimated' : 'instant';

  return {
    status,
    reasons,
    belowMoq,
    quantity: qty,
    unit: status === 'factory' ? null : unit,
    total: status === 'factory' ? null : unit * qty,
    discount,
    currency: p.currency || 'EUR',
  };
}
