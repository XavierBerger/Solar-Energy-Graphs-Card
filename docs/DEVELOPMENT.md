# Development Environment

This project provides a minimal Docker-based development environment for Home Assistant.

## Prerequisites

- Docker installed on your system
- Docker Compose (v2 or later recommended)

## Quick Start

1. **Start the development container:**

   ```bash
   cd docker
   docker compose up -d
   ```

2. **Access Home Assistant:**

   Open your browser and navigate to: http://localhost:8123

3. **Complete the onboarding:**

   On first run, Home Assistant will guide you through the initial setup.
   Your configuration will be persisted in the `docker/ha-config` directory.

## Available Commands

From the directory `docker`

| Command                  | Description                            |
| ------------------------ | -------------------------------------- |
| `docker compose up -d`   | Start the container in detached mode   |
| `docker compose down`    | Stop the container (preserves data)    |
| `docker compose down -v` | Stop and remove all data (clean slate) |
| `docker compose logs -f` | View container logs in real-time       |
| `docker compose restart` | Restart the container                  |

## Configuration Persistence

All Home Assistant configuration, add-ons, and data are stored in the `docker/ha-config` directory on your host machine. This directory is mapped to `/config` inside the container.

- Configuration files: `docker/ha-config/configuration.yaml`
- Add-ons: `docker/ha-config/addons/`
- Custom components: `docker/ha-config/custom_components/`
- Lovelace UI: `docker/ha-config/.storage/`

## Developing Custom Components

To develop a custom component or card:

1. Clone or create your component in a directory on your host
2. Mount the directory as a volume in the `docker-compose.yml`:

   ```yaml
   services:
     home-assistant:
       volumes:
         - ./ha-config:/config
         - ./my-component:/config/custom_components/my_component
   ```

3. Restart the container: `docker compose restart`
4. Add the component via Home Assistant's configuration

## Developing Lovelace Cards

To develop a custom Lovelace card:

1. Create your card files (JavaScript/TypeScript) in a directory
2. Mount the directory in `docker-compose.yml`:

   ```yaml
   services:
     home-assistant:
       volumes:
         - ./ha-config:/config
         - ./my-card:/config/www/my-card
   ```

3. Reference the card in your Lovelace configuration:

   ```yaml
   resources:
     - url: /local/my-card/my-card.js
       type: module
   ```

## Accessing the Container

To access the container shell for debugging:

```bash
docker exec -it ha-dev bash
```

## Network Configuration

The container exposes port 8123 on your localhost. If you need to access it from other devices on your network, modify the port mapping in `docker-compose.yml`:

```yaml
ports:
  - "0.0.0.0:8123:8123"
```

## Troubleshooting

### Port already in use

If port 8123 is already in use on your host, change the first port number in the port mapping:

```yaml
ports:
  - "8124:8123"
```

Then access Home Assistant at http://localhost:8124

### Permission issues

Ensure your user has read/write permissions to the `docker/ha-config` directory:

```bash
chmod -R 777 docker/ha-config
```

### Container fails to start

Check the logs for errors:

```bash
cd docker
docker compose logs
```

Common issues include:
- Insufficient disk space
- Port conflicts
- Corrupted configuration files

## Updating Home Assistant

To update to the latest stable version:

```bash
cd docker
docker compose down
docker compose pull
docker compose up -d
```

This will pull the latest image and restart your container with the new version while preserving your configuration.

## Using a Specific Version

To use a specific version of Home Assistant, modify the image tag in `docker-compose.yml`:

```yaml
image: ghcr.io/home-assistant/home-assistant:2024.12.0
```

Available tags can be found on the [Home Assistant Container GitHub](https://github.com/home-assistant/container/pkgs/container/home-assistant).

## Backup

Your configuration is stored in `docker/ha-config`. To create a backup:

```bash
# Create a tarball of your configuration
cd docker
tar -czvf ha-config-backup-$(date +%Y%m%d).tar.gz ./ha-config
```

To restore from a backup:

```bash
cd docker

# Stop the container
docker compose down

# Restore the backup
tar -xzvf ha-config-backup-20240101.tar.gz

# Start the container
docker compose up -d
```
