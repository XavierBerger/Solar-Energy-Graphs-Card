# Solar Energy Graphs Card

> **Carte en cours de développement.** La carte lit les capteurs configurés et
> affiche leur historique du jour en cours. Elle doit encore être validée sur
> plusieurs installations et ne signifie pas qu'elle est prête pour un usage
> quotidien.

La carte utilise presque toute la hauteur visible de l'écran, sous l'en-tête
Home Assistant. Les deux zones de graphique se partagent cet espace selon un
ratio de 70 % en haut et 30 % en bas. Les axes, graduations et grilles suivent
les couleurs du thème Home Assistant actif, y compris en thème sombre.

## Ce qu'il vous faut

- Un Home Assistant où vous pouvez modifier un tableau de bord.
- Un moyen d'ajouter un fichier dans le dossier `www` de la configuration
  Home Assistant (par exemple File editor, Samba ou SSH).
- Si vous construisez vous-même le fichier depuis le code source : **Podman**.
  Node.js et npm ne doivent pas être installés sur votre ordinateur.

Il n'y a pas encore de paquet HACS ni de fichier de release à télécharger. Le
fichier JavaScript doit donc être construit depuis le dépôt.

## 1. Construire le fichier de la carte

Récupérez le dépôt du projet sur une machine où Podman est disponible, puis
ouvrez un terminal dans le dossier `solar-energy-graphs-card/` :

```sh
./dev.sh build
```

Cette commande télécharge/utilise l'image de développement et construit la
carte dans un conteneur Podman. Les dépendances sont gardées dans un volume
Podman persistant : elles ne sont pas installées sur l'hôte et ne sont pas
retéléchargées à chaque compilation, sauf si le fichier de dépendances change.

Le fichier à installer est créé ici :

```text
solar-energy-graphs-card/dist/solar-energy-graphs-card.js
```

Si vous utilisez l'environnement de développement fourni avec ce dépôt et son
Home Assistant `ha-dev`, vous pouvez plutôt exécuter :

```sh
./dev.sh deploy
```

Cela construit la carte et copie le fichier dans
`docker/ha-config/www/solar-energy-graphs-card.js`. Ce raccourci est destiné à
l'instance `ha-dev` de ce dépôt. Pour une autre installation Home Assistant,
copiez le fichier `dist/solar-energy-graphs-card.js` vous-même.

Pour exécuter les tests unitaires du projet dans le même environnement Podman :

```sh
./dev.sh test
```

## 2. Copier le fichier dans Home Assistant

Dans le dossier de configuration de Home Assistant, créez le dossier `www` s'il
n'existe pas. Copiez-y le fichier JavaScript en conservant son nom :

```text
<configuration Home Assistant>/www/solar-energy-graphs-card.js
```

Par exemple, si votre dossier de configuration est `/config`, le chemin est :

```text
/config/www/solar-energy-graphs-card.js
```

Home Assistant expose les fichiers de ce dossier sous `/local/`. Vous pouvez
vérifier dans un navigateur que cette adresse ouvre ou télécharge le JavaScript :

```text
http://<adresse-de-votre-home-assistant>:8123/local/solar-energy-graphs-card.js
```

Remplacez `<adresse-de-votre-home-assistant>` par le nom ou l'adresse IP de
votre Home Assistant. Si vous obtenez une erreur 404, vérifiez le nom et
l'emplacement du fichier.

## 3. Déclarer la ressource Lovelace

Dans Home Assistant :

1. Ouvrez **Paramètres → Tableaux de bord**.
2. Ouvrez le menu de gestion des ressources (selon la version, il se trouve
   dans le menu `⋮` ou dans la page des tableaux de bord).
3. Choisissez **Ajouter une ressource**.
4. Dans le champ URL, saisissez ce chemin **sans `/` au début** :

   ```text
   local/solar-energy-graphs-card.js
   ```

5. Choisissez le type **JavaScript module**, puis enregistrez.

   Home Assistant demande ici un chemin de ressource relatif. Dans la barre
   d'adresse du navigateur, le même fichier reste accessible avec une barre
   oblique initiale : `http://<adresse-de-votre-home-assistant>:8123/local/solar-energy-graphs-card.js`.

## 4. Créer un tableau de bord dédié et y ajouter la carte

Pour garder cette carte séparée de votre tableau de bord principal, créez-en un
nouveau :

1. Ouvrez **Paramètres → Tableaux de bord**.
2. Choisissez **Ajouter un tableau de bord**.
3. Parmi les choix proposés, sélectionnez **Nouveau tableau de bord vide**.
   C'est le bon choix pour créer un tableau de bord que vous pourrez configurer
   dans l'interface. Ne choisissez pas **Aperçu (ancienne version)**, **Carte**
   ou **Page web** : ces options ne créent pas un tableau de bord Lovelace vide
   destiné à recevoir vos cartes.
4. Donnez au tableau de bord un titre, par exemple **Énergie solaire**, puis
   choisissez une URL (chemin) dédiée, par exemple `energie-solaire`, si ces
   champs sont proposés.
5. Terminez la création et ouvrez le nouveau tableau de bord. Choisissez
   **Modifier le tableau de bord**.
6. Ajoutez une carte **Manuelle** et remplacez son contenu par :

   ```yaml
   type: custom:solar-energy-graphs-card
   entities:
     production: sensor.solarnet_puissance_photovoltaique
     consumption: sensor.solarnet_puissance_consommee_par_la_charge
     grid_import: sensor.solarnet_puissance_importee_du_reseau
     grid_export: sensor.solarnet_puissance_exportee_vers_le_reseau
   ```

7. Enregistrez la carte, puis le tableau de bord si Home Assistant le demande.

La carte attend :

- `production` : puissance instantanée produite par les panneaux ;
- `consumption` : puissance instantanée consommée par la charge ;
- `grid_import` : puissance importée du réseau ;
- `grid_export` : puissance exportée vers le réseau.

Les quatre capteurs doivent mesurer une puissance avec `device_class: power`,
`state_class: measurement` et une unité `W` ou `kW`. Import et export utilisent
des capteurs séparés ; la carte ne déduit pas l'un à partir de l'autre.

La carte utilise l'historique Home Assistant du jour dans le fuseau configuré
et calcule la moyenne des mesures par intervalles de cinq minutes.
L'autoconsommation directe est estimée comme le minimum entre la production PV
et la puissance consommée par la charge ; cette formule suppose l'absence de
batterie. La légende supérieure affiche **Production solaire**,
**Consommation** et **Autoconsommation**. Le graphe inférieur montre l'export
au-dessus de zéro et l'import au-dessous. Le curseur et le zoom horizontal
sont synchronisés.

La carte signale dans chaque graphe si son historique est indisponible. Les
capteurs doivent avoir un historique enregistré par Home Assistant pour le
jour courant. Le tableau de bord principal n'est pas modifié.

## Dépannage

- **« Custom element doesn't exist »** : vérifiez que la ressource est ajoutée
  avec le type **JavaScript module**, que le champ URL contient
  `local/solar-energy-graphs-card.js` sans barre oblique initiale, puis
  actualisez la page.
- **« Erreur de configuration »** : vérifiez dans
  **Paramètres → Tableaux de bord → Ressources** qu'une ressource utilisant
  exactement `local/solar-energy-graphs-card.js` (sans `/` au début) est
  enregistrée avec le type **JavaScript module**. Une autre carte ou un ancien
  nom de fichier ne charge pas cet élément personnalisé. Supprimez l'ancienne
  ressource si nécessaire, ajoutez le bon chemin, puis rechargez le tableau de
  bord en forçant l'actualisation du navigateur.
- **Erreur 404 sur l'URL `/local/...`** : vérifiez que le fichier se trouve dans
  le dossier `www` de la configuration Home Assistant et que son nom est
  exactement `solar-energy-graphs-card.js`.
- **Vous voyez une ancienne version** : forcez le rechargement du navigateur
  (par exemple `Ctrl+F5` ou `Cmd+Maj+R`), puis vérifiez que la ressource a été
  enregistrée.
- **« Configure entities… »** : vérifiez que les quatre clés `production`,
  `consumption`, `grid_import` et `grid_export` sont présentes dans le YAML.
- **Aucun historique affiché** : vérifiez que les identifiants sont corrects,
  que les capteurs ont les unités et classes d'état attendues, et que Home
  Assistant a conservé leur historique pour aujourd'hui.
- **Les puissances ne semblent pas cohérentes** : vérifiez les quatre entités,
  leur unité (`W` ou `kW`) et que la consommation correspond à la charge de la
  maison. L'autoconsommation estimée ne prend pas en compte une batterie.

Pour retirer le prototype, supprimez la carte du tableau de bord, retirez sa
ressource Lovelace et, si vous le souhaitez, supprimez le fichier
`www/solar-energy-graphs-card.js`.
