<?php
/**
 * Plugin Name: SKLUBS — Projets bouteille
 * Description: Reçoit les projets du configurateur bouteille 3D, les enregistre dans l'admin (Projets bouteille) et prévient par e-mail.
 * Version: 1.0.0
 *
 * Installation : copier ce fichier dans wp-content/mu-plugins/ (ou wp-content/plugins/ puis activer).
 */
if (!defined('ABSPATH')) exit;

const SKLUBS_BOTTLE_MAX_BYTES = 12 * 1024 * 1024; // projet + aperçu + visuel

add_action('init', function () {
    register_post_type('sklubs_bottle_proj', [
        'labels' => ['name' => 'Projets bouteille', 'singular_name' => 'Projet bouteille'],
        'public' => false, 'show_ui' => true, 'menu_icon' => 'dashicons-portfolio',
        'supports' => ['title'], 'capability_type' => 'post', 'map_meta_cap' => true,
    ]);
});

// Jeton + point d'envoi exposés aux pages qui intègrent le configurateur
add_action('wp_head', function () {
    printf('<script>window.SKLUBS_BOTTLE=%s;</script>', wp_json_encode([
        'endpoint' => esc_url_raw(rest_url('sklubs/v1/bottle-project')),
        'nonce'    => wp_create_nonce('wp_rest'),
    ]));
});

add_action('rest_api_init', function () {
    register_rest_route('sklubs/v1', '/bottle-project', [
        'methods'  => 'POST',
        'permission_callback' => function (WP_REST_Request $r) {
            return (bool) wp_verify_nonce($r->get_header('X-WP-Nonce'), 'wp_rest');
        },
        'callback' => 'sklubs_bottle_receive',
    ]);
});

function sklubs_bottle_receive(WP_REST_Request $r) {
    $raw = $r->get_body();
    if (strlen($raw) > SKLUBS_BOTTLE_MAX_BYTES) return new WP_Error('too_large', 'Projet trop volumineux.', ['status' => 413]);
    $p = json_decode($raw, true);
    if (!is_array($p) || empty($p['product_id'])) return new WP_Error('invalid', 'Projet invalide.', ['status' => 400]);

    $ref = 'BTL-' . gmdate('ymd') . '-' . strtoupper(wp_generate_password(5, false));
    $qty = isset($p['quantity']) ? (int) $p['quantity'] : 0;
    $id = wp_insert_post([
        'post_type' => 'sklubs_bottle_proj', 'post_status' => 'private',
        'post_title' => sprintf('%s — %s — %d pcs', $ref, sanitize_text_field($p['product_id']), $qty),
    ], true);
    if (is_wp_error($id)) return $id;

    // Images (aperçu produit, visuel client) enregistrées dans la médiathèque, le reste en JSON
    $files = [];
    foreach (['preview_image' => 'apercu', 'artwork' => 'visuel'] as $key => $label) {
        $data = $key === 'artwork' ? ($p['artwork']['data_url'] ?? null) : ($p[$key] ?? null);
        if ($data && preg_match('#^data:image/(png|jpeg);base64,#', $data, $m)) {
            $bin = base64_decode(substr($data, strpos($data, ',') + 1), true);
            if ($bin !== false) {
                $up = wp_upload_bits("$ref-$label." . ($m[1] === 'jpeg' ? 'jpg' : 'png'), null, $bin);
                if (empty($up['error'])) $files[$label] = $up['url'];
            }
        }
        if ($key === 'artwork') unset($p['artwork']['data_url']); else unset($p[$key]);
    }
    update_post_meta($id, '_sklubs_ref', $ref);
    update_post_meta($id, '_sklubs_project', wp_slash(wp_json_encode($p)));
    update_post_meta($id, '_sklubs_files', $files);

    wp_mail(get_option('admin_email'), "Nouveau projet bouteille $ref",
        "Référence : $ref\nQuantité : $qty\nStatut prix : " . ($p['pricing']['status'] ?? '—') . "\n\n" .
        implode("\n", array_map(fn($k, $v) => "$k : $v", array_keys($files), $files)) .
        "\n\nDétail : " . admin_url("post.php?post=$id&action=edit"));

    return ['ok' => true, 'reference' => $ref];
}

// Affichage du projet dans l'admin
add_action('add_meta_boxes', function () {
    add_meta_box('sklubs_bottle_detail', 'Configuration', function ($post) {
        $files = get_post_meta($post->ID, '_sklubs_files', true) ?: [];
        foreach ($files as $label => $url) printf('<p><strong>%s</strong><br><a href="%2$s" target="_blank"><img src="%2$s" style="max-width:320px"></a></p>', esc_html($label), esc_url($url));
        $json = json_decode(get_post_meta($post->ID, '_sklubs_project', true), true);
        echo '<pre style="white-space:pre-wrap;max-height:480px;overflow:auto">' . esc_html(wp_json_encode($json, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)) . '</pre>';
    }, 'sklubs_bottle_proj', 'normal');
});
