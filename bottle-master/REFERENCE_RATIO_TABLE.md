# REFERENCE_RATIO_TABLE — SKLUBS BOTTLE MASTER

**Unité : BODY_HEIGHT = 1.000**, du fond de la bouteille au bas de la bague métallique.
Aucune valeur n'est une cote usine : toutes les dimensions physiques restent `TO_DEFINE_FACTORY`.

**Source unique de géométrie :** l'encart des six bouteilles de la planche « 3D PRODUCT REFERENCE »
(`reference/source_board.webp`, zone x 160–740, y 0–350, copiée dans `reference/ref_panel.png`).
Ce n'est pas la photo originale : sa légende indique déjà une reconstruction. Résolution utile :
la bouteille bleue mesure 230 px de BODY_HEIGHT, donc **1 px ≈ 0,0043 BODY_HEIGHT**.

**Bouteilles mesurées :**
- **Bleue (avant, entièrement visible) :** mesure principale et calque de validation.
- **Noire et rose :** mesures croisées (flanc gauche pour la noire, deux flancs pour la rose).
- **Jaune et orange :** partiellement masquées par la bleue, et leur base est faussée par le reflet du sol. Confiance basse, non utilisées.
- **Olive :** segmentation impossible (couleur sombre et peu saturée). Non utilisée.

La géométrie finale utilise la **médiane noire / bleue / rose** pour le corps. Le haut (bague, bouchon,
anse) utilise les largeurs de la bleue recalées sur le col médian (×1,0164), pour garder les jeux entre pièces cohérents.

| PROPERTY | MEASURED_RATIO | par bouteille (noire / bleue / rose) | CONFIDENCE | SOURCE_AREA |
|---|---|---|---|---|
| BODY_HEIGHT | 1.000 (définition) | 216 / 230 / 213 px | HIGH | fond (croisement 50 % largeur) → bas de la bague |
| BODY_WIDTH / BODY_HEIGHT | 0.3926 | 0.3926 / 0.3863 / 0.3933 | HIGH | flancs du corps droit, z 0.10–0.80 |
| SHOULDER_HEIGHT / BODY_HEIGHT | 0.150 (z 0.80 → 0.95) | profil médian | MEDIUM | Bézier ajustée, RMS 0.0014 |
| NECK_WIDTH / BODY_WIDTH | 0.670 | 0.670 / 0.671 / 0.693 | MEDIUM | col coloré sous la bague |
| NECK_HEIGHT / BODY_HEIGHT | 0.050 (partie droite visible) | — | MEDIUM | bleue, lignes 116–127 |
| METAL_RING_WIDTH / BODY_WIDTH | 0.698 | bleue seule | MEDIUM-LOW | bords estimés à ±0,5 px (reflets) |
| METAL_RING_HEIGHT / BODY_HEIGHT | 0.061 | 0.069 / 0.061 / 0.056 | MEDIUM | colonne à 18 px de l'axe |
| CAP_WIDTH / BODY_WIDTH (jupe basse) | 0.710 | 0.716 / 0.707 / 0.712 | MEDIUM-HIGH | lignes sous les pivots |
| CAP_WIDTH / BODY_WIDTH (partie haute) | 0.692 | bleue seule | MEDIUM | lignes 70–75, entre les bras |
| CAP_HEIGHT / BODY_HEIGHT | 0.143 (z 1.061 → 1.204) | haut : 1.208 / 1.204 / 1.202 | HIGH | axe, bord supérieur du bouchon |
| CAP_TOP_FILLET / BODY_HEIGHT | 0.013 | bleue | LOW | 3 lignes d'arrondi |
| HANDLE_WIDTH / BODY_WIDTH (extérieur) | 0.822 | bleue seule (anse de face) | MEDIUM-HIGH | bras, lignes 55–75 |
| HANDLE_HEIGHT (sommet − pivot) / BODY_HEIGHT | 0.260 | haut image : 1.380 / 1.374 / 1.376 | HIGH | sommet sur l'axe |
| HANDLE_THICKNESS / BODY_WIDTH (bras) | 0.056 | bleue | MEDIUM | épaisseur radiale des bras (≈ 5 px) |
| HANDLE_THICKNESS / BODY_WIDTH (sommet) | 0.065 | bleue | MEDIUM | épaisseur verticale au sommet |
| HANDLE_DEPTH / BODY_WIDTH (largeur de sangle) | 0.171 | déduite de la rose (anse tournée d'environ 15°) | **LOW** | non visible de face : REFERENCE_REQUIRED |
| HINGE_PIVOT_Z | 1.126 | bleue | MEDIUM | centre des pivots, lignes 76–93 |
| HINGE_RADIUS / BODY_HEIGHT | 0.038 | bleue | MEDIUM-LOW | hauteur de la bosse latérale |
| BOTTOM_FILLET / BODY_HEIGHT | 0.045 | calé par silhouette | MEDIUM | lignes 332–344 |
| TOTAL_HEIGHT / BODY_HEIGHT (3D) | 1.386 | — | HIGH | sommet de l'anse, après calage perspective |
| TOTAL_HEIGHT / BODY_HEIGHT (image) | 1.376 | 1.380 / 1.374 / 1.376 | HIGH | médiane image |

## Caméra de la référence (REF_CAMERA, calée)

| Paramètre | Valeur | Confiance | Méthode |
|---|---|---|---|
| Hauteur | 0.75 BODY_HEIGHT | MEDIUM | recherche en grille, vallée plate entre 0.60 et 0.90 |
| Distance | 8.0 BODY_HEIGHT | MEDIUM | même recherche, vallée entre 6.5 et 8 |
| Inclinaison | 0° (plan image vertical, décentrement) | MEDIUM | jonction bague / col droite sur la photo, ellipse visible au fond |
| Focale | non déterminable seule, cadrage reproduit par le décentrement | LOW | — |

## Données usine (TO_DEFINE_FACTORY)

`CAPACITY`, `BODY_HEIGHT_MM`, `BODY_DIAMETER_MM`, `MATERIAL_GRADE`, `WALL_THICKNESS`, finition réelle de la peinture,
référence Pantone des six teintes, dimensions imprimables réelles, marges de sécurité, filetage du col,
mécanisme et butées des pivots, largeur réelle de la sangle.
