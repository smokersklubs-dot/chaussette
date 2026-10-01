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
2. Framework : **Other**. Pas de commande de build, dossier de sortie : racine.
   Branche de production : `claude/brave-mccarthy-1l0zbc` (seule branche du dépôt pour l'instant). Déployer.
3. Domaine : ajouter par exemple `bouteille.sklubs.fr` dans **Settings → Domains**.

`vercel.json` autorise l'affichage du configurateur dans les pages de sklubs.fr et sklubs.com, et sert le modèle 3D
avec le bon type. `.vercelignore` ne publie que le site et le modèle web (pas les fichiers de travail Blender).
Ensuite, brancher le site WordPress : voir `integration/wordpress/README.md`.

## Back-office (WordPress)

L'extension `integration/wordpress/sklubs-configurator/` ajoute le menu **Configurateur** dans l'admin WordPress :
produits, variantes, matières, finitions, couleurs, techniques de marquage, **paliers de prix par quantité**,
MOQ, délai, catégories de l'accueil, et réception des projets clients.
Le configurateur lit ces données par l'API `…/wp-json/sklubs/v1` dès que la balise
`<meta name="sklubs-api">` de `index.html` et `configurateur.html` contient son adresse.
Vide (ou API injoignable), il lit les fichiers `products/` du dépôt.

## Lancer en local

```bash
npx http-server -p 8080 .
# puis ouvrir http://localhost:8080
```

Un serveur HTTP est nécessaire (le produit est chargé depuis un fichier JSON).

## Pages

- `index.html` : accueil, liste des produits par catégorie (API WordPress ou `products/catalog.json`).
- `configurateur.html?produit=<id>` : configurateur 3D du produit `<id>` (API WordPress ou `products/<id>/product.json`).

**Ajouter un modèle** : depuis l'admin WordPress (« Dupliquer » ou « Nouveau produit »), ou sans WordPress : créer `products/<id>/product.json` (même structure que `cricket-bottle`), sa vignette
`thumbnail.webp` et son master 3D, puis l'ajouter dans `products/catalog.json`. Une catégorie sans modèle
s'affiche « Bientôt ».

## Parcours

1. **Capacité** : un seul format, celui du master. Capacité et cotes : à confirmer usine.
2. **Matière** : inox double paroi, finitions mat, brillant, soft touch et brossé naturel.
   Chaque finition modifie le shader (rugosité, métal, vernis, grain).
3. **Couleurs** : corps, bouchon et anse indépendants (nuancier, HEX, RGB, référence Pantone),
   bague en inox poli ou métal noir. L'anse se rabat (bouton dans le viewer).
4. **Marquage** : technique filtrée par matière, zone (face, dos, wrap 360°),
   import PNG / JPG / SVG, déplacement direct sur la bouteille ou sur le patron 2D,
   taille, rotation, zones de sécurité. La gravure laser révèle le métal avec relief.
5. **Quantité** : saisie libre et tableau des paliers (prix unitaire, économie, « le plus choisi »), MOQ, délai.
6. **Récapitulatif** : vue produit centrée, envoi du projet, export PNG + JSON.

Mobile : viewer en haut, panneau en bottom sheet (replié, moyen, plein écran).

## Fichiers

| Fichier | Rôle |
|---|---|
| `products/cricket-bottle/product.json` | Toutes les données produit : tailles, matières, couleurs, zones, techniques, règles, prix |
| `js/viewer.js` | Scène 3D, chargement du master GLB, matériaux par pièce, anse pivotante, caméra, capture |
| `bottle-master/` | Reconstruction 3D contrainte : scripts Blender, calques de validation, .blend, GLB, rendus |
| `js/artwork.js` | Composition du visuel, masque de gravure, patron 2D |
| `js/pricing.js` | Règles de compatibilité et calcul du prix (paliers par variante + suppléments + calage) |
| `js/data.js` | Lecture du catalogue et des produits : API WordPress, sinon fichiers du dépôt |
| `integration/wordpress/sklubs-configurator/` | Extension WordPress : back-office, API, projets clients |
| `js/main.js` | Étapes, état, récapitulatif, export projet, bottom sheet, envoi au site |
| `js/home.js`, `home.css` | Accueil : catalogue, filtres par catégorie, transition vers le configurateur |
| `products/catalog.json` | Catégories et modèles affichés à l'accueil |

## Données à fournir (TO_DEFINE)

Aucun prix ni donnée usine n'a été inventé. Tant que ces valeurs sont vides,
le configurateur affiche **Validation usine requise** au lieu d'un prix.

- Capacité et matière exactes de la bouteille du devis Cricket.
- Échelle réelle du master (`scale.mmPerBodyHeight`) : tant qu'elle manque, les tailles
  s'affichent en % de la zone imprimable.
- Autres formats et matières (aluminium, Tritan, verre) : pas de master 3D ni de donnée usine.
- Prix : paliers par variante, suppléments matière, finition et bague, prix par technique,
  frais de calage, délai (onglet « Prix & quantités » de l'admin, ou `pricing` dans `product.json`).
- MOQ.
- Compatibilités matière / technique / zone (`rules`) : brouillon technique à valider.
- Nombre de couleurs max en sérigraphie et tampographie.
- Nuancier usine.
- Intégré dans une page WordPress équipée de l'extension, le projet est envoyé à l'admin.
  Ouvert seul, le bouton d'envoi télécharge le projet et l'aperçu (`SUBMIT_ENDPOINT` dans `js/main.js`
  pour un autre point d'envoi).

Dès que les champs `pricing` sont remplis, le prix s'affiche instantanément
(`priceMode: "instant"`) ou comme estimation (`priceMode: "estimated"`).

## Fichier projet exporté

`product_id`, `variant_id`, `size`, `materials`, `colors`, `color_refs`, `artwork`,
`artwork_transform` (unités BODY_HEIGHT, % de zone, mm si l'échelle est connue), `model`, `printing_method`, `print_zones`, `quantity`, `pricing`,
`camera_preview`, `preview_image` (PNG), `timestamp`.
