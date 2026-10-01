# REFERENCE_RATIO_TABLE — SKLUBS BOTTLE MASTER (v2, photo originale)

**Unité : BODY_HEIGHT = 1.000**, du fond de la bouteille au bas de la bague métallique.
Aucune valeur n'est une cote usine : toutes les dimensions physiques restent `TO_DEFINE_FACTORY`.

**Source :** `reference/original/photo_originale.jpg` (1280 × 1280 px), six bouteilles du même modèle sur deux rangs.
La v1, construite sur l'encart d'une planche générée, est archivée dans `REFERENCE_RATIO_TABLE_V1_ENCART.md`.

**Méthode :**
- Les trois bouteilles du premier rang (noire, bleue, rose) sont entièrement visibles. Chacune est redressée sur son propre axe avant la mesure. La perspective incline les axes : −1,1° pour la noire, −1,7° pour la bleue, −3,4° pour la rose.
- La **bleue** (centrée, bords nets) sert de mesure principale et de calque de validation : 649 px de BODY_HEIGHT, donc **1 px ≈ 0,0015 BODY_HEIGHT**.
- La **noire** et la **rose** servent au croisement des cotes verticales. Leurs largeurs sont biaisées : la noire perd ses bords éclairés à la segmentation, et la rose est décentrée, donc déformée par la perspective.
- Le rang arrière (jaune, orange, olive) est masqué en bas par le premier rang. Il ne sert qu'aux couleurs.
- La photo est prise en plongée. Les mesures dans l'image sont converties en 3D par la caméra calée (voir plus bas) : échelle radiale ×1,02, et correction verticale z' = 1,02·z − 0,026.

## Ratios mesurés dans l'image (avant conversion 3D)

| PROPERTY | MEASURED_RATIO | noire / bleue / rose | CONFIDENCE | SOURCE_AREA |
|---|---|---|---|---|
| BODY_WIDTH / BODY_HEIGHT | 0.3172 | 0.303 / 0.317 / 0.329 | HIGH (bleue) | flancs du corps droit, lignes 650–1100 |
| NECK_WIDTH / BODY_WIDTH | 0.695 | bleue | HIGH | col droit sous la bague, 6 % de haut |
| METAL_RING_HEIGHT / BODY_HEIGHT | 0.050 | 0.048 / 0.051 / 0.050 | HIGH | bande à fort contraste métallique |
| METAL_RING_WIDTH | = col (affleurante) | bleue | MEDIUM | contrôle visuel des bords (reflets) |
| CAP_TOP / BODY_HEIGHT | 1.163 | 1.163 / 1.163 / 1.164 | HIGH | axe, bord supérieur du bouchon |
| CAP_WIDTH / BODY_WIDTH (bas / haut) | 0.738 / 0.713 | bleue | MEDIUM-HIGH | lignes 504–510 / 450–453 |
| HANDLE_TOP / BODY_HEIGHT | 1.325 | — / 1.325 / 1.328 | HIGH | sommet de l'arc sur l'axe |
| HANDLE_WIDTH / BODY_WIDTH (extérieur) | 0.84 | bleue | MEDIUM | bras, lignes 462–471 |
| HANDLE_THICKNESS (sangle, radial) / BODY_HEIGHT | 0.015 | bleue | MEDIUM | bras gauche et droit, lignes 380–440 |
| HANDLE_DEPTH (largeur de sangle) / BODY_HEIGHT | 0.055 | — | **LOW** | non visible de face : REFERENCE_REQUIRED |
| HINGE (rivet) : rayon / BODY_HEIGHT | 0.0116 | bleue | MEDIUM-LOW | rivet argenté, côté droit |

## Master 3D (après conversion) — `data/photo/model_dims.json`

| Pièce | Rayon | Hauteur (z) |
|---|---|---|
| Corps | 0.1617 | 0 → 0.96 (épaulement 0.845 → 0.935, congé du fond 0.03) |
| Col | 0.1124 | 0.96 → 1.00 |
| Bague métallique | 0.1124 | 1.000 → 1.046 |
| Bouchon | 0.1194 en bas, 0.1153 en haut | 1.046 → 1.160 |
| Anse (sangle) | bras à 0.1364 | sommet 1.321, pivot 1.098 |
| Rivets (HINGE_L / R) | 0.0116 | centre 1.098 |

## Caméra de la photo (REF_CAMERA, calée par silhouette)

| Paramètre | Valeur | Confiance |
|---|---|---|
| Hauteur | 1.2 BODY_HEIGHT | MEDIUM |
| Distance | 5.0 BODY_HEIGHT | MEDIUM |
| Point visé | z = 0.7 (caméra plongeante) | MEDIUM |
| Échelle radiale | ×1.02 | MEDIUM |
| Correction verticale | z' = 1.02·z − 0.026 | MEDIUM |

## Données usine (TO_DEFINE_FACTORY)

`CAPACITY`, `BODY_HEIGHT_MM`, `BODY_DIAMETER_MM`, `MATERIAL_GRADE`, `WALL_THICKNESS`, finition réelle,
références Pantone, zones imprimables réelles, filetage, mécanisme de l'anse, largeur réelle de la sangle.
