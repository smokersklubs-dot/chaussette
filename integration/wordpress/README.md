# Brancher le configurateur bouteille sur sklubs.fr

Le configurateur est un site statique. On l'héberge à part, puis on l'affiche dans une page WordPress.
Quand le client clique sur « Envoyer le projet », la page reçoit le projet complet (paramètres,
aperçu PNG, visuel) et l'enregistre dans l'admin WordPress.

## 1. Publier le configurateur

N'importe quel hébergement statique convient. Même méthode que le configurateur de cartes de visite :

- **Vercel** : importer le dépôt `chaussette`, branche `main`, sans commande de build, dossier racine `/`.
- Brancher un sous-domaine, par exemple `bouteille.sklubs.fr`.

## 2. Installer l'extension WordPress

Copier `sklubs-bottle-projects.php` dans `wp-content/mu-plugins/` (le dossier se crée s'il n'existe pas).
Elle ajoute :
- le menu **Projets bouteille** dans l'admin, avec l'aperçu, le visuel et la configuration de chaque projet ;
- un e-mail à l'adresse d'administration à chaque nouveau projet ;
- le point d'envoi `/wp-json/sklubs/v1/bottle-project`, protégé par un jeton WordPress.

Si une extension de cache met les pages en cache plus de 12 heures, exclure la page du configurateur :
le jeton expire au bout de 12 à 24 heures.

## 3. Créer la page

Dans une page WordPress, ajouter un bloc **HTML personnalisé** et y coller `sklubs-bottle-embed.html`,
en remplaçant `CONFIGURATOR_URL` par l'adresse du configurateur, par exemple
`https://bouteille.sklubs.fr/configurateur?produit=cricket-bottle`. L'accueil (`/`) liste tous les produits
et peut aussi être intégré tel quel.

## Sécurité

- Le configurateur n'envoie le projet qu'aux pages de `sklubs.fr` et `sklubs.com` (liste `PARENT_ORIGINS` dans `js/main.js`).
- La page n'accepte les messages que de l'adresse du configurateur.
- Le point d'envoi exige le jeton WordPress, limite la taille à 12 Mo et n'accepte que des images PNG ou JPEG.

## Plus tard : panier WooCommerce

Tant que les prix usine ne sont pas renseignés, le configurateur affiche « Validation usine requise »
et le projet part en demande de devis. Quand les prix existeront, la même page pourra créer
le produit dans le panier WooCommerce au lieu d'enregistrer un projet.
