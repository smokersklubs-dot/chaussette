<?php
/**
 * Pont WooCommerce : « Commander » dans le configurateur ajoute la bouteille configurée au panier.
 *
 * - Un produit WooCommerce « support » (caché du catalogue) est créé par modèle du configurateur.
 * - Le prix unitaire est recalculé sur le serveur (includes/pricing.php) selon la configuration et la quantité.
 * - Le détail (couleurs, marquage, référence, aperçu) suit l'article jusqu'à la commande ; la commande est
 *   reliée au projet (menu Configurateur → Projets clients).
 * - Le produit support ne peut pas être ajouté au panier autrement (pas de commande à 0 €).
 */
if (!defined('ABSPATH')) exit;

function sklubs_cfg_wc_active() { return class_exists('WooCommerce') && function_exists('WC'); }

// Produit WooCommerce support d'un modèle du configurateur (créé au premier besoin)
function sklubs_cfg_wc_product_id($pid, $name) {
    $map = (array) get_option('sklubs_cfg_wc_products', []);
    if (!empty($map[$pid])) {
        $existing = wc_get_product((int) $map[$pid]);
        if ($existing && $existing->get_status() !== 'trash') return (int) $map[$pid];
    }
    $prod = new WC_Product_Simple();
    $prod->set_name($name . ' — personnalisée');
    $prod->set_status('publish');
    $prod->set_catalog_visibility('hidden');
    $prod->set_regular_price('0');
    $prod->set_short_description('Produit configuré en 3D avec le configurateur SKLUBS. Le prix dépend de la configuration et de la quantité.');
    try { $prod->set_sku('SKLUBS-CFG-' . strtoupper($pid)); } catch (Exception $e) { /* UGS déjà prise : sans UGS */ }
    $prod->update_meta_data('_sklubs_cfg_product', $pid);
    $id = $prod->save();
    $map[$pid] = $id;
    update_option('sklubs_cfg_wc_products', $map, false);
    return (int) $id;
}

function sklubs_cfg_is_carrier($product_id) {
    return (bool) get_post_meta((int) $product_id, '_sklubs_cfg_product', true);
}

// POST /sklubs/v1/cart : projet (intent order) -> panier WooCommerce
function sklubs_cfg_add_to_cart(WP_REST_Request $r) {
    if (!sklubs_cfg_wc_active()) return new WP_Error('no_shop', 'La boutique n\'est pas disponible : demandez un devis.', ['status' => 503]);
    $p = sklubs_cfg_parse_project($r);
    if (is_wp_error($p)) return $p;
    $product = sklubs_cfg_product_data($p['product_id']);
    if (!$product) return new WP_Error('not_found', 'Produit introuvable.', ['status' => 404]);
    $cfg = sklubs_cfg_config_from_project($product, $p);
    if (is_wp_error($cfg)) return $cfg;
    $price = sklubs_cfg_compute_price($product, $cfg);
    if ($price['status'] !== 'instant') {
        return new WP_Error('quote_only', 'Cette configuration doit être chiffrée par SKLUBS : demandez un devis.', ['status' => 409, 'reasons' => $price['reasons']]);
    }
    $p['intent'] = 'order';
    if (sklubs_cfg_supabase()) {
        // projet enregistré dans Supabase (prix recalculé là-bas aussi : on garde le plus prudent des deux calculs)
        $sb = sklubs_cfg_sb_request('/functions/v1/submit', $p, [], 45);
        if (is_wp_error($sb)) return $sb;
        if (($sb['price']['status'] ?? '') !== 'instant') return new WP_Error('quote_only', 'Cette configuration doit être chiffrée par SKLUBS : demandez un devis.', ['status' => 409]);
        $price['unit'] = max((float) $price['unit'], (float) $sb['price']['unit']);
        $saved = ['id' => 0, 'ref' => (string) $sb['reference'], 'files' => ['apercu' => (string) ($sb['preview_url'] ?? '')], 'intent' => 'order', 'label' => 'Commande', 'qty' => $cfg['quantity']];
    } else {
        $p['pricing_server'] = $price;
        $saved = sklubs_cfg_store_project($p, false);
        if (is_wp_error($saved)) return $saved;
    }

    if (function_exists('wc_load_cart')) wc_load_cart();
    if (!WC()->cart) return new WP_Error('no_cart', 'Panier indisponible.', ['status' => 503]);
    $wc_id = sklubs_cfg_wc_product_id($product['id'], $product['name'] ?? $product['id']);
    $GLOBALS['sklubs_cfg_adding'] = true;
    try {
        $key = WC()->cart->add_to_cart($wc_id, $cfg['quantity'], 0, [], ['sklubs' => [
            'ref' => $saved['ref'], 'project_id' => $saved['id'], 'product' => $product['id'], 'cfg' => $cfg,
            'unit' => $price['unit'], 'qty' => $cfg['quantity'], 'rows' => sklubs_cfg_rows($product, $cfg),
            'preview' => $saved['files']['apercu'] ?? '', 'name' => $product['name'] ?? '',
        ]]);
    } catch (Exception $e) {
        $key = false;
    }
    $GLOBALS['sklubs_cfg_adding'] = false;
    if (!$key) {
        $msg = 'Ajout au panier impossible.';
        if (function_exists('wc_get_notices')) { foreach ((array) wc_get_notices('error') as $n) $msg = wp_strip_all_tags(is_array($n) ? ($n['notice'] ?? $msg) : $n); wc_clear_notices(); }
        return new WP_Error('cart_failed', $msg, ['status' => 400]);
    }
    WC()->cart->calculate_totals();
    if (WC()->session && method_exists(WC()->session, 'set_customer_session_cookie')) WC()->session->set_customer_session_cookie(true);
    if (!sklubs_cfg_supabase()) sklubs_cfg_notify($saved, $p, $price);
    return ['ok' => true, 'reference' => $saved['ref'], 'redirect' => wc_get_cart_url(), 'unit' => $price['unit'], 'total' => $price['total']];
}


// Le produit support ne s'ajoute que par le configurateur (formulaire, lien ?add-to-cart, Store API)
add_filter('woocommerce_add_to_cart_validation', function ($ok, $product_id) {
    if (sklubs_cfg_is_carrier($product_id) && empty($GLOBALS['sklubs_cfg_adding'])) {
        wc_add_notice('Ce produit se commande depuis le configurateur 3D.', 'error');
        return false;
    }
    return $ok;
}, 10, 2);
add_action('woocommerce_store_api_validate_add_to_cart', function ($product) {
    if ($product && sklubs_cfg_is_carrier($product->get_id()) && empty($GLOBALS['sklubs_cfg_adding'])) {
        throw new Exception('Ce produit se commande depuis le configurateur 3D.');
    }
});

// Prix serveur ; article sans configuration retiré ; quantité modifiée -> prix recalculé (ou quantité rétablie)
add_action('woocommerce_before_calculate_totals', function ($cart) {
    if (is_admin() && !wp_doing_ajax()) return;
    foreach ($cart->get_cart() as $key => $item) {
        $pid = $item['product_id'] ?? 0;
        if (!sklubs_cfg_is_carrier($pid)) continue;
        if (empty($item['sklubs'])) { $cart->remove_cart_item($key); continue; }
        $s = $item['sklubs'];
        if ((int) $item['quantity'] !== (int) $s['qty']) {
            $prod = sklubs_cfg_product_data($s['product']);
            $price = $prod ? sklubs_cfg_compute_price($prod, array_merge($s['cfg'], ['quantity' => (int) $item['quantity']])) : ['status' => 'factory'];
            if ($price['status'] === 'instant') {
                $s['unit'] = $price['unit']; $s['qty'] = (int) $item['quantity']; $s['cfg']['quantity'] = (int) $item['quantity'];
            } else {
                $cart->cart_contents[$key]['quantity'] = (int) $s['qty']; // sous le minimum : quantité rétablie
            }
            $cart->cart_contents[$key]['sklubs'] = $s;
        }
        $cart->cart_contents[$key]['data']->set_price((float) $s['unit']);
    }
}, 20);

// Détail dans le panier et la validation de commande
add_filter('woocommerce_get_item_data', function ($data, $item) {
    if (empty($item['sklubs'])) return $data;
    $data[] = ['key' => 'Référence', 'value' => $item['sklubs']['ref']];
    foreach ((array) $item['sklubs']['rows'] as $k => $v) $data[] = ['key' => $k, 'value' => $v];
    return $data;
}, 10, 2);
add_filter('woocommerce_cart_item_thumbnail', function ($html, $item) {
    if (empty($item['sklubs']['preview'])) return $html;
    return sprintf('<img src="%s" alt="%s" style="width:64px;height:auto">', esc_url($item['sklubs']['preview']), esc_attr($item['sklubs']['name']));
}, 10, 2);
add_filter('woocommerce_cart_item_name', function ($name, $item) {
    return empty($item['sklubs']['name']) ? $name : esc_html($item['sklubs']['name'] . ' — personnalisée');
}, 10, 2);

// Commande : détail + lien vers le projet
add_action('woocommerce_checkout_create_order_line_item', function ($line, $key, $values) {
    if (empty($values['sklubs'])) return;
    $s = $values['sklubs'];
    $line->add_meta_data('Référence configurateur', $s['ref']);
    foreach ((array) $s['rows'] as $k => $v) $line->add_meta_data($k, $v);
    if (!empty($s['preview'])) $line->add_meta_data('Aperçu', $s['preview']);
    $line->add_meta_data('_sklubs_project_id', (int) $s['project_id']);
}, 10, 3);
$sklubs_link_order = function ($order) {
    if (is_numeric($order)) $order = wc_get_order($order);
    if (!$order) return;
    foreach ($order->get_items() as $line) {
        $ref = (string) $line->get_meta('Référence configurateur');
        $sb = sklubs_cfg_supabase();
        if ($ref && $sb && $sb['secret']) {
            sklubs_cfg_sb_request('/functions/v1/submit?action=link-order', ['reference' => $ref, 'order_id' => $order->get_id()], ['x-sklubs-secret' => $sb['secret']]);
        }
        $pid = (int) $line->get_meta('_sklubs_project_id');
        if (!$pid) continue;
        update_post_meta($pid, '_sklubs_order_id', $order->get_id());
        wp_update_post(['ID' => $pid, 'post_title' => preg_replace('/ — Commande — /', ' — Commande n° ' . $order->get_order_number() . ' — ', get_the_title($pid), 1)]);
    }
};
add_action('woocommerce_checkout_order_created', $sklubs_link_order);
add_action('woocommerce_store_api_checkout_order_processed', $sklubs_link_order);

// Aperçu visible dans la commande (admin)
add_action('woocommerce_after_order_itemmeta', function ($item_id, $item) {
    $url = $item->get_meta('Aperçu');
    if ($url) printf('<p><img src="%s" alt="" style="max-width:160px;border:1px solid #ddd;border-radius:6px"></p>', esc_url($url));
}, 10, 2);
