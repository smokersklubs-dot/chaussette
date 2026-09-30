# SKLUBS_BOTTLE_MASTER — reconstruction 3D contrainte

Master 3D de la bouteille isotherme, reconstruit **depuis la référence uniquement**, dans Blender (5.0, en script).
Unité : **BODY_HEIGHT = 1.000** (fond → bas de la bague). Aucune cote usine : `TO_DEFINE_FACTORY`.

- Référence : `reference/ref_panel.png`, encart des six bouteilles de `reference/source_board.webp`.
- Ratios mesurés : [`REFERENCE_RATIO_TABLE.md`](REFERENCE_RATIO_TABLE.md).
- Erreurs mesurées par calque : [`PIXEL_CLOSE_ERROR_REPORT.md`](PIXEL_CLOSE_ERROR_REPORT.md).

## Livrables

| Fichier | Contenu |
|---|---|
| `export/SKLUBS_BOTTLE_MASTER.blend` | scène complète, collections du protocole, image de référence empaquetée, caméras, éclairage, variantes |
| `export/SKLUBS_BOTTLE_MASTER.glb` | master pleine résolution : 7 pièces, UV, zones d'impression, animation de l'anse |
| `export/SKLUBS_BOTTLE_WEB.glb` | même géométrie, compression Draco (~106 Ko). Côté Three.js, charger avec `DRACOLoader` |
| `export/SKLUBS_BOTTLE_UV.png` | gabarit du déroulé du corps : zones face / dos / 360°, axe, couture |
| `export/color_variants.json` | six teintes de validation (échantillonnées, indicatives) |
| `renders/` | vues front / back / left / right / top / 3q, macros bouchon et anse, anse rabattue, six couleurs, caméra de référence, calque 50/50 |
| `renders/checkpoints/` | calques A (corps), B (+ bague + bouchon), C (+ anse + pivots) : overlay 50/50, contours, erreurs par ligne |

## Structure Blender

```
SKLUBS_BOTTLE_MASTER
├── 00_REFERENCE   REF_IMAGE (empaquetée), CAM_REFERENCE (= REF_CAMERA)
├── 01_GEOMETRY    BODY, NECK, METAL_RING, CAP, HANDLE, HINGE_L, HINGE_R
├── 02_PRINT       PRINT_FRONT, PRINT_BACK, PRINT_WRAP_360 (non rendues, silhouette inchangée)
├── 03_MATERIALS   BODY_MAT_MASTER, METAL_RING_MAT, CAP_BLACK_MASTER, HINGE_MAT, BODY_<COULEUR>
├── 04_CAMERAS     CAM_REFERENCE, FRONT, BACK, LEFT, RIGHT, TOP, 3Q_LEFT, 3Q_RIGHT, DETAIL_CAP, DETAIL_HANDLE
├── 05_LIGHTING    KEY, FILL, RIM, FLOOR (capteur d'ombre), monde studio
└── 06_EXPORT      COLOR_VARIANTS_TEST (6 instances liées du même mesh)
```

- **Anse :** origine sur l'axe des pivots. L'action `HANDLE_UP_DOWN` passe de 0° (image 1, `HANDLE_UP`) à 90° vers l'arrière (image 24, `HANDLE_DOWN`). Les butées réelles restent REFERENCE_REQUIRED.
- **UV du corps :** u = 0,5 au centre de la face avant, couture à l'arrière ; v = hauteur en BODY_HEIGHT.
- **Zones d'impression :** partie droite du corps, z de 0,08 à 0,78. Face et dos couvrent 120° chacune. C'est une proposition géométrique, les dimensions réelles sont TO_DEFINE_FACTORY.

## Régénérer

```bash
pip install bpy==5.0.1          # Blender en module Python (rendu Cycles CPU)
cd scripts
python3 build_master.py C --out /tmp/sil      # silhouette de contrôle (étapes A, B ou C)
python3 compare.py /tmp/sil/sil_C.png C --out /tmp/sil   # calque + erreurs par zone
python3 make_master.py --render               # .blend, GLB, rendus (≈ 20 min CPU)
```

Les paramètres sont tous dans `data/params.json`. Les mesures brutes et leurs scripts sont dans `data/measure/` et `scripts/analysis/`.

## Protocole — état

| Étape | État |
|---|---|
| 01–02 Référence et ratios | fait, 3 bouteilles croisées |
| 03 REF_CAMERA | fait, caméra perspective calée par silhouette |
| 04–06 BODY + checkpoint A | validé : corps 0,26 px, épaulement 0,56 px, fond 0,81 px |
| 07–09 Bague + bouchon + checkpoint B | validé : bague 0,31 px, haut du bouchon −0,23 px |
| 10–12 Anse + pivots + checkpoint C | validé : largeur de l'anse 0,85 px, sommet −0,12 px |
| 13 Topologie | quads, pôles fusionnés, normales sortantes, arêtes vives au-delà de 40° |
| 14–15 Matériaux + 6 couleurs | fait, instances liées d'un seul mesh |
| 16–17 UV + zones d'impression | fait |
| 18 Caméras | fait, 10 caméras |
| 19–20 Master + web | fait |
