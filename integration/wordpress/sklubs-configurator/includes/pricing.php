<?php
/**
 * Prix côté serveur : même calcul que js/pricing.js (le prix envoyé par le navigateur n'est jamais utilisé).
 * Une valeur vide (null / "TO_DEFINE") = inconnue -> statut « factory » (sur devis).
 */
if (!defined('ABSPATH')) exit;

function sklubs_cfg_defined($v) {
    return $v !== null && $v !== '' && $v !== 'TO_DEFINE' && is_numeric($v);
}

function sklubs_cfg_ids($list) {
    return array_map(fn($x) => (string) ($x['id'] ?? ''), (array) $list);
}

// Configuration vérifiée à partir du projet envoyé par le configurateur
function sklubs_cfg_config_from_project(array $product, array $p) {
    $bad = fn($m) => new WP_Error('invalid_config', $m, ['status' => 400]);
    $size = (string) ($p['size'] ?? ($product['defaultSize'] ?? ''));
    if (!in_array($size, sklubs_cfg_ids($product['sizes'] ?? []), true)) return $bad('Variante inconnue.');
    $mat = (string) ($p['materials']['material'] ?? '');
    $material = null;
    foreach ((array) ($product['materials'] ?? []) as $m) if (($m['id'] ?? '') === $mat) $material = $m;
    if (!$material) return $bad('Matière inconnue.');
    $finish = (string) ($p['materials']['finish'] ?? '');
    if (!in_array($finish, (array) ($material['finishes'] ?? []), true)) return $bad('Finition non disponible pour cette matière.');
    $has_art = !empty($p['artwork']) || !empty($p['artwork_layers']);
    $method = $has_art ? (string) ($p['printing_method'] ?? '') : null;
    $zone = $has_art ? (string) (($p['print_zones'] ?? [])[0] ?? '') : null;
    if ($has_art) {
        if (!in_array($method, (array) ($product['rules']['methodsByMaterial'][$mat] ?? []), true)) return $bad('Technique non compatible avec la matière.');
        if (!in_array($zone, (array) ($product['rules']['zonesByMethod'][$method] ?? []), true)) return $bad('Zone non compatible avec la technique.');
    }
    $colors = [];
    foreach (['body', 'cap', 'handle'] as $part) {
        $hex = strtoupper((string) ($p['colors'][$part] ?? ''));
        if (!preg_match('/^#[0-9A-F]{6}$/', $hex)) return $bad('Couleur invalide.');
        $colors[$part] = $hex;
    }
    $ring = (string) ($p['colors']['ring'] ?? '');
    if (!in_array($ring, sklubs_cfg_ids($product['ringFinishes'] ?? []), true)) return $bad('Finition de bague inconnue.');
    $colors['ring'] = $ring;
    $catalog = array_map(fn($c) => strtoupper((string) ($c['hex'] ?? '')), (array) ($product['colors']['catalog'] ?? []));
    $colorable = ($product['finishes'][$finish]['colorable'] ?? true) !== false;
    $custom = false;
    foreach (['body', 'cap', 'handle'] as $part) {
        if ($part === 'body' && !$colorable) continue;
        if (!in_array($colors[$part], $catalog, true)) $custom = true;
    }
    $print_colors = 1;
    if ($has_art) {
        foreach ((array) ($product['printingMethods'] ?? []) as $m) {
            if (($m['id'] ?? '') === $method && !empty($m['perColor'])) {
                $max = (isset($m['maxColors']) && is_numeric($m['maxColors']) && $m['maxColors'] > 0) ? (int) $m['maxColors'] : 6;
                $print_colors = max(1, min($max, (int) ($p['print_colors'] ?? 1)));
            }
        }
    }
    return [
        'size' => $size, 'material' => $mat, 'finish' => $finish, 'method' => $method, 'zone' => $zone,
        'colors' => $colors, 'customColor' => $custom, 'hasArtwork' => $has_art, 'printColors' => $print_colors,
        'quantity' => max(1, min(1000000, (int) ($p['quantity'] ?? 0))),
        'layers' => count((array) ($p['artwork_layers'] ?? [])),
    ];
}

// Même règles que js/pricing.js : produit nu (palier) + options + marquage (palier de la technique,
// couleurs supplémentaires) + frais de calage ÷ quantité (par couleur si « au nombre de couleurs »).
function sklubs_cfg_tiers($rows) {
    $out = [];
    foreach ((array) $rows as $t) {
        if (is_array($t) && sklubs_cfg_defined($t['min'] ?? null)) $out[] = ['min' => (float) $t['min'], 'unit' => sklubs_cfg_defined($t['unit'] ?? null) ? (float) $t['unit'] : null];
    }
    usort($out, fn($a, $b) => $a['min'] <=> $b['min']);
    return $out;
}
function sklubs_cfg_tier_at(array $rows, $qty) {
    $tier = null;
    foreach ($rows as $t) if ($qty >= $t['min']) $tier = $t;
    return $tier;
}

function sklubs_cfg_compute_price(array $product, array $cfg) {
    $p = (array) ($product['pricing'] ?? []);
    $qty = max(1, (int) $cfg['quantity']);
    $reasons = [];
    $need = function ($label, $v) use (&$reasons) {
        if (!sklubs_cfg_defined($v)) { if (!in_array($label, $reasons, true)) $reasons[] = $label; return 0.0; }
        return (float) $v;
    };
    $tiers = sklubs_cfg_tiers($p['tiers'][$cfg['size']] ?? []);
    $per_color = false; $colors = 1;
    if ($cfg['hasArtwork']) {
        foreach ((array) ($product['printingMethods'] ?? []) as $m) if (($m['id'] ?? '') === $cfg['method'] && !empty($m['perColor'])) $per_color = true;
        if ($per_color) $colors = max(1, (int) ($cfg['printColors'] ?? 1));
    }
    $m_tiers = $cfg['hasArtwork'] ? sklubs_cfg_tiers($p['methodTiers'][$cfg['method']] ?? []) : [];

    $base = 0.0; $below_min = false;
    if ($tiers) {
        $tier = sklubs_cfg_tier_at($tiers, $qty);
        if (!$tier) $below_min = true; else $base = $need('prix du palier', $tier['unit']);
    } else {
        $base = $need('prix de base', $p['basePriceBySize'][$cfg['size']] ?? null);
    }
    $addons = $need('supplément matière', $p['materialSurcharge'][$cfg['material']] ?? null)
        + $need('supplément finition', $p['finishSurcharge'][$cfg['finish']] ?? null)
        + (isset($p['ringSurcharge']) ? $need('supplément bague', $p['ringSurcharge'][$cfg['colors']['ring']] ?? null) : 0.0)
        + (($cfg['customColor'] && array_key_exists('customColorSurcharge', $p)) ? $need('supplément couleur personnalisée', $p['customColorSurcharge']) : 0.0);
    $setup = 0.0;
    if ($cfg['hasArtwork']) {
        if ($m_tiers) { $mt = sklubs_cfg_tier_at($m_tiers, $qty); $addons += $need('prix marquage', $mt ? $mt['unit'] : null); }
        else $addons += $need('prix marquage', $p['methodUnitPrice'][$cfg['method']] ?? null);
        if ($per_color && $colors > 1) $addons += ($colors - 1) * $need('prix par couleur supplémentaire', $p['colorUnitPrice'][$cfg['method']] ?? null);
        $setup = $need('frais de calage', $p['setupFee'][$cfg['method']] ?? null) * ($per_color ? $colors : 1);
    }

    $moqs = [];
    $moq_raw = $product['quantity']['moq'] ?? null;
    if (sklubs_cfg_defined($moq_raw)) $moqs[] = (float) $moq_raw; elseif ($tiers) $moqs[] = $tiers[0]['min'];
    if ($cfg['hasArtwork']) {
        if (sklubs_cfg_defined($p['methodMoq'][$cfg['method']] ?? null)) $moqs[] = (float) $p['methodMoq'][$cfg['method']];
        if ($m_tiers) $moqs[] = $m_tiers[0]['min'];
    }
    $moq = $moqs ? max($moqs) : null;
    if ($moq === null) $reasons[] = 'MOQ';
    $below_moq = ($moq !== null && $qty < $moq) || $below_min;
    $discount = 0.0;
    if (is_array($p['quantityDiscounts'] ?? null)) foreach ($p['quantityDiscounts'] as $t) if ($qty >= ($t['min'] ?? INF)) $discount = (float) ($t['discount'] ?? 0);

    $unit = ($base + $addons) * (1 - $discount) + $setup / $qty;
    $known = !$reasons && !$below_moq;
    return [
        'status' => $known ? (($p['priceMode'] ?? 'instant') === 'estimated' ? 'estimated' : 'instant') : 'factory',
        'reasons' => $reasons, 'moq' => $moq, 'quantity' => $qty, 'printColors' => $per_color ? $colors : null,
        'unit' => $known ? round($unit, 4) : null, 'total' => $known ? round($unit * $qty, 2) : null,
        'currency' => $p['currency'] ?? 'EUR', 'taxLabel' => $p['taxLabel'] ?? '',
        'leadTime' => $product['production']['leadTime'] ?? null,
    ];
}

// Lignes lisibles (panier, commande, e-mail)
function sklubs_cfg_label($list, $id) {
    foreach ((array) $list as $x) if (($x['id'] ?? null) === $id) return (string) ($x['label'] ?? $id);
    return (string) $id;
}
function sklubs_cfg_color_name(array $product, $hex) {
    foreach ((array) ($product['colors']['catalog'] ?? []) as $c) if (strtoupper($c['hex'] ?? '') === $hex) return $c['label'] . " ($hex)";
    return "$hex (personnalisée)";
}
function sklubs_cfg_rows(array $product, array $cfg) {
    $fin = $product['finishes'][$cfg['finish']] ?? [];
    $rows = [
        'Matière' => sklubs_cfg_label($product['materials'] ?? [], $cfg['material']),
        'Finition' => (string) ($fin['label'] ?? $cfg['finish']),
        'Couleur corps' => ($fin['colorable'] ?? true) === false ? 'Métal naturel' : sklubs_cfg_color_name($product, $cfg['colors']['body']),
        'Couleur bouchon' => sklubs_cfg_color_name($product, $cfg['colors']['cap']),
        'Couleur anse' => sklubs_cfg_color_name($product, $cfg['colors']['handle']),
        'Anneau métallique' => sklubs_cfg_label($product['ringFinishes'] ?? [], $cfg['colors']['ring']),
        'Marquage' => $cfg['hasArtwork']
            ? sklubs_cfg_label($product['printingMethods'] ?? [], $cfg['method']) . (($cfg['printColors'] ?? 1) > 1 ? ' ' . (int) $cfg['printColors'] . ' couleurs' : '') . ' · ' . sklubs_cfg_label($product['printZones'] ?? [], $cfg['zone']) . ' · ' . $cfg['layers'] . ' élément(s)'
            : 'Sans marquage',
    ];
    if (count((array) ($product['sizes'] ?? [])) > 1) $rows = ['Variante' => sklubs_cfg_label($product['sizes'], $cfg['size'])] + $rows;
    return $rows;
}
