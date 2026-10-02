# Publication HACS de Solar Energy Graphs Card

## Contexte

La carte fonctionne, mais on ne peut pas encore l'installer depuis HACS :
il n'y a pas de `hacs.json`, aucune release GitHub ne porte le bundle (`dist/`
est gitignoré), le dépôt n'a ni description ni topics, et `main` ne contient
que le commit de licence (`2e99000`). Tout le travail est sur
`feat/solar-energy-graphs-card`, 122 commits devant `main`. Le README, déjà en
anglais, reste une notice courte : il omet plusieurs fonctions visibles et ne
montre aucune animation.

Résultat visé : une v1.0.0 installable depuis le magasin HACS par défaut, avec
un README anglais qui sert de manuel utilisateur complet (texte, captures, GIF
par fonctionnalité, vidéo de présentation) et qui donne envie d'installer la
carte.

## Décisions prises

- Versions : `v0.1.0` (déjà dans `package.json:3`) pour le premier test HACS,
  puis d'éventuelles `0.x`, puis `v1.0.0` et la PR vers `hacs/default`.
  **Pas de pré-version avant la première release complète** : HACS ne remplit
  `last_version` qu'à partir des releases complètes et, à défaut, retombe sur
  `self.data.default_branch or "main"` (`hacs/integration`,
  `repositories/base.py`). Or `main` ne contient pas le bundle, donc l'ajout du
  dépôt échouerait.
- Médias : un GIF court par fonctionnalité, visible sur GitHub et dans HACS ;
  `docs/videos/overview.mp4` téléversée par vous comme pièce jointe GitHub
  (lecteur intégré sur GitHub, simple lien dans HACS), **non commitée**.
- Clips : vous les enregistrez dans votre HA, je les convertis en GIF.
- Traduction française : après la v1.0, hors de ce plan.

## Constats qui conditionnent le plan

- `AGENTS.md:5-9` pointe vers `solar-energy-graphs-card/`, que `756212b`
  (« move solar-energy-graphs-card/* to repo root ») a supprimé.
- `AGENTS.md:56` : « the card README and `docs/TODO.md` stay in French ». Cela
  contredit votre demande et `CONTRIBUTION.md:59-60` (« The user-facing README
  is in English for HACS »).
- `docs/architecture.md:319` : « [README](../README.md) -- installation and
  configuration (French) » est faux.
- `dev.sh:5` (`REPO_ROOT=$SCRIPT_DIR/..`) et `dev.sh:87` : `deploy` copie le
  bundle vers `/workspace/docker/ha-config/www`, qui n'existe pas. L'instance
  `ha-dev` est restée dans `Solar-Router-for-ESPHome-Card/docker/`. Le même
  chemin périmé figure dans `docs/architecture.md:273`. **Hors plan** : le test
  passera par HACS. Je l'ajoute comme tâche dans `docs/TODO.md`.
- Fonctions absentes du README actuel : le bouton « Return to today »
  (`src/solar-energy-graphs-card.ts:374`), la bascule haute précision
  (`:726-735`), la bande min-max (« Power statistics: mean line with min–max
  range. », `:907`), ainsi que le zoom à la molette et la réinitialisation par
  double-clic (`docs/architecture.md:234-239`).
- HACS supprime les images en chemin relatif et lit le README **au tag de la
  release** (`base.py` : `target_version = self.data.last_version or ...`).
  Conséquences :
  - toutes les images et tous les liens du README seront absolus, sous la forme
    `https://raw.githubusercontent.com/XavierBerger/Solar-Energy-Graphs-Card/main/docs/images/<fichier>`
    pour les images et `https://github.com/XavierBerger/Solar-Energy-Graphs-Card/blob/main/...`
    pour les liens ;
  - un README publié n'est corrigé dans HACS qu'à la release suivante ;
  - un fichier image publié ne doit jamais être renommé ni supprimé.
- `hacs.json` doit déclarer `filename` : sans cette clé, HACS cherche
  `Solar-Energy-Graphs-Card.js`, et la comparaison est exacte et sensible à la
  casse (`repositories/plugin.py` : `if filename == asset.name`). Le build
  produit `solar-energy-graphs-card.js` (`vite.config.ts:17`).
- `hacs/action` valide la ref poussée, y compris un tag. Avec un simple
  `push:`, la validation ferait la course avec la création de la release. Elle
  échouera tant qu'il n'existe ni release complète portant le bundle, ni
  description, ni topics.

## Étapes

Chaque étape se termine par un compte rendu : ce qui a changé, ses limites,
les tests HA à faire, puis j'attends votre retour. Les fichiers sont ajoutés
nommément, en un commit par thème, au format Conventional Commits en anglais.

### Étape 1 -- Aligner la doc développeur (avant v0.1.0)

- `AGENTS.md:5-9` : retirer le préfixe `solar-energy-graphs-card/` (le
  périmètre devient la carte de ce dépôt ; les liens visent `docs/TODO.md` et
  `docs/architecture.md`).
- `AGENTS.md:56` : le README reste en anglais (c'est le manuel utilisateur
  HACS) et `docs/TODO.md` reste en français.
- `docs/architecture.md:319` : remplacer « (French) » par « user manual:
  installation, configuration and usage ».
- Commit `docs: align agent docs with the standalone repository`.
- `docs/TODO.md`, section « Release » : sous-items pour `hacs.json` + CI,
  workflow de release, README manuel, v0.1.0 testée via HACS, médias (v0.2.0),
  v1.0.0 + PR `hacs/default` ; plus une tâche « `./dev.sh deploy` vise
  `../docker/ha-config/www`, hors du dépôt depuis `756212b` : définir la
  cible ».
- Commit `docs(todo): track the HACS release steps`.

### Étape 2 -- Manifeste HACS et validation (avant v0.1.0)

- Nouveau `hacs.json` :
  `{"name": "Solar Energy Graphs Card", "filename": "solar-energy-graphs-card.js"}`.
  Pas de clé `homeassistant`, faute de version minimale établie.
- Commit `build: add the HACS manifest`.
- Nouveau `.github/workflows/validate.yml` : `hacs/action@main`,
  `category: plugin`. Déclencheurs : `push: branches: [main]`, `pull_request`,
  `schedule` (quotidien) et `workflow_dispatch`, avec `permissions: {}`.
  Échec attendu, et annoncé, tant que la v0.1.0 n'est pas publiée.
- Commit `ci: validate the repository with the HACS action`.

### Étape 3 -- Workflow de release (avant v0.1.0)

- Nouveau `.github/workflows/release.yml`, déclenché par `push: tags: ["v*"]`,
  avec `permissions: contents: write`, en reprenant les conventions de
  `ci.yml:15-31` (`ubuntu-latest`, étape « Install Podman », `./dev.sh`).
  - Job `release` :
    1. `actions/checkout@v4` ;
    2. installation de Podman ;
    3. contrôle `test "${GITHUB_REF_NAME#v}" = "$(jq -r .version package.json)"`,
       qui échoue bruyamment en cas d'écart ;
    4. `./dev.sh build`, puis `./dev.sh test` ;
    5. `gh release create "$GITHUB_REF_NAME" dist/solar-energy-graphs-card.js --verify-tag --generate-notes`,
       avec `--prerelease` si le tag contient `-`, et
       `env: GH_TOKEN: ${{ github.token }}`.
  - Job `validate-hacs`, avec `needs: release` : `hacs/action@main` sur le tag.
    Un trigger `on: release` ne marcherait pas, car une release créée avec
    `GITHUB_TOKEN` ne déclenche aucun autre workflow.
- `CONTRIBUTION.md` : nouvelle section « Releasing », placée avant
  « Architecture » :
  1. mettre à jour `version` dans `package.json:3` et dans
     `package-lock.json:3,9` ;
  2. commiter `chore(release): X.Y.Z` ;
  3. fusionner dans `main`, puis lancer `git tag -a vX.Y.Z` et
     `git push origin vX.Y.Z` ;
  4. retenir que HACS affiche le README du tag, et qu'un tag contenant `-`
     n'est utilisable qu'une fois une release complète publiée.
- Commit `ci: publish the card bundle on version tags`.

### Étape 4 -- README manuel utilisateur, texte (pour v0.1.0)

Réécriture complète de `README.md` en anglais, avec les images existantes
(`docs/images/Solar-Energy-Graph-Card_light.png`, `..._dark.png`,
`Solar-Energy-Graphs-Card_configuration.png`, noms inchangés) et l'URL de la
vidéo si vous l'avez déjà téléversée. Chaque affirmation est vérifiée dans le
code ou dans `docs/architecture.md`. Ce qui n'a pas encore été vu dans HA
(gestes tactiles, mobile) ne sera écrit qu'après votre confirmation.

1. **En-tête**
   - Titre, puis les badges HACS Custom (Default après inclusion), release, CI
     et licence.
   - Une phrase d'accroche, la capture claire, puis la vidéo sur sa propre
     ligne.
   - « Highlights » : production et consommation avec l'autoconsommation
     estimée ; export et import de part et d'autre de zéro ; curseur et zoom
     synchronisés ; moyenne et bande min-max ; haute précision ; mise à jour en
     direct ; navigation par jour ; thème HA ; éditeur visuel.
2. **Requirements**
   - Les 4 capteurs : `device_class: power`, `state_class: measurement`, unité
     `W` ou `kW` (`home-assistant-energy-history.ts:569,573`).
   - L'historique du recorder, avec l'effet de `purge_keep_days`.
3. **Installation**
   - HACS :
     - le bouton My Home Assistant
       `https://my.home-assistant.io/redirect/hacs_repository/?owner=XavierBerger&repository=Solar-Energy-Graphs-Card&category=plugin` ;
     - les étapes « Custom repositories » (type Dashboard), en attendant
       l'inclusion par défaut ;
     - l'ajout automatique de la ressource ;
     - le rafraîchissement du navigateur.
   - Manuel : télécharger le fichier depuis la dernière release, le copier dans
     `/config/www/`, puis ajouter la ressource `/local/solar-energy-graphs-card.js`
     (type JavaScript module).
4. **Adding the card**
   - L'éditeur visuel, avec la capture de configuration.
   - Le YAML, avec un tableau des options : `type` et
     `entities.production|consumption|grid_import|grid_export`, toutes
     requises.
5. **Reading the graphs**
   - Les séries, les couleurs et la légende des deux graphes (couleurs relevées
     dans `energy-charts-renderer.ts`, `mainData` et `gridData`, d'après
     `docs/architecture.md:196-221`).
   - La ligne zéro.
   - Les valeurs import et export affichées dans la légende au curseur.
6. **Exploring a day**
   - Zoom : glisser pour zoomer, puis glisser pour déplacer ; molette ;
     double-clic pour revenir à la journée ; le zoom est conservé pendant les
     mises à jour.
   - Navigation : jours précédent et suivant, « Return to today », fuseau de HA,
     journées de 23 h et 25 h.
   - High precision : quand le bouton apparaît, ce qu'il charge, et ses
     limites (`docs/architecture.md:174-178`).
   - Aujourd'hui : les courbes s'arrêtent à l'instant présent, les états
     arrivent en direct et les statistiques sont rafraîchies toutes les
     5 minutes.
7. **Where the data comes from**
   - Statistiques à 5 minutes, puis horaires au-delà de `purge_keep_days`.
   - États bruts.
   - Conversion `W` / `kW`.
   - Autoconsommation estimée par `min(production, consumption)`, sans
     batterie.
8. **Themes and layout** : capture sombre et taille de la carte.
9. **Troubleshooting** : tableau message, cause, remède, avec les messages
   cités mot pour mot :
   - « Custom element doesn't exist » ;
   - `Sensor configuration error: ...` (`:499`) ;
   - `History loading error: ...` (`:901`) ;
   - `Error: <day> ... history is unavailable.` (`:908`, `:912`) ;
   - `Waiting for Home Assistant data.` (`:94`) ;
   - le bouton haute précision absent (faux négatif possible).
10. **FAQ** : batterie, capteurs d'énergie en kWh (non pris en charge : il faut
    des capteurs de puissance).
11. **Contributing** (lien absolu vers `CONTRIBUTION.md`) et **License**
    (GPL-3.0).

Commit `docs(readme): rewrite the README as the user manual`.

**Jalon v0.1.0.** De votre côté :

1. définir la description et les topics du dépôt ;
2. fusionner dans `main` ;
3. poser et pousser le tag `v0.1.0` ;
4. faire le test HACS (voir Vérification).

Les correctifs éventuels donnent des `0.1.x`.

### Étape 5 -- Médias (pour v0.2.0, après vos enregistrements)

Clips de 5 à 10 s, fenêtre d'environ 1650 px de large comme les captures
existantes, thème clair, pointeur visible, aucune donnée personnelle à
l'écran :

| Fichier (`docs/images/`)                      | Contenu                                                          |
| --------------------------------------------- | ---------------------------------------------------------------- |
| `Solar-Energy-Graphs-Card_zoom.gif`           | glisser pour zoomer, glisser pour déplacer, molette, double-clic |
| `Solar-Energy-Graphs-Card_day-navigation.gif` | jour précédent, jour suivant, retour à aujourd'hui               |
| `Solar-Energy-Graphs-Card_high-precision.gif` | activation puis désactivation de la haute précision              |
| `Solar-Energy-Graphs-Card_editor.gif`         | ajout depuis le sélecteur de cartes et choix des 4 capteurs      |

- Conversion avec le ffmpeg de l'hôte (`/usr/bin/ffmpeg`). C'est une opération
  ponctuelle, hors du build ; les clips bruts restent dans le scratchpad :
  ```
  ffmpeg -i clip.mp4 -vf "fps=12,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" -loop 0 out.gif
  ```
- Budget de 3 Mo par GIF. Au-delà, passer à `fps=10`, puis à une largeur de
  720.
- Commit `docs: add feature clips for the README`. Son corps note la commande
  et les tailles obtenues.
- Insertion de chaque GIF dans la section du README qui le décrit, avec une
  URL absolue. Commit `docs(readme): show each feature in action`.
- Version : `package.json:3` et `package-lock.json:3,9` passent à `0.2.0`.
  Commit `chore(release): 0.2.0`.

**Jalon v0.2.0.** Ce jalon teste la mise à jour HACS de 0.1.0 vers 0.2.0 et
le rendu des GIF dans HACS.

### Étape 6 -- v1.0.0 et inclusion par défaut

- Mise à jour de la version dans `package.json` et `package-lock.json`.
  Commit `chore(release): 1.0.0`.
- Après le test HA de la v1.0.0 : badge HACS « Default » et retrait de la
  mention « custom repository » du README, seulement une fois la PR
  `hacs/default` acceptée. Cela demande une release suivante, puisque HACS lit
  le README au tag.
- `docs/TODO.md` : je coche les items après vos confirmations explicites.

## Ce qui reste à faire par vous

1. Description et topics, avant la v0.1.0 :
   ```
   gh repo edit XavierBerger/Solar-Energy-Graphs-Card \
     --description "Home Assistant Lovelace card: two synchronized graphs of solar production, consumption and grid exchange" \
     --add-topic home-assistant,hacs,lovelace,lovelace-card,home-assistant-card,solar,solar-energy,energy-monitoring
   ```
2. Téléverser `docs/videos/overview.mp4` : la glisser dans un champ de
   commentaire GitHub (un brouillon d'issue suffit, sans le soumettre), puis me
   donner l'URL `https://github.com/user-attachments/assets/...`. Vérifiez
   d'abord que la vidéo montre l'interface finale.
3. Pousser la branche et fusionner `feat/solar-energy-graphs-card` dans `main`.
   Je ne pousse rien.
4. Poser les tags, par exemple :
   ```
   git tag -a v0.1.0 -m "v0.1.0" main
   git push origin v0.1.0
   ```
   Même chose pour `v0.2.0` et `v1.0.0`.
5. Enregistrer les clips de l'étape 5.
6. Faire les tests HA de chaque jalon.
7. Ouvrir la PR `hacs/default` après la v1.0.0 :
   - forker le dépôt et partir d'une branche créée depuis `master` ;
   - ajouter `"XavierBerger/Solar-Energy-Graphs-Card"` dans le fichier
     `plugin`, à sa place alphabétique (pas à la fin) ;
   - utiliser le modèle de PR, depuis votre compte personnel (pas une
     organisation) ;
   - compter plusieurs mois de revue.

## Vérification

**Techniques, à chaque étape (`./dev.sh`, Podman).**

- `./dev.sh build` et `./dev.sh test`. Aucun code source ne change dans ce
  plan, donc aucun test Vitest n'est ajouté.
- `jq . hacs.json` réussit, et `jq -r .filename hacs.json` est égal à
  `basename dist/solar-energy-graphs-card.js`.
- Le bundle est autonome :
  `grep -cE '^import |from "(lit|uplot)' dist/solar-energy-graphs-card.js` doit
  renvoyer `0`.
- README, chaque image et chaque lien absolus pointent vers un fichier suivi :
  ```
  grep -o 'raw.githubusercontent.com/XavierBerger/Solar-Energy-Graphs-Card/main/[^) "]*' README.md \
    | sed 's#.*/main/##' | xargs git ls-files --error-unmatch
  ```
- Aucun lien relatif ne subsiste :
  `grep -nE '\]\((\.\.?/|docs/|LICENSE|CONTRIBUTION)' README.md` ne renvoie
  rien.
- Chaque message cité dans Troubleshooting se retrouve par `grep` dans `src/`.
- `du -h docs/images/*.gif` : 3 Mo au plus par GIF.
- Les workflows ne sont pas lintés localement (pas d'actionlint sur la
  machine). Si vous l'acceptez, je propose
  `podman run --rm -v "$PWD:/repo" -w /repo docker.io/rhysd/actionlint:latest`.
  Sinon, la première exécution réelle sur `v0.1.0` fait foi.

**GitHub, après chaque tag.**

- Le workflow Release est vert, job `validate-hacs` compris.
- `gh release view vX.Y.Z --json assets` liste un seul asset,
  `solar-energy-graphs-card.js`.
- Validate est vert sur `main`.
- Le README rend correctement sur GitHub, lecteur vidéo compris.

**Home Assistant (vous).**

1. HACS, « Custom repositories » : ajouter l'URL avec le type Dashboard, sans
   erreur.
2. Le README s'affiche dans HACS avec ses images. Noter comment le lien vidéo
   y apparaît.
3. Télécharger la v0.1.0. La ressource
   `/hacsfiles/solar-energy-graphs-card/solar-energy-graphs-card.js?hacstag=...`
   apparaît dans Paramètres, Tableaux de bord, Ressources.
4. La carte apparaît dans le sélecteur ; dans l'éditeur, configurer les
   4 capteurs, puis vérifier :
   - les deux graphes ;
   - le thème clair et le thème sombre ;
   - l'affichage sur téléphone (gestes tactiles et mise en page) : le résultat
     fixe ce que le README en dira ;
   - la version de HA testée, que le README cite.
5. v0.2.0 : HACS propose la mise à jour ; l'appliquer, rafraîchir le
   navigateur, puis vérifier que la carte se charge et que les GIF s'affichent
   dans HACS.
6. v1.0.0 : même contrôle, plus une installation manuelle sur une instance
   sans HACS ou après désinstallation, pour valider la section « Manual ».

## Hors périmètre

- La traduction française (après la v1.0).
- La correction de `./dev.sh deploy` et de `docs/architecture.md:273`
  (tâche ajoutée au TODO).
- Une bannière de version dans la console : elle aiderait à diagnostiquer le
  cache, mais c'est du code ; je la proposerai plus tard.
- Une clé `homeassistant` dans `hacs.json` : aucune version minimale n'est
  établie, et je n'en invente pas.
- Les éléments que je recommande de ne pas faire :
  - commiter `dist/` : seul l'asset de release distribue la carte ;
  - commiter `overview.mp4` ;
  - publier une pré-version avant la première release complète ;
  - renommer les PNG existants (`Graph` au singulier, déjà référencés dans
    `docs/architecture.md:23,38`) ;
  - modifier l'installation de Podman, redondante, dans `ci.yml`.
