# SKLUBS — Configurateur Bouteille 3D

Configurateur 3D d'une bouteille personnalisée. Produit unique : **Bouteille Cricket**
(cas test n°1, devis 2026 Cricket Merchandising : 200 pièces, visuel blanc / rouge).

Site statique : HTML + CSS + JavaScript (modules ES) + Three.js 0.170 chargé par CDN.
Aucune étape de build.

Le modèle 3D affiché est le **master reconstruit et validé par calque** sur la photo de référence
(`bottle-master/`, voir son README). Le configurateur charge `bottle-master/export/SKLUBS_BOTTLE_WEB.glb`
(compression Draco, décodeur chargé depuis le CDN de Three.js).

## Mettre en ligne (Vercel)

1. Sur vercel.com : **Add New → Project**, importer le dépôt GitHub `smokersklubs-dot/chaussette`.
2. Framework : **Other**. Pas de commande de build, dossier de sortie : racine. Déployer.
3. Domaine : ajouter par exemple `bouteille.sklubs.fr` dans **Settings → Domains**.

`vercel.json` autorise l'affichage du configurateur dans les pages de sklubs.fr et sklubs.com, et sert le modèle 3D
avec le bon type. `.vercelignore` ne publie que le site et le modèle web (pas les fichiers de travail Blender).
Ensuite, brancher le site WordPress : voir `integration/wordpress/README.md`.

## Lancer en local

```bash
npx http-server -p 8080 .
# puis ouvrir http://localhost:8080
```

Un serveur HTTP est nécessaire (le produit est chargé depuis un fichier JSON).

## Parcours

1. **Capacité** : un seul format, celui du master. Capacité et cotes : à confirmer usine.
2. **Matière** : inox double paroi, finitions mat, brillant, soft touch et brossé naturel.
   Chaque finition modifie le shader (rugosité, métal, vernis, grain).
3. **Couleurs** : corps, bouchon et anse indépendants (nuancier, HEX, RGB, référence Pantone),
   bague en inox poli ou métal noir. L'anse se rabat (bouton dans le viewer).
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
| `js/viewer.js` | Scène 3D, chargement du master GLB, matériaux par pièce, anse pivotante, caméra, capture |
| `bottle-master/` | Reconstruction 3D contrainte : scripts Blender, calques de validation, .blend, GLB, rendus |
| `js/artwork.js` | Composition du visuel, masque de gravure, patron 2D |
| `js/pricing.js` | Règles de compatibilité et calcul du prix |
| `js/main.js` | Étapes, état, récapitulatif, export projet, bottom sheet |

## Données à fournir (TO_DEFINE)

Aucun prix ni donnée usine n'a été inventé. Tant que ces valeurs sont vides,
le configurateur affiche **Validation usine requise** au lieu d'un prix.

- Capacité et matière exactes de la bouteille du devis Cricket.
- Échelle réelle du master (`scale.mmPerBodyHeight`) : tant qu'elle manque, les tailles
  s'affichent en % de la zone imprimable.
- Autres formats et matières (aluminium, Tritan, verre) : pas de master 3D ni de donnée usine.
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
`artwork_transform` (unités BODY_HEIGHT, % de zone, mm si l'échelle est connue), `model`, `printing_method`, `print_zones`, `quantity`, `pricing`,
`camera_preview`, `preview_image` (PNG), `timestamp`.
