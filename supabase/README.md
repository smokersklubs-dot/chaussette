# Backend Supabase — configurateur SKLUBS

Base de données principale : produits, **prix** (paliers par quantité, suppléments, frais de calage),
catégories, **projets clients** (devis, commandes, projets enregistrés) et fichiers (aperçus, visuels, logos).

| Élément | Rôle |
|---|---|
| `migrations/20261001120000_sklubs_configurator.sql` | Tables, sécurité (RLS), fonctions RPC, stockage |
| `seed.sql` | Données de départ (produits du dépôt, **sans prix**) — `python3 tools/supabase_seed.py` |
| `functions/submit/` | Fonction Edge : reçoit les projets, recalcule le prix, stocke les images, relie les commandes WooCommerce |
| `functions/_shared/pricing.js` | Copie du moteur de prix du configurateur (`python3 tools/supabase_sync.py`) |

## Tables

- `products` : fiche produit (`data`, même format que `products/<id>/product.json`), statut `draft` / `publish`,
  devise, mode de prix, mention HT/TTC, MOQ, délai.
- `price_tiers` : paliers (`variant_id`, `min_qty`, `unit_price`, `popular`). Prix vide = sur devis.
- `price_options` : suppléments par unité et frais (`material`, `finish`, `ring`, `method`, `setup`, `custom_color`…).
- `categories`, `projects`, `admins`.

Les prix se modifient dans le back-office (`admin.html`) ou directement dans l'éditeur de tables Supabase.

## Sécurité

- Visiteurs (clé anon) : lecture des produits **en ligne** et du catalogue (`rpc/catalog`, `rpc/product`), rien d'autre.
- Administrateurs : comptes Supabase Auth listés dans `admins` → écriture produits, prix, catégories, lecture des projets.
- Projets : écrits uniquement par la fonction `submit` (clé service), depuis les domaines SKLUBS (CORS) ou le site WordPress.
- Le prix d'une commande est **toujours recalculé côté serveur** ; une commande sans prix confirmé est refusée (devis).

## Mise en ligne

1. Créer un projet Supabase (région Europe, ex. `eu-west-3` Paris).
2. Appliquer la migration puis `seed.sql` (éditeur SQL ou `supabase db push`).
3. Déployer la fonction : `supabase functions deploy submit`.
   Secrets (optionnels) : `SKLUBS_ALLOWED_HOSTS` (défaut `sklubs.fr,sklubs.com`), `SKLUBS_SHARED_SECRET`
   (même valeur dans WordPress → Configurateur → Réglages), `SKLUBS_NOTIFY_WEBHOOK` (alerte à chaque projet).
4. Créer le compte administrateur (Authentication → Users → Add user), puis :
   `insert into public.admins (user_id) select id from auth.users where email = 'votre@email';`
5. Renseigner l'URL du projet et la clé **anon** dans les balises `sklubs-supabase` / `sklubs-supabase-key`
   de `index.html`, `configurateur.html` et `admin.html`, puis reconstruire l'extension :
   `python3 tools/build_wp_plugin.py`.

## Tests

- Fonction : `deno test --allow-read --allow-env --allow-net supabase/functions/submit/index_test.ts`
- La migration est rejouable (idempotente).
