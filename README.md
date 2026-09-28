# Solar Router for ESPHome -- Card

Ce dépôt regroupe plusieurs composants autour d'un routeur solaire piloté par ESPHome et leur environnement de développement.

## Composants

| Répertoire | Description | Documentation |
|---|---|---|
| `solar-energy-graphs-card/` | Carte Lovelace Home Assistant pour visualiser production, consommation et échanges réseau | [README de la carte](solar-energy-graphs-card/README.md) |
| `fronius-simulator/` | Simulateur Rust d'onduleur et compteur Fronius, avec visualiseur énergétique | [README du simulateur](fronius-simulator/README.md) |
| `docker/` | Environnement de développement Home Assistant basé sur conteneur | [README Docker](docker/README.md) |
| `docs/` | Documentation transversale du dépôt et environnement de développement | [README de la documentation](docs/README.md) |

## Démarrage rapide

Pour travailler sur l'ensemble de l'environnement de développement :

```sh
cd docker
docker compose up -d
```

- Home Assistant : `http://localhost:8123`
- API du simulateur : `http://localhost:8080` -- depuis Home Assistant, utiliser
  `http://fronius-simulator:8080` comme hôte de l'intégration Fronius
- Visualiseur énergétique : `http://localhost:8080/`

Pour construire ou tester la carte, consultez directement le [README de la carte](solar-energy-graphs-card/README.md).

Pour travailler sur le simulateur, consultez son [README](fronius-simulator/README.md).

## Documentation

La documentation détaillée est organisée avec les composants concernés :

- [Carte Solar Energy Graphs](solar-energy-graphs-card/README.md)
- [Simulateur Fronius](fronius-simulator/README.md)
- [Environnement Docker / Home Assistant](docker/README.md)
- [Documentation générale](docs/README.md)

Les plans et documents de conception spécifiques à la carte se trouvent dans [`solar-energy-graphs-card/docs/`](solar-energy-graphs-card/docs/).

## Licence

Voir [LICENSE](LICENSE).
