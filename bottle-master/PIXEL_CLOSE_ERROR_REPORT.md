# PIXEL_CLOSE_ERROR_REPORT — SKLUBS BOTTLE MASTER

Erreurs mesurées par superposition du rendu `CAM_REFERENCE` sur la bouteille bleue de la référence,
ligne par ligne, en **pixels de la référence** (1 px ≈ 0,43 % de BODY_HEIGHT). Calage vertical par
les deux repères qui définissent BODY_HEIGHT (fond et bas de la bague), aucun autre ajustement.
Preuves : `renders/checkpoints/` (calques 50/50, contours rouge = rendu / cyan = photo, erreurs JSON par ligne).

## Résultat par checkpoint (géométrie finale)

| Zone | Écart moyen | 90 % des lignes sous | Pire ligne | Lignes |
|---|---|---|---|---|
| Corps droit | 0,26 px | 0,34 px | 1,24 px | 181 |
| Épaulement | 0,56 px | 1,23 px | 2,07 px | 23 |
| Col | 0,84 px | 2,97 px | 4,95 px | 14 |
| Fond | 0,81 px | 1,54 px | 2,18 px | 12 |
| Bague métallique | 0,31 px | 0,34 px | 0,74 px | 15 |
| Bouchon, jupe basse | 0,78 px | 2,81 px | 3,22 px | 5 |
| Bouchon + bras + pivots | 0,76 px | 1,40 px | 1,85 px | 27 |
| Anse, largeur (hors décalage) | 0,85 px | — | — | 38 |
| Haut du bouchon, vertical | −0,23 px | — | — | axe |
| Haut de l'anse, vertical | −0,12 px | — | — | axe |

## CRITICAL — tous traités

| Point | État | Mesure |
|---|---|---|
| Silhouette générale | corrigé | corps 0,26 px, épaulement 0,56 px |
| Anse | corrigé | arc remonté de 0,0105 après calque C : sommet −0,12 px, largeur 0,85 px |
| Bouchon | corrigé | haut −0,23 px, flancs 0,76 px |
| Épaulement | corrigé | profil mesuré bruité remplacé par une Bézier tangente (plus de stries) : 0,71 → 0,56 px |
| Ratio global | corrigé | caméra refaite : la caméra téléobjectif inclinée donnait 2,3 px d'erreur d'épaulement et un bouchon 4 px trop haut ; caméra à plan vertical calée (hauteur 0,75, distance 8) |

## MAJOR

| Point | État | Détail |
|---|---|---|
| Position de la bague | OK | 0,31 px |
| Épaisseur de l'anse | OK | 0,85 px sur la largeur ; la profondeur de sangle reste LOW (non visible de face) |
| Transition du col | OK hors artefact | les lignes 114–115 de la photo sont assombries par l'ombre de la bague ; ce sont elles qui donnent le pire écart de 4,95 px. Sans elles : moins de 0,6 px |
| Rayon inférieur | OK | congé calé à 0,045 : 0,81 px moyen, les pics isolés venant de la pointe de l'ellipse du fond |

## MINOR

| Point | État | Détail |
|---|---|---|
| Anse décalée de 1,38 px vers la droite sur la photo | non reproduit, volontaire | une anse à pivot centrée ne peut pas se décaler latéralement ; incohérence de l'image, le modèle reste symétrique |
| Tête de pivot | acceptée | la photo montre une alternance large / étroite de ±1,3 px (lignes 77–92), à la limite de la compression ; modélisée en disque simple |
| Teinte du corps (bleu) | OK | rendu (123, 189, 223) contre photo (120, 191, 226) |
| Bords de la bague | incertitude | reflets des bouteilles voisines : bords connus à ±0,5 px |
| Micro-chanfreins (bague, anse, pivots) | non observables | chanfreins minimaux ajoutés pour le rendu, sans effet mesurable sur la silhouette |

## Limites de la validation

- La référence est un encart de planche, probablement déjà un rendu, et non la photo originale. Si la photo originale existe, relancer la chaîne dessus (`scripts/analysis/`).
- Le calque pixel est fait sur la bouteille bleue. Noire et rose ont servi au croisement des ratios (tableau des ratios), pas à un calque complet.
- Non visibles, donc **REFERENCE_REQUIRED** : largeur réelle de la sangle, mécanisme des pivots, dessus du bouchon, dessous du fond, filetage.

## Critère final

Rendu sous le même angle avec la même couleur (`renders/reference_match.png`), le contour du modèle suit celui de la photo
à moins d'un pixel en moyenne sur toutes les zones. Le produit est reconnaissable comme le même modèle, sans les couleurs
(`renders/checkpoints/overlay_50_C.png`). Seuls restent ouverts les points non observables listés ci-dessus.
