# Configurateur SKLUBS : sous-domaine + WordPress / WooCommerce

```
bouteille.sklubs.fr (Vercel, pleine page, sans iframe)        sklubs.fr (WordPress + WooCommerce)
  accueil + configurateur 3D  ── /wp-json/sklubs/v1/* (relais Vercel) ──▶  produits, prix, devis
  « Commander »               ── formulaire POST /?sklubs-cart=1 ────────▶  panier WooCommerce → commande
```

- **Données** : dans WordPress (extension « SKLUBS Configurateur ») : produits, variantes, matières, couleurs,
  techniques, paliers de prix, délai, catégories, projets clients. Admin : menu **Configurateur**.
- **Configurateur** : uniquement sur **https://bouteille.sklubs.fr** (projet Vercel `sklubs-configurateur`).
  La page `sklubs.fr/configurateur-3d/` redirige vers lui ; le code court `[sklubs_configurateur]` affiche un
  bouton vers lui (`produit="cricket-bottle"` pour ouvrir directement un modèle, `texte="…"` pour le libellé).
- **Lecture des données** : `vercel.json` relaie `/wp-json/sklubs/v1/*` vers sklubs.fr (l'hébergement de sklubs.fr
  retire l'en-tête CORS pour les autres domaines ; le relais évite le problème).
- **Devis** : envoyés à `/wp-json/sklubs/v1/project` (origine *.sklubs.fr vérifiée), visibles dans
  **Configurateur → Projets clients**, e-mail à l'administrateur.
- **Commander** (actif seulement si le prix est confirmé) : formulaire envoyé à `https://sklubs.fr/?sklubs-cart=1`.
  Le site recalcule le prix, enregistre le projet et ajoute au panier un produit support caché
  « … — personnalisée » (créé automatiquement, non achetable autrement), puis affiche le panier. Le détail
  (référence, couleurs, marquage, aperçu) suit l'article jusqu'à la commande.

## Installer / mettre à jour l'extension

1. `python3 tools/build_wp_plugin.py` → `dist/sklubs-configurator.zip`.
2. WordPress : **Extensions → Ajouter → Téléverser**, puis **Remplacer l'actuelle par la version téléversée**.
3. Vider le cache (LiteSpeed Cache → Purger tout).

Réglages (**Configurateur → Réglages**) : adresse du configurateur (vide = `https://bouteille.sklubs.fr/`).
Les prix sont appliqués tels quels dans WooCommerce : les saisir HT si la boutique est réglée en HT.

## Sous-domaine

- Vercel : projet `sklubs-configurateur`, relié au dépôt GitHub (chaque push est déployé), domaine `bouteille.sklubs.fr`.
- Cloudflare (DNS de sklubs.fr) : `CNAME bouteille → (valeur indiquée par Vercel)`, **DNS only** (nuage gris).

## Option Supabase

Le code Supabase (`supabase/`) reste disponible : base séparée, back-office `admin.html`. Non utilisé aujourd'hui
(choix : données dans WordPress). Voir `supabase/README.md`.

## Sécurité

- Lecture publique limitée au catalogue et aux fiches **en ligne** (les brouillons restent privés).
- Écriture (produits, catégories) réservée aux administrateurs (`manage_options`, jeton REST).
- Devis et commandes : origine `sklubs.fr` ou sous-domaine obligatoire, 12 Mo maximum, seuls les vrais fichiers
  PNG / JPEG sont gardés, prix toujours recalculé côté serveur.
