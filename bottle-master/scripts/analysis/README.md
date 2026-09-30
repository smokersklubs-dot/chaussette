# Scripts de mesure de la référence

Exécution depuis un dossier contenant `ref_panel.png` (copie de `reference/ref_panel.png`), dans cet ordre :

1. `analyze.py` : calcule teinte / saturation / luminance (`hsl.npy`).
2. `measure2.py` : bords sub-pixel des bouteilles bleue et rose (`edges2.json`).
3. `measure_all.py` : axe, bague, bouchon, anse et profil des six bouteilles (`measure_all.json`).
4. `ratios.py` : profil médian du corps sur noire + bleue + rose (`body_profile.json`).
5. `params_build.py` : assemble les paramètres (base de `data/params.json`).

Les sorties de référence sont dans `data/measure/`. `data/params.json` contient en plus
les calages faits par comparaison de silhouettes (caméra, congé du fond, correction de l'anse).
