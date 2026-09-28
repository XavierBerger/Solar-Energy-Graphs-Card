# Environnement Docker

Ce répertoire fournit l'environnement Home Assistant utilisé pour développer et tester le projet avec le simulateur Fronius.

## Démarrage

```sh
docker compose up -d
```

Services principaux :

- Home Assistant : `http://localhost:8123`
- Simulateur / visualiseur : `http://localhost:8080/`

Pour la documentation générale de l'environnement, voir [docs/DEVELOPMENT.md](../docs/DEVELOPMENT.md).

La documentation de la carte se trouve dans [solar-energy-graphs-card/README.md](../solar-energy-graphs-card/README.md).
