# AGENTS.md

## Project

This repository contains a custom Home Assistant component (**Solar-Router-for-ESPHome-Card**).  
It is likely a Lovelace card or custom component intended for use with ESPHome and Solar Router.

## Development Environment

### Docker

A **Docker environment** is provided for local development with Home Assistant.

- Configuration file: `docker/docker-compose.yml`
- Container: `ha-dev` (based on `ghcr.io/home-assistant/home-assistant:stable`)
- Port: `8123` (accessible via [http://localhost:8123](http://localhost:8123))
- Configuration volume: `docker/ha-config` (persists configuration between restarts)

### Usage for Development

To develop this project:

1. Start the development container:
```bash
   cd docker
   docker compose up -d
```   

2. Access Home Assistant: [http://localhost:8123](http://localhost:8123)

3. This container **MUST** be used for development of this project.

4. To test modifications:
 - Mount the project directory in the container via `docker-compose.yml`
 - Restart the container after each modification
 - Changes will be visible in Home Assistant

## Rules for Agents

- Always use the Docker environment to test modifications
- Never modify production configuration directly without prior testing
- Respect the existing project structure
- Follow Home Assistant best practices for custom components
