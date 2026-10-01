<?php
/**
 * Plugin Name: SKLUBS Configurateur
 * Description: Back-office des configurateurs 3D SKLUBS : produits, variantes, matières, couleurs, techniques de marquage, prix par paliers, catégories. Reçoit aussi les projets envoyés par les clients.
 * Version: 1.1.0
 * Requires PHP: 7.4
 * Author: SKLUBS
 *
 * Installation : téléverser le ZIP (Extensions > Ajouter > Téléverser), puis l'activer.
 * Le configurateur 3D est inclus (dossier site/) : la page « Configurateur 3D » est créée à l'activation,
 * et le code court [sklubs_configurateur] l'affiche dans n'importe quelle page.
 */
if (!defined('ABSPATH')) exit;

define('SKLUBS_CFG_VERSION', '1.1.0');
define('SKLUBS_CFG_DIR', __DIR__);
define('SKLUBS_CFG_URL', plugin_dir_url(__FILE__));
const SKLUBS_CFG_NS = 'sklubs/v1';
const SKLUBS_CFG_MAX_PROJECT = 12 * 1024 * 1024;
require_once __DIR__ . '/includes/pricing.php';
require_once __DIR__ . '/includes/woocommerce.php';

/* ------------------------------------------------------------------ données */

add_action('init', function () {
    register_post_type('sklubs_product', [
        'labels' => ['name' => 'Produits configurables'], 'public' => false, 'show_ui' => false, 'supports' => ['title'],
    ]);
    register_post_type('sklubs_project', [
        'labels' => ['name' => 'Projets clients', 'singular_name' => 'Projet client', 'menu_name' => 'Projets clients'],
        'public' => false, 'show_ui' => true, 'show_in_menu' => 'sklubs-configurator', 'supports' => ['title'],
        'capability_type' => 'post', 'map_meta_cap' => true, 'capabilities' => ['create_posts' => 'do_not_allow'],
    ]);
});

function sklubs_cfg_categories() {
    $c = get_option('sklubs_cfg_categories');
    return is_array($c) ? $c : [];
}

function sklubs_cfg_post($id) {
    $q = get_posts(['post_type' => 'sklubs_product', 'name' => $id, 'post_status' => ['publish', 'draft'], 'numberposts' => 1]);
    return $q ? $q[0] : null;
}

function sklubs_cfg_data($post) {
    $d = json_decode((string) get_post_meta($post->ID, '_sklubs_product', true), true);
    return is_array($d) ? $d : null;
}

function sklubs_cfg_card($p, $post) {
    $card = isset($p['card']) && is_array($p['card']) ? $p['card'] : [];
    return [
        'id' => $p['id'], 'category' => $p['category'] ?? '', 'name' => $p['name'] ?? $post->post_title,
        'subtitle' => $card['subtitle'] ?? '', 'capacity' => $card['capacity'] ?? '', 'material' => $card['material'] ?? '',
        'thumbnail' => $card['thumbnail'] ?? '', 'tags' => array_values(array_filter((array) ($card['tags'] ?? []))),
        'order' => (int) ($card['order'] ?? 0), 'status' => 'available',
    ];
}

/** Validation minimale d'un produit avant enregistrement. Renvoie un message d'erreur ou null. */
function sklubs_cfg_validate(&$p, $id) {
    if (!is_array($p)) return 'Produit invalide.';
    if (!preg_match('/^[a-z0-9-]{2,60}$/', $id)) return "Identifiant invalide : lettres minuscules, chiffres et tirets.";
    $p['id'] = $id;
    if (empty($p['name'])) return 'Le nom est obligatoire.';
    if (empty($p['sizes']) || !is_array($p['sizes'])) return 'Il faut au moins une variante.';
    $ids = array_column($p['sizes'], 'id');
    if (count($ids) !== count(array_unique($ids)) || in_array('', $ids, true)) return 'Chaque variante doit avoir un identifiant unique.';
    if (empty($p['defaultSize']) || !in_array($p['defaultSize'], $ids, true)) $p['defaultSize'] = $ids[0];
    if (empty($p['materials']) || !is_array($p['materials'])) return 'Il faut au moins une matière.';
    // paliers : triés, quantités positives, prix vides = « à définir »
    if (!empty($p['pricing']['tiers']) && is_array($p['pricing']['tiers'])) {
        foreach ($p['pricing']['tiers'] as $sid => $rows) {
            $rows = array_values(array_filter((array) $rows, fn($r) => isset($r['min']) && (int) $r['min'] > 0));
            foreach ($rows as &$r) { $r['min'] = (int) $r['min']; $r['unit'] = ($r['unit'] === '' || $r['unit'] === null) ? null : (float) $r['unit']; $r['popular'] = !empty($r['popular']); }
            usort($rows, fn($a, $b) => $a['min'] <=> $b['min']);
            $p['pricing']['tiers'][$sid] = $rows;
        }
    }
    return null;
}

/* ------------------------------------------------------------------ amorçage */

function sklubs_cfg_seed() {
    if (get_option('sklubs_cfg_seeded')) return;
    $cat = json_decode((string) @file_get_contents(SKLUBS_CFG_DIR . '/seed/catalog.json'), true);
    if (!get_option('sklubs_cfg_categories') && !empty($cat['categories'])) update_option('sklubs_cfg_categories', $cat['categories'], false);
    foreach (glob(SKLUBS_CFG_DIR . '/seed/products/*.json') ?: [] as $f) {
        $p = json_decode((string) file_get_contents($f), true);
        if (!is_array($p) || empty($p['id']) || sklubs_cfg_post($p['id'])) continue;
        $id = wp_insert_post(['post_type' => 'sklubs_product', 'post_status' => 'publish', 'post_name' => $p['id'], 'post_title' => $p['name'] ?? $p['id']]);
        if (!is_wp_error($id)) update_post_meta($id, '_sklubs_product', wp_slash(wp_json_encode($p, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)));
    }
    update_option('sklubs_cfg_seeded', 1, false);
}
register_activation_hook(__FILE__, 'sklubs_cfg_seed');
add_action('admin_init', 'sklubs_cfg_seed');
register_activation_hook(__FILE__, 'sklubs_cfg_create_page');
add_action('admin_init', 'sklubs_cfg_create_page');

/* ---------- Supabase (base de données principale) ---------- */

// URL + clé anon : réglages, sinon balises meta du configurateur inclus (site/index.html)
function sklubs_cfg_supabase() {
    static $cfg = null;
    if ($cfg !== null) return $cfg;
    $url = trim((string) get_option('sklubs_cfg_sb_url', ''));
    $key = trim((string) get_option('sklubs_cfg_sb_key', ''));
    if ((!$url || !$key) && is_readable(SKLUBS_CFG_DIR . '/site/index.html')) {
        $html = (string) file_get_contents(SKLUBS_CFG_DIR . '/site/index.html');
        if (!$url && preg_match('/<meta name="sklubs-supabase" content="([^"]+)"/', $html, $m)) $url = $m[1];
        if (!$key && preg_match('/<meta name="sklubs-supabase-key" content="([^"]+)"/', $html, $m)) $key = $m[1];
    }
    $cfg = ($url && $key) ? ['url' => untrailingslashit($url), 'key' => $key, 'secret' => (string) get_option('sklubs_cfg_sb_secret', '')] : [];
    return $cfg;
}

function sklubs_cfg_sb_request($path, array $body, array $extra_headers = [], $timeout = 20) {
    $sb = sklubs_cfg_supabase();
    if (!$sb) return new WP_Error('no_supabase', 'Supabase non configuré.');
    $r = wp_remote_post($sb['url'] . $path, ['timeout' => $timeout, 'headers' => array_merge([
        'apikey' => $sb['key'], 'Authorization' => 'Bearer ' . $sb['key'], 'Content-Type' => 'application/json',
        'Origin' => untrailingslashit(home_url()),
    ], $extra_headers), 'body' => wp_json_encode($body)]);
    if (is_wp_error($r)) return $r;
    $code = wp_remote_retrieve_response_code($r);
    $json = json_decode(wp_remote_retrieve_body($r), true);
    if ($code >= 300) return new WP_Error('supabase', is_array($json) ? ($json['message'] ?? 'Erreur Supabase') : 'Erreur Supabase', ['status' => $code >= 500 ? 502 : $code]);
    return $json;
}

// Fiche produit (format du configurateur) : Supabase si configuré (cache 60 s), sinon WordPress
function sklubs_cfg_product_data($id) {
    $id = sanitize_title($id);
    if (sklubs_cfg_supabase()) {
        $cached = get_transient('sklubs_cfg_p_' . $id);
        if (is_array($cached)) return $cached;
        $p = sklubs_cfg_sb_request('/rest/v1/rpc/product', ['p_id' => $id]);
        if (is_wp_error($p) || !is_array($p) || ($p['status'] ?? '') !== 'publish') return null;
        set_transient('sklubs_cfg_p_' . $id, $p, 60);
        return $p;
    }
    $post = sklubs_cfg_post($id);
    return ($post && $post->post_status === 'publish') ? sklubs_cfg_data($post) : null;
}

/* ---------- Configurateur 3D inclus (dossier site/) ---------- */

// Adresse du configurateur : réglage (ex. hébergement Vercel) sinon la copie incluse dans l'extension
function sklubs_cfg_app_url() {
    $custom = trim((string) get_option('sklubs_cfg_configurator_url', ''));
    if ($custom !== '') return trailingslashit($custom);
    return file_exists(SKLUBS_CFG_DIR . '/site/index.html') ? SKLUBS_CFG_URL . 'site/' : '';
}

// Page « Configurateur 3D » créée une seule fois (si elle est supprimée ensuite, elle n'est pas recréée)
function sklubs_cfg_create_page() {
    if (get_option('sklubs_cfg_page_id') || !current_user_can('manage_options')) return;
    $existing = get_page_by_path('configurateur-3d');
    $id = $existing ? $existing->ID : wp_insert_post([
        'post_type' => 'page', 'post_status' => 'publish', 'post_name' => 'configurateur-3d', 'post_title' => 'Configurateur 3D',
        // bloc « pleine largeur » : le thème l'étend sur toute la page s'il le permet
        'post_content' => "<!-- wp:group {\"align\":\"full\",\"layout\":{\"type\":\"default\"}} -->\n<div class=\"wp-block-group alignfull\"><!-- wp:shortcode -->\n[sklubs_configurateur]\n<!-- /wp:shortcode --></div>\n<!-- /wp:group -->",
    ]);
    if ($id && !is_wp_error($id)) update_option('sklubs_cfg_page_id', (int) $id, false);
}

// [sklubs_configurateur produit="cricket-bottle" hauteur="880" largeur="contenu|pleine"]
add_shortcode('sklubs_configurateur', function ($atts) {
    $a = shortcode_atts(['produit' => '', 'hauteur' => '880', 'largeur' => 'contenu'], $atts, 'sklubs_configurateur');
    $base = sklubs_cfg_app_url();
    if (!$base) return current_user_can('manage_options') ? '<p><strong>Configurateur SKLUBS :</strong> dossier site/ absent de l\'extension et aucune adresse dans Configurateur → Réglages.</p>' : '';
    $produit = sanitize_title($a['produit']);
    $src = $produit ? $base . 'configurateur.html?produit=' . rawurlencode($produit) : $base . 'index.html';
    $src = add_query_arg('v', SKLUBS_CFG_VERSION, $src);
    $h = max(560, (int) $a['hauteur']);
    $full = $a['largeur'] === 'pleine' ? 'width:100vw;max-width:100vw;margin-left:calc(50% - 50vw);' : 'width:100%;';
    $cfg = ['endpoint' => esc_url_raw(rest_url(SKLUBS_CFG_NS . '/project')), 'cart' => esc_url_raw(rest_url(SKLUBS_CFG_NS . '/cart')), 'nonce' => wp_create_nonce('wp_rest')];
    $id = 'sklubs-cfg-' . wp_rand(1000, 9999);
    ob_start(); ?>
    <div class="sklubs-cfg" style="<?php echo esc_attr($full); ?>position:relative;height:min(92vh,<?php echo (int) $h; ?>px);min-height:560px;overflow:hidden;background:#F6F6F4">
      <iframe id="<?php echo esc_attr($id); ?>" src="<?php echo esc_url($src); ?>" title="Configurateur 3D SKLUBS" allow="fullscreen" style="position:absolute;inset:0;width:100%;height:100%;border:0"></iframe>
    </div>
    <script>
    (function () {
      var frame = document.getElementById(<?php echo wp_json_encode($id); ?>);
      var origin = new URL(frame.src, location.href).origin;
      var cfg = <?php echo wp_json_encode($cfg); ?>;
      window.addEventListener('message', function (e) {
        if (e.origin !== origin || !e.data || e.data.type !== 'sklubs:bottle:project' || e.source !== frame.contentWindow) return;
        var order = e.data.project && e.data.project.intent === 'order';
        fetch(order ? cfg.cart : cfg.endpoint, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': cfg.nonce }, body: JSON.stringify(e.data.project) })
          .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.message || r.status); return j; }); })
          .then(function (j) {
            frame.contentWindow.postMessage({ type: 'sklubs:bottle:project-received', reference: j.reference, redirect: j.redirect || null }, origin);
            if (order && j.redirect) window.location.href = j.redirect; // panier WooCommerce
          })
          .catch(function (err) { frame.contentWindow.postMessage({ type: 'sklubs:bottle:project-error', message: 'Envoi impossible (' + err.message + '). Réessayez ou contactez SKLUBS.' }, origin); });
      });
    })();
    </script>
    <?php
    return ob_get_clean();
});

/* ------------------------------------------------------------------ API REST */

add_action('rest_api_init', function () {
    $admin = fn() => current_user_can('manage_options');
    $id_arg = ['id' => ['validate_callback' => fn($v) => (bool) preg_match('/^[a-z0-9-]{2,60}$/', $v)]];

    // public : lu par l'accueil et le configurateur
    register_rest_route(SKLUBS_CFG_NS, '/catalog', ['methods' => 'GET', 'permission_callback' => '__return_true', 'callback' => function () {
        $models = [];
        foreach (get_posts(['post_type' => 'sklubs_product', 'post_status' => 'publish', 'numberposts' => -1]) as $post) {
            $p = sklubs_cfg_data($post);
            if ($p) $models[] = sklubs_cfg_card($p, $post);
        }
        usort($models, fn($a, $b) => $a['order'] <=> $b['order'] ?: strcmp($a['name'], $b['name']));
        return ['categories' => sklubs_cfg_categories(), 'models' => $models];
    }]);
    register_rest_route(SKLUBS_CFG_NS, '/products/(?P<id>[a-z0-9-]+)', ['methods' => 'GET', 'permission_callback' => '__return_true', 'args' => $id_arg, 'callback' => function ($r) {
        $post = sklubs_cfg_post($r['id']);
        if (!$post || ($post->post_status !== 'publish' && !current_user_can('manage_options'))) return new WP_Error('not_found', 'Produit introuvable.', ['status' => 404]);
        return sklubs_cfg_data($post);
    }]);

    // administration
    register_rest_route(SKLUBS_CFG_NS, '/admin/products', ['methods' => 'GET', 'permission_callback' => $admin, 'callback' => function () {
        $out = [];
        foreach (get_posts(['post_type' => 'sklubs_product', 'post_status' => ['publish', 'draft'], 'numberposts' => -1]) as $post) {
            $p = sklubs_cfg_data($post) ?: [];
            $out[] = ['id' => $post->post_name, 'name' => $p['name'] ?? $post->post_title, 'category' => $p['category'] ?? '', 'status' => $post->post_status,
                      'variants' => count($p['sizes'] ?? []), 'modified' => get_post_modified_time('c', true, $post)];
        }
        return $out;
    }]);
    register_rest_route(SKLUBS_CFG_NS, '/admin/products/(?P<id>[a-z0-9-]+)', [
        ['methods' => 'GET', 'permission_callback' => $admin, 'args' => $id_arg, 'callback' => function ($r) {
            $post = sklubs_cfg_post($r['id']);
            return $post ? ['status' => $post->post_status, 'product' => sklubs_cfg_data($post)] : new WP_Error('not_found', 'Produit introuvable.', ['status' => 404]);
        }],
        ['methods' => 'PUT', 'permission_callback' => $admin, 'args' => $id_arg, 'callback' => function ($r) {
            $body = $r->get_json_params();
            $p = $body['product'] ?? null;
            $err = sklubs_cfg_validate($p, $r['id']);
            if ($err) return new WP_Error('invalid', $err, ['status' => 400]);
            $status = ($body['status'] ?? 'draft') === 'publish' ? 'publish' : 'draft';
            $post = sklubs_cfg_post($r['id']);
            $data = ['post_type' => 'sklubs_product', 'post_status' => $status, 'post_name' => $r['id'], 'post_title' => sanitize_text_field($p['name'])];
            $pid = $post ? wp_update_post(['ID' => $post->ID] + $data, true) : wp_insert_post($data, true);
            if (is_wp_error($pid)) return $pid;
            update_post_meta($pid, '_sklubs_product', wp_slash(wp_json_encode($p, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)));
            return ['ok' => true, 'status' => $status, 'product' => $p];
        }],
        ['methods' => 'DELETE', 'permission_callback' => $admin, 'args' => $id_arg, 'callback' => function ($r) {
            $post = sklubs_cfg_post($r['id']);
            if ($post) wp_delete_post($post->ID, true);
            return ['ok' => true];
        }],
    ]);
    register_rest_route(SKLUBS_CFG_NS, '/admin/categories', [
        ['methods' => 'GET', 'permission_callback' => $admin, 'callback' => fn() => sklubs_cfg_categories()],
        ['methods' => 'PUT', 'permission_callback' => $admin, 'callback' => function ($r) {
            $in = $r->get_json_params();
            $out = [];
            foreach ((array) $in as $c) {
                if (empty($c['id']) || !preg_match('/^[a-z0-9-]{2,40}$/', $c['id'])) return new WP_Error('invalid', 'Identifiant de catégorie invalide.', ['status' => 400]);
                $out[] = ['id' => $c['id'], 'label' => sanitize_text_field($c['label'] ?? $c['id']), 'desc' => sanitize_text_field($c['desc'] ?? '')];
            }
            update_option('sklubs_cfg_categories', $out, false);
            return $out;
        }],
    ]);

    // projets clients et panier : page du site (jeton) ou configurateur sur un domaine SKLUBS (bouteille.sklubs.fr)
    foreach (['/project', '/bottle-project'] as $route) {
        register_rest_route(SKLUBS_CFG_NS, $route, ['methods' => 'POST', 'callback' => 'sklubs_cfg_receive_project', 'permission_callback' => 'sklubs_cfg_can_submit']);
    }
    register_rest_route(SKLUBS_CFG_NS, '/cart', ['methods' => 'POST', 'callback' => 'sklubs_cfg_add_to_cart', 'permission_callback' => 'sklubs_cfg_can_submit']);
});

// lecture publique depuis le domaine du configurateur (catalogue et fiches produit uniquement)
add_filter('rest_pre_serve_request', function ($served, $result, $request) {
    $route = $request->get_route();
    if ($request->get_method() === 'GET' && (strpos($route, '/' . SKLUBS_CFG_NS . '/catalog') === 0 || strpos($route, '/' . SKLUBS_CFG_NS . '/products/') === 0)) {
        header('Access-Control-Allow-Origin: *');
        header('Cache-Control: public, max-age=60');
    }
    return $served;
}, 10, 3);

// Envoi autorisé : jeton WordPress (page du site) ou origine SKLUBS (configurateur sur sous-domaine)
function sklubs_cfg_origin_ok($origin) {
    $host = strtolower((string) wp_parse_url((string) $origin, PHP_URL_HOST));
    if (!$host || wp_parse_url((string) $origin, PHP_URL_SCHEME) !== 'https' && $host !== wp_parse_url(home_url(), PHP_URL_HOST)) return false;
    $allowed = array_filter([wp_parse_url(home_url(), PHP_URL_HOST), wp_parse_url(sklubs_cfg_app_url(), PHP_URL_HOST), 'sklubs.fr', 'sklubs.com']);
    foreach ($allowed as $a) {
        $a = preg_replace('/^www\./', '', strtolower($a));
        if ($host === $a || substr($host, -strlen('.' . $a)) === '.' . $a) return true;
    }
    return false;
}
function sklubs_cfg_can_submit(WP_REST_Request $r) {
    if (wp_verify_nonce($r->get_header('X-WP-Nonce'), 'wp_rest')) return true;
    return sklubs_cfg_origin_ok($r->get_header('Origin'));
}

function sklubs_cfg_parse_project(WP_REST_Request $r) {
    $raw = $r->get_body();
    if (strlen($raw) > SKLUBS_CFG_MAX_PROJECT) return new WP_Error('too_large', 'Projet trop volumineux.', ['status' => 413]);
    $p = json_decode($raw, true);
    if (!is_array($p) || empty($p['product_id'])) return new WP_Error('invalid', 'Projet invalide.', ['status' => 400]);
    $p['product_id'] = sanitize_title($p['product_id']);
    return $p;
}

function sklubs_cfg_receive_project(WP_REST_Request $r) {
    $p = sklubs_cfg_parse_project($r);
    if (is_wp_error($p)) return $p;
    if (($p['intent'] ?? '') === 'order') $p['intent'] = 'quote'; // une commande passe par /cart (prix serveur)
    if (sklubs_cfg_supabase()) { // base Supabase : le projet y est enregistré (prix serveur, fichiers)
        $sb = sklubs_cfg_sb_request('/functions/v1/submit', $p, [], 45);
        return is_wp_error($sb) ? $sb : ['ok' => true, 'reference' => $sb['reference']];
    }
    // prix recalculé sur le serveur, joint au projet (celui du navigateur reste à titre indicatif)
    $post = sklubs_cfg_post($p['product_id']);
    $price = null;
    if ($post) {
        $product = sklubs_cfg_data($post);
        $cfg = sklubs_cfg_config_from_project($product, $p);
        if (!is_wp_error($cfg)) $p['pricing_server'] = $price = sklubs_cfg_compute_price($product, $cfg);
    }
    $saved = sklubs_cfg_store_project($p, false);
    if (is_wp_error($saved)) return $saved;
    sklubs_cfg_notify($saved, $p, $price);
    return ['ok' => true, 'reference' => $saved['ref']];
}

function sklubs_cfg_store_project(array $p, $unused = false) {
    $ref = 'PRJ-' . gmdate('ymd') . '-' . strtoupper(wp_generate_password(5, false));
    $qty = (int) ($p['quantity'] ?? 0);
    // type de demande envoyé par le configurateur : devis, commande ou simple ajout au projet
    $intents = ['quote' => 'Devis', 'order' => 'Commande', 'save' => 'Projet enregistré'];
    $intent = isset($intents[$p['intent'] ?? '']) ? $p['intent'] : 'quote';
    $id = wp_insert_post(['post_type' => 'sklubs_project', 'post_status' => 'private',
        'post_title' => sprintf('%s — %s — %s — %d pcs', $ref, $intents[$intent], sanitize_text_field($p['product_id']), $qty)], true);
    if (is_wp_error($id)) return $id;
    $files = [];
    // logos d'origine (un par élément importé), en plus du visuel déroulé complet
    foreach (array_slice((array) ($p['artwork_layers'] ?? []), 0, 6) as $i => $layer) {
        $data = is_array($layer) ? ($layer['data_url'] ?? null) : null;
        if ($data && preg_match('#^data:image/(png|jpeg);base64,#', $data, $m)) {
            $bin = base64_decode(substr($data, strpos($data, ',') + 1), true);
            $info = $bin !== false ? @getimagesizefromstring($bin) : false;
            if ($info && in_array($info[2], [IMAGETYPE_PNG, IMAGETYPE_JPEG], true)) {
                $up = wp_upload_bits("$ref-logo-" . ($i + 1) . '.' . ($m[1] === 'jpeg' ? 'jpg' : 'png'), null, $bin);
                if (empty($up['error'])) $files['logo ' . ($i + 1)] = $up['url'];
            }
        }
        if (is_array($layer)) unset($p['artwork_layers'][$i]['data_url']);
    }
    foreach (['preview_image' => 'apercu', 'artwork' => 'visuel'] as $key => $label) {
        $data = $key === 'artwork' ? ($p['artwork']['data_url'] ?? null) : ($p[$key] ?? null);
        if ($data && preg_match('#^data:image/(png|jpeg);base64,#', $data, $m)) {
            $bin = base64_decode(substr($data, strpos($data, ',') + 1), true);
            $info = $bin !== false ? @getimagesizefromstring($bin) : false;
            if ($info && in_array($info[2], [IMAGETYPE_PNG, IMAGETYPE_JPEG], true)) {
                $up = wp_upload_bits("$ref-$label." . ($m[1] === 'jpeg' ? 'jpg' : 'png'), null, $bin);
                if (empty($up['error'])) $files[$label] = $up['url'];
            }
        }
        if ($key === 'artwork') unset($p['artwork']['data_url']); else unset($p[$key]);
    }
    update_post_meta($id, '_sklubs_ref', $ref);
    update_post_meta($id, '_sklubs_project', wp_slash(wp_json_encode($p, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)));
    update_post_meta($id, '_sklubs_files', $files);
    update_post_meta($id, '_sklubs_intent', $intent);
    return ['id' => $id, 'ref' => $ref, 'files' => $files, 'intent' => $intent, 'label' => $intents[$intent], 'qty' => $qty];
}

// E-mail à l'administrateur (prix serveur)
function sklubs_cfg_notify(array $saved, array $p, $price) {
    $unit = is_array($price) && $price['unit'] !== null ? number_format((float) $price['unit'], 2, ',', ' ') . ' ' . ($price['currency'] ?? 'EUR') . ' / u ' . ($price['taxLabel'] ?? '') : 'sur devis';
    wp_mail(get_option('admin_email'), "{$saved['label']} configurateur {$saved['ref']}",
        "Référence : {$saved['ref']}\nDemande : {$saved['label']}\nProduit : {$p['product_id']}\nQuantité : {$saved['qty']}\nPrix : $unit\n\n" .
        implode("\n", array_map(fn($k, $v) => "$k : $v", array_keys($saved['files']), $saved['files'])) .
        "\n\nDétail : " . admin_url("post.php?post={$saved['id']}&action=edit"));
}


add_action('add_meta_boxes', function () {
    add_meta_box('sklubs_project_detail', 'Configuration', function ($post) {
        foreach ((array) get_post_meta($post->ID, '_sklubs_files', true) as $label => $url) {
            printf('<p><strong>%s</strong><br><a href="%2$s" target="_blank"><img src="%2$s" style="max-width:320px"></a></p>', esc_html($label), esc_url($url));
        }
        $json = json_decode((string) get_post_meta($post->ID, '_sklubs_project', true), true);
        echo '<pre style="white-space:pre-wrap;max-height:480px;overflow:auto">' . esc_html(wp_json_encode($json, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)) . '</pre>';
    }, 'sklubs_project', 'normal');
});

// jeton et point d'envoi pour les pages qui intègrent le configurateur
add_action('wp_head', function () {
    printf('<script>window.SKLUBS_BOTTLE=window.SKLUBS_CFG=%s;</script>', wp_json_encode([
        'endpoint' => esc_url_raw(rest_url(SKLUBS_CFG_NS . '/project')), 'cart' => esc_url_raw(rest_url(SKLUBS_CFG_NS . '/cart')), 'nonce' => wp_create_nonce('wp_rest'),
    ]));
});

/* ------------------------------------------------------------------ fichiers 3D */

add_filter('upload_mimes', function ($m) {
    if (current_user_can('manage_options')) { $m['glb'] = 'model/gltf-binary'; $m['gltf'] = 'model/gltf+json'; }
    return $m;
});
add_filter('wp_check_filetype_and_ext', function ($data, $file, $filename) {
    $ext = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
    if (in_array($ext, ['glb', 'gltf'], true) && current_user_can('manage_options')) {
        $data['ext'] = $ext; $data['type'] = $ext === 'glb' ? 'model/gltf-binary' : 'model/gltf+json'; $data['proper_filename'] = $filename;
    }
    return $data;
}, 10, 3);

/* ------------------------------------------------------------------ écran d'administration */

add_action('admin_menu', function () {
    add_menu_page('Configurateur SKLUBS', 'Configurateur', 'manage_options', 'sklubs-configurator', 'sklubs_cfg_admin_page', 'dashicons-admin-customizer', 56);
    add_submenu_page('sklubs-configurator', 'Produits', 'Produits', 'manage_options', 'sklubs-configurator', 'sklubs_cfg_admin_page');
    add_submenu_page('sklubs-configurator', 'Réglages', 'Réglages', 'manage_options', 'sklubs-configurator-settings', 'sklubs_cfg_settings_page');
});

function sklubs_cfg_admin_page() {
    if (sklubs_cfg_supabase() && file_exists(SKLUBS_CFG_DIR . '/site/admin.html')) {
        // données dans Supabase : back-office Supabase (connexion par e-mail, comptes de la table admins)
        printf('<div class="wrap"><h1 style="margin-bottom:10px">Configurateur — back-office</h1><p>Produits, prix et projets sont enregistrés dans Supabase. <a href="%1$s" target="_blank">Ouvrir dans un onglet</a></p><iframe src="%1$s" style="width:100%%;height:calc(100vh - 170px);min-height:640px;border:1px solid #dcdcde;border-radius:8px;background:#F6F6F4"></iframe></div>',
            esc_url(SKLUBS_CFG_URL . 'site/admin.html?v=' . SKLUBS_CFG_VERSION));
        return;
    }
    echo '<div class="wrap sklubs-wrap"><div id="sklubs-admin">Chargement…</div></div>';
}

add_action('admin_enqueue_scripts', function ($hook) {
    if ($hook !== 'toplevel_page_sklubs-configurator') return;
    wp_enqueue_media();
    if (sklubs_cfg_supabase()) return; // back-office Supabase (site/admin.html) affiché dans la page
    wp_enqueue_style('sklubs-admin', SKLUBS_CFG_URL . 'site/admin/app.css', [], SKLUBS_CFG_VERSION);
    wp_enqueue_script('sklubs-admin', SKLUBS_CFG_URL . 'site/admin/app.js', [], SKLUBS_CFG_VERSION, true);
    wp_localize_script('sklubs-admin', 'SKLUBS_ADMIN', [
        'root' => esc_url_raw(rest_url(SKLUBS_CFG_NS . '/')), 'nonce' => wp_create_nonce('wp_rest'),
        'configuratorUrl' => (string) sklubs_cfg_app_url(),
        'template' => json_decode((string) @file_get_contents(SKLUBS_CFG_DIR . '/site/admin/template.json'), true),
    ]);
});

function sklubs_cfg_settings_page() {
    if (isset($_POST['sklubs_cfg_url']) && check_admin_referer('sklubs_cfg_settings')) {
        update_option('sklubs_cfg_configurator_url', esc_url_raw(wp_unslash($_POST['sklubs_cfg_url'])), false);
        update_option('sklubs_cfg_sb_url', esc_url_raw(wp_unslash($_POST['sklubs_cfg_sb_url'] ?? '')), false);
        update_option('sklubs_cfg_sb_key', sanitize_text_field(wp_unslash($_POST['sklubs_cfg_sb_key'] ?? '')), false);
        update_option('sklubs_cfg_sb_secret', sanitize_text_field(wp_unslash($_POST['sklubs_cfg_sb_secret'] ?? '')), false);
        echo '<div class="notice notice-success"><p>Réglages enregistrés.</p></div>';
    }
    $url = get_option('sklubs_cfg_configurator_url', '');
    $api = rest_url(SKLUBS_CFG_NS);
    $page = get_option('sklubs_cfg_page_id');
    ?>
    <div class="wrap"><h1>Réglages du configurateur</h1>
      <form method="post"><?php wp_nonce_field('sklubs_cfg_settings'); ?>
        <table class="form-table"><tr><th><label for="sklubs_cfg_url">Adresse du configurateur</label></th>
          <td><input type="url" class="regular-text" id="sklubs_cfg_url" name="sklubs_cfg_url" value="<?php echo esc_attr($url); ?>" placeholder="vide = configurateur inclus dans l'extension">
          <p class="description">Laisser vide pour utiliser le configurateur inclus (<code><?php echo esc_html(SKLUBS_CFG_URL . 'site/'); ?></code>). Renseigner seulement si le configurateur est hébergé ailleurs (ex. https://bouteille.sklubs.fr/).</p></td></tr>
          <tr><th>Page du site</th><td><?php echo $page && get_post_status($page) ? '<a href="' . esc_url(get_permalink($page)) . '" target="_blank">' . esc_html(get_permalink($page)) . '</a>' : '—'; ?>
          <p class="description">Code court pour une autre page : <code>[sklubs_configurateur]</code> (accueil, tous les produits) ou <code>[sklubs_configurateur produit="cricket-bottle"]</code>.</p></td></tr>
          <?php $sb = sklubs_cfg_supabase(); ?>
          <tr><th><label for="sklubs_cfg_sb_url">Supabase</label></th><td>
            <input type="url" class="regular-text" id="sklubs_cfg_sb_url" name="sklubs_cfg_sb_url" value="<?php echo esc_attr(get_option('sklubs_cfg_sb_url', '')); ?>" placeholder="<?php echo esc_attr($sb['url'] ?? 'https://xxxx.supabase.co'); ?>"><br>
            <input type="text" class="regular-text" name="sklubs_cfg_sb_key" value="<?php echo esc_attr(get_option('sklubs_cfg_sb_key', '')); ?>" placeholder="clé anon (publique)" style="margin-top:6px"><br>
            <input type="password" class="regular-text" name="sklubs_cfg_sb_secret" value="<?php echo esc_attr(get_option('sklubs_cfg_sb_secret', '')); ?>" placeholder="secret partagé SKLUBS_SHARED_SECRET (optionnel)" style="margin-top:6px" autocomplete="off">
            <p class="description"><?php echo $sb ? 'Connecté à <code>' . esc_html($sb['url']) . '</code> : produits, prix et projets viennent de Supabase.' : 'Non configuré : les produits sont gérés dans WordPress.'; ?> Vides = valeurs du configurateur inclus. Le secret relie les commandes WooCommerce aux projets.</p></td></tr>
          <tr><th>Adresse de l'API</th><td><code><?php echo esc_html($api); ?></code>
          <p class="description">À indiquer dans le configurateur (balise <code>&lt;meta name="sklubs-api"&gt;</code> de index.html et configurateur.html).</p></td></tr>
        </table><?php submit_button(); ?></form></div>
    <?php
}
