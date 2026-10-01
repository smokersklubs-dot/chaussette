# Brancher le configurateur sur sklubs.fr (WordPress)

Le configurateur est un site statique, hébergé à part (Vercel). WordPress sert de **back-office** :
produits, variantes, prix, paliers de quantité, catégories, et réception des projets clients.

```
WordPress (extension SKLUBS Configurateur)          Configurateur (Vercel)
  Admin → Configurateur → Produits   ──GET /catalog, /products/<id>──▶  accueil + configurateur 3D
  Admin → Configurateur → Projets    ◀──POST /project (via la page qui l'intègre)──
```

## 1. Publier le configurateur

Voir « Mettre en ligne » dans le `README.md` à la racine (Vercel, sous-domaine `bouteille.sklubs.fr` par exemple).

## 2. Installer l'extension

1. Zipper le dossier `sklubs-configurator/` puis **Extensions → Ajouter → Téléverser**,
   ou le copier dans `wp-content/plugins/`.
2. Activer **SKLUBS Configurateur**. La bouteille Cricket et les catégories sont créées automatiquement
   (sans prix : aucun prix n'est inventé).
3. **Configurateur → Réglages** : renseigner l'adresse du configurateur (bouton « Voir » de l'admin).

## 3. Relier le configurateur à WordPress

C'est déjà fait dans le dépôt : `index.html` et `configurateur.html` contiennent

```html
<meta name="sklubs-api" content="https://sklubs.fr/wp-json/sklubs/v1">
```

Tant que l'extension n'est pas installée (ou si l'API ne répond pas), le configurateur lit les fichiers
`products/` du dépôt : rien ne casse. Vider la balise pour ne plus utiliser WordPress.

## 4. Gérer les produits (admin → Configurateur → Produits)

| Onglet | Contenu |
|---|---|
| Général | Nom, identifiant, catégorie, vignette, sous-titre, tags, ordre à l'accueil, statut (en ligne / brouillon) |
| Variantes | Capacités / formats, zone imprimable, modèle 3D par variante si différent |
| Matières & finitions | Matières, finitions, finitions de bague, suppléments € / u |
| Couleurs & pièces | Nuancier, pièces colorables, couleurs par défaut |
| Marquage | Techniques, zones, frais de calage et prix par unité |
| Prix & quantités | Paliers par variante (à partir de N pièces → prix € / u, badge « le plus choisi »), MOQ, délai, simulation |
| Avancé (JSON) | Fiche complète, import / export |

- **Nouveau modèle** : « Dupliquer » un produit existant ou « Nouveau produit », puis changer le modèle 3D
  (`.glb` téléversable dans la médiathèque, voir plus bas).
- **Prix vide = sur devis** : le configurateur affiche « Validation usine requise ».
  Dès qu'un palier est rempli, il affiche le prix instantané et le tableau des paliers.
- Le prix unitaire = palier de base + suppléments (matière, finition, bague, marquage) + calage ÷ quantité.

## 5. Créer la page du site

Dans une page WordPress (par exemple `/configurateur/`), ajouter un bloc **HTML personnalisé** et y coller
`sklubs-bottle-embed.html` tel quel : il affiche `https://bouteille.sklubs.fr/` (accueil et tous les produits).
Pour ouvrir directement la bouteille : `https://bouteille.sklubs.fr/configurateur?produit=cricket-bottle`.

Quand le client clique sur « Envoyer le projet », le projet (paramètres, aperçu PNG, visuel) arrive dans
**Configurateur → Projets clients** avec une référence `PRJ-…`, et un e-mail part à l'adresse d'administration.

Si une extension de cache garde les pages plus de 12 heures, exclure cette page :
le jeton WordPress expire au bout de 12 à 24 heures.

## Modèles 3D dans la médiathèque

L'extension autorise le téléversement de `.glb` / `.gltf` aux administrateurs. Le configurateur étant sur un
autre domaine, le serveur doit renvoyer `Access-Control-Allow-Origin` pour ces fichiers, par exemple
(Apache, `.htaccess` dans `wp-content/uploads/`) :

```apache
<FilesMatch "\.(glb|gltf)$">
  Header set Access-Control-Allow-Origin "*"
</FilesMatch>
```

Sinon, garder les modèles dans le dépôt du configurateur (`bottle-master/export/…`) et y mettre le chemin relatif.

## Sécurité

- Lecture publique limitée au catalogue et aux fiches **en ligne** (les brouillons restent privés).
- Écriture (produits, catégories) réservée aux administrateurs (`manage_options`, jeton REST).
- Envoi de projet : jeton WordPress obligatoire, 12 Mo maximum, seuls les vrais fichiers PNG / JPEG sont gardés.
- Le configurateur n'envoie le projet qu'aux pages de `sklubs.fr` et `sklubs.com` (`PARENT_ORIGINS` dans `js/main.js`),
  et la page n'accepte les messages que de l'adresse du configurateur.

## Plus tard : panier WooCommerce

Le projet contient déjà le prix calculé. Quand les prix seront validés, la même page pourra créer
l'article dans le panier WooCommerce au lieu d'enregistrer une demande de devis.
