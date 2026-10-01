# PIXEL_CLOSE_ERROR_REPORT — SKLUBS BOTTLE MASTER (v2, photo originale)

Écart entre le contour du rendu `CAM_REFERENCE` et celui de la bouteille bleue de la photo originale, ligne par ligne,
en **pixels de la photo** (1 px ≈ 0,15 % de BODY_HEIGHT). Calage vertical par les deux repères qui définissent BODY_HEIGHT
(fond et bas de la bague). Preuves : `renders/photo_checkpoints/` (calques 50/50, contours rouge = rendu / cyan = photo,
erreurs par ligne en JSON).

## Résultat final (checkpoint C : géométrie complète)

| Zone | Écart moyen | 90 % des lignes sous | % de BODY_HEIGHT |
|---|---|---|---|
| Corps droit | 0,64 px | 1,37 px | 0,10 % |
| Bague métallique | 0,60 px | 0,90 px | 0,09 % |
| Col | 0,79 px | 1,75 px | 0,12 % |
| Épaulement | 0,92 px | 1,67 px | 0,14 % |
| Fond | 2,21 px | 4,54 px | 0,34 % |
| Bouchon, jupe basse | 2,71 px | 5,68 px | 0,42 % |
| Bouchon + bras + rivets | 2,62 px | 4,68 px | 0,40 % |
| Anse (contour complet) | 3,08 px | 4,50 px | 0,47 % |
| Anse, largeur (hors décalage) | 1,13 px | — | 0,17 % |
| Haut du bouchon, vertical | −0,60 px | — | — |
| Haut de l'anse, vertical | +0,13 px | — | — |

Le checkpoint A (corps seul) est moins bon à l'épaulement (4 px) : sans la bague, son repère « bas de la bague » se lit
sur un autre bord. Les checkpoints B et C, avec la vraie bague, utilisent le même repère que la photo.

## CRITICAL — traités

| Point | Mesure |
|---|---|
| Silhouette générale | corps 0,64 px, épaulement 0,92 px |
| Anse | largeur 1,13 px, sommet 0,13 px |
| Bouchon | haut 0,60 px |
| Ratio global | caméra plongeante calée ; échelle radiale ×1,02 et correction verticale pour la plongée |

## MAJOR

| Point | État |
|---|---|
| Position de la bague | 0,60 px |
| Épaisseur de l'anse | largeur 1,13 px ; la largeur de sangle (profondeur) reste LOW |
| Transition du col | 0,79 px |
| Rayon inférieur | congé 0,03, écart moyen 2,2 px : l'ombre au sol et le pied transparent se mêlent au bord du fond |

## MINOR

| Point | Détail |
|---|---|
| Anse tournée sur la photo | décalage moyen de 1,5 px et bras gauche plus épais : la sangle est légèrement pivotée sur la photo. Le modèle reste en position de référence, symétrique |
| Rivets | la tête argentée n'est pas captée par le contour sombre ; seuls la languette de sangle et le pivot sont calés |
| Distorsion de l'objectif | la largeur de la bleue varie de 202 à 206 px sur la hauteur (objectif de téléphone) : non modélisée, elle reste dans l'écart du corps |
| Couleurs | échantillonnées sur la photo (zones éclairées), indicatives |

## Non observable : REFERENCE_REQUIRED

Largeur réelle de la sangle, mécanisme et butées des pivots, dessus du bouchon (seul son contour est visible),
dessous du fond, filetage.
