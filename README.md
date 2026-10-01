# SKLUBS — Configurateur Bouteille 3D

Configurateur 3D d'une bouteille personnalisée. Produit unique : **Bouteille Cricket**
(cas test n°1, devis 2026 Cricket Merchandising : 200 pièces, visuel blanc / rouge).

Site statique : HTML + CSS + JavaScript (modules ES) + Three.js 0.170 chargé par CDN.
Aucune étape de build.

Le modèle 3D affiché est le **master reconstruit et validé par calque** sur la photo de référence
(`bottle-master/`, voir son README). Le configurateur charge `bottle-master/export/SKLUBS_BOTTLE_WEB.glb`
(compression Draco, décodeur chargé depuis le CDN de Three.js).

## Mettre en ligne

**Configurateur : https://bouteille.sklubs.fr** (Vercel, pleine page). **Données et boutique : WordPress** —
`python3 tools/build_wp_plugin.py` produit `dist/sklubs-configurator.zip` à téléverser dans WordPress
(bouton vers le sous-domaine : code court `[sklubs_configurateur]`). Voir `integration/wordpress/README.md`.

### Vercel (sous-domaine bouteille.sklubs.fr)

Projet Vercel `sklubs-configurateur` (relié au dépôt GitHub : chaque push est déployé) :
https://sklubs-configurateur.vercel.app — domaine `bouteille.sklubs.fr` (DNS Cloudflare : CNAME vers Vercel, DNS only).
Les données (produits, prix, projets, panier) viennent de WordPress (`<meta name="sklubs-api">`).

#### Mise en place

1. Sur vercel.com : **Add New → Project**, importer le dépôt GitHub `smokersklubs-dot/chaussette`.
2. Framework : **Other**. Pas de commande de build, dossier de sortie : racine.
   Branche de production : `claude/brave-mccarthy-1l0zbc` (seule branche du dépôt pour l'instant). Déployer.
3. Domaine : ajouter `bouteille.sklubs.fr` dans **Settings → Domains**, puis chez le registraire de sklubs.fr
   un enregistrement DNS `CNAME bouteille → cname.vercel-dns.com`.

`vercel.json` autorise l'affichage du configurateur dans les pages de sklubs.fr et sklubs.com, et sert le modèle 3D
avec le bon type. `.vercelignore` ne publie que le site et le modèle web (pas les fichiers de travail Blender).
Ensuite, brancher le site WordPress : voir `integration/wordpress/README.md`.

## Backend (Supabase) et boutique (WooCommerce)

- **Supabase** : base de données principale (produits, prix, catégories, projets clients, fichiers). Voir `supabase/README.md`.
  Le configurateur lit `rpc/catalog` et `rpc/product`, et envoie les devis à la fonction `submit` (prix recalculé côté serveur).
- **Back-office** : `admin.html` (connexion Supabase, comptes de la table `admins`) : produits, variantes, matières,
  couleurs, techniques, **paliers de prix**, MOQ, délai, catégories, projets clients et leur statut.
- **WordPress / WooCommerce** : l'extension `integration/wordpress/sklubs-configurator/` affiche le configurateur
  (le configurateur est sur `bouteille.sklubs.fr`, pleine page sans iframe ; le code court
  `[sklubs_configurateur]` affiche un bouton vers lui) et **« Commander » ajoute la bouteille au panier
  WooCommerce** au prix serveur, avec tout le détail de la configuration dans la commande.
- Sans Supabase : API WordPress (`<meta name="sklubs-api">`), puis fichiers `products/` du dépôt.

## Lancer en local

```bash
npx http-server -p 8080 .
# puis ouvrir http://localhost:8080
```

Un serveur HTTP est nécessaire (le produit est chargé depuis un fichier JSON).

## Pages

- `index.html` : accueil — hero 3D (bouteille SKLUBS, choix de couleur), choix du type de drinkware, choix du modèle en 3D, parcours. Données : API WordPress ou `products/catalog.json`.
- `configurateur.html?produit=<id>` : configurateur 3D du produit `<id>` (API WordPress ou `products/<id>/product.json`).

**Ajouter un modèle** : depuis l'admin WordPress (« Dupliquer » ou « Nouveau produit »), ou sans WordPress : créer `products/<id>/product.json` (même structure que `cricket-bottle`), sa vignette
`thumbnail.webp` et son master 3D, puis l'ajouter dans `products/catalog.json`. Une catégorie sans modèle
s'affiche « Bientôt ».

## Parcours (planche SKLUBS, écrans 04 à 12)

Barre d'outils 3D : rotation 360°, zoom, vue arrière, vue de dessus, détails, vue éclatée,
anse rabattue, zone d'impression, recentrer, plein écran.

1. **Matière & couleur** : matière du corps (matières sans master 3D affichées « Sur demande »),
   couleur du corps (nuancier, couleur personnalisée HEX, référence Pantone), finition.
2. **Bouchon & détails** : type de bouchon, couleurs du bouchon et de l'anse, anneau métallique,
   vue éclatée automatique.
3. **Personnalisation** : plusieurs éléments (logos importés et textes : police, gras, italique, couleur),
   position, taille, rotation, glisser directement sur la bouteille ; zones face, dos, wrap 360°.
4. **Aperçu d'impression** : vues avant, arrière, droite, gauche, 360° ; gabarit 2D déroulé avec zone
   imprimable, zone de sécurité et ligne de centrage (cotes en mm dès que l'échelle usine est connue).
5. **Méthode d'impression** : techniques compatibles avec la matière, description et avantages ;
   la zone s'ajuste si la technique ne la permet pas.
6. **Quantité & prix** : paliers (« le plus populaire »), récapitulatif prix (unitaire, total, économie,
   délai, mention HT/TTC). Sans prix renseigné : « Sur devis ».
7. **Vue finale** : bouteille sur socle, récapitulatif complet ; « Ajouter au projet » (enregistré sur l'appareil
   et transmis au site), « Demander un devis », « Commander » (actif seulement avec un prix confirmé),
   « Télécharger le rendu 3D ».

Mobile : viewer en haut, panneau en bottom sheet (replié, moyen, plein écran).

## Fichiers

| Fichier | Rôle |
|---|---|
| `products/cricket-bottle/product.json` | Toutes les données produit : tailles, matières, couleurs, zones, techniques, règles, prix |
| `js/viewer.js` | Scène 3D, chargement du master GLB, matériaux par pièce, anse pivotante, caméra, capture |
| `bottle-master/` | Reconstruction 3D contrainte : scripts Blender, calques de validation, .blend, GLB, rendus |
| `js/artwork.js` | Composition du visuel, masque de gravure, patron 2D |
| `js/pricing.js` | Règles de compatibilité et calcul du prix (paliers par variante + suppléments + calage) |
| `js/data.js` | Lecture du catalogue et des produits : Supabase, sinon API WordPress, sinon fichiers du dépôt |
| `admin.html`, `admin/` | Back-office (Supabase ou WordPress) |
| `supabase/` | Base de données, sécurité, fonction serveur `submit` |
| `integration/wordpress/sklubs-configurator/` | Extension WordPress : configurateur inclus, pont WooCommerce, réglages Supabase |
| `js/main.js` | Étapes, état, récapitulatif, export projet, bottom sheet, envoi au site |
| `js/home.js`, `home.css` | Accueil : hero, types de produit, modèles, lien vers le configurateur avec la couleur choisie |
| `js/hero3d.js` | Bouteille 3D de l'accueil (couleurs, logo, animation légère) |
| `js/glb.js` | Chargement partagé des masters 3D (accueil et configurateur) |
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

`intent` (quote / order / save), `product_id`, `variant_id`, `size`, `materials`, `colors`, `color_refs`,
`artwork` (visuel déroulé 360° complet, PNG), `artwork_layers` (chaque logo ou texte avec sa position),
`artwork_transform` (unités BODY_HEIGHT, % de zone, mm si l'échelle est connue), `model`, `printing_method`, `print_zones`, `quantity`, `pricing`,
`camera_preview`, `preview_image` (PNG), `timestamp`.
