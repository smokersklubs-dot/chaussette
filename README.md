# SKLUBS — Configurateur Bouteille 3D

Configurateur 3D d'une bouteille personnalisée. Produit unique : **Bouteille Cricket**
(cas test n°1, devis 2026 Cricket Merchandising : 200 pièces, visuel blanc / rouge).

Site statique : HTML + CSS + JavaScript (modules ES) + Three.js 0.170 chargé par CDN.
Aucune étape de build.

## Lancer en local

```bash
npx http-server -p 8080 .
# puis ouvrir http://localhost:8080
```

Un serveur HTTP est nécessaire (le produit est chargé depuis un fichier JSON).

## Parcours

1. **Capacité** : chaque capacité a sa propre géométrie 3D.
2. **Matière** : inox, aluminium, Tritan, avec finitions (mat, brillant, soft touch,
   brossé, métallisé, transparent, givré). Chaque finition modifie le shader
   (rugosité, métal, vernis, transmission, indice de réfraction).
3. **Couleurs** : corps, bouchon et anse indépendants. Nuancier, HEX, RGB et
   référence Pantone / usine.
4. **Marquage** : technique filtrée par matière, zone (face, dos, wrap 360°),
   import PNG / JPG / SVG, déplacement direct sur la bouteille ou sur le patron 2D,
   taille, rotation, zones de sécurité. La gravure laser révèle le métal avec relief.
5. **Quantité** : saisie libre et paliers.
6. **Récapitulatif** : vue produit centrée, envoi du projet, export PNG + JSON.

Mobile : viewer en haut, panneau en bottom sheet (replié, moyen, plein écran).

## Fichiers

| Fichier | Rôle |
|---|---|
| `products/cricket-bottle/product.json` | Toutes les données produit : tailles, matières, couleurs, zones, techniques, règles, prix |
| `js/viewer.js` | Scène 3D, géométrie de la bouteille, matériaux, caméra, capture |
| `js/artwork.js` | Composition du visuel, masque de gravure, patron 2D |
| `js/pricing.js` | Règles de compatibilité et calcul du prix |
| `js/main.js` | Étapes, état, récapitulatif, export projet, bottom sheet |

## Données à fournir (TO_DEFINE)

Aucun prix ni donnée usine n'a été inventé. Tant que ces valeurs sont vides,
le configurateur affiche **Validation usine requise** au lieu d'un prix.

- Capacité et matière exactes de la bouteille du devis Cricket.
- Dimensions réelles (diamètre, hauteur, zone imprimable) de chaque capacité.
- Prix : base par capacité, suppléments matière et finition, prix par technique,
  frais de calage, remises par palier (`pricing` dans `product.json`).
- MOQ.
- Compatibilités matière / technique / zone (`rules`) : brouillon technique à valider.
- Nombre de couleurs max en sérigraphie et tampographie.
- Nuancier usine.
- Point d'envoi des projets (`SUBMIT_ENDPOINT` dans `js/main.js`) : API, WooCommerce
  ou CRM. En attendant, le bouton d'envoi télécharge le projet et l'aperçu.

Dès que les champs `pricing` sont remplis, le prix s'affiche instantanément
(`priceMode: "instant"`) ou comme estimation (`priceMode: "estimated"`).

## Fichier projet exporté

`product_id`, `variant_id`, `size`, `materials`, `colors`, `color_refs`, `artwork`,
`artwork_transform` (mm), `printing_method`, `print_zones`, `quantity`, `pricing`,
`camera_preview`, `preview_image` (PNG), `timestamp`.
