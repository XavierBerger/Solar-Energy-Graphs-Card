#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
IMAGE=localhost/solar-energy-graphs-card-dev:24.15.0
DEPENDENCIES_VOLUME=solar-energy-graphs-card-node-modules
NPM_CACHE_VOLUME=solar-energy-graphs-card-npm-cache
ACTION=${1:-build}

case "$ACTION" in
  build|install|test|coverage|typecheck|diagrams|mutation)
    ;;
  *)
    printf 'Usage: %s [build|install|test|coverage|typecheck|diagrams|mutation]\n' "$0" >&2
    exit 2
    ;;
esac

if ! command -v podman >/dev/null 2>&1; then
  printf 'Podman is required to run the isolated development environment.\n' >&2
  exit 1
fi

podman build --quiet --tag "$IMAGE" --file "$SCRIPT_DIR/Containerfile" "$SCRIPT_DIR"

if ! podman volume exists "$DEPENDENCIES_VOLUME"; then
  podman volume create "$DEPENDENCIES_VOLUME" >/dev/null
fi

if ! podman volume exists "$NPM_CACHE_VOLUME"; then
  podman volume create "$NPM_CACHE_VOLUME" >/dev/null
fi

NPM_SCRIPT=$ACTION

podman run --rm \
  --volume "$SCRIPT_DIR:/source" \
  --volume "$DEPENDENCIES_VOLUME:/workspace/solar-energy-graphs-card/node_modules" \
  --volume "$NPM_CACHE_VOLUME:/root/.npm" \
  --workdir /workspace/solar-energy-graphs-card \
  "$IMAGE" sh -ec '
    cp -R /source/. .

    if [ "$1" = install ]; then
      npm install
      cp package-lock.json /source/package-lock.json
      sha256sum package.json package-lock.json | sha256sum | cut -d " " -f 1 \
        > node_modules/.dependencies-lock-hash
      exit 0
    fi

    lock_hash=$(sha256sum package.json package-lock.json | sha256sum | cut -d " " -f 1)
    installed_hash=
    if [ -f node_modules/.dependencies-lock-hash ]; then
      installed_hash=$(cat node_modules/.dependencies-lock-hash)
    fi
    if [ "$installed_hash" != "$lock_hash" ]; then
      npm ci
      printf "%s\n" "$lock_hash" > node_modules/.dependencies-lock-hash
    fi

    npm run "$1"
    if [ "$1" = build ]; then
      rm -rf /source/dist
      cp -R dist /source/dist
    fi
    if [ "$1" = coverage ]; then
      rm -rf /source/reports/coverage
      mkdir -p /source/reports
      cp -R coverage /source/reports/coverage
    fi
    if [ "$1" = mutation ]; then
      rm -rf /source/reports/mutation
      mkdir -p /source/reports
      cp -R reports/mutation /source/reports/mutation
      cp reports/stryker-incremental.json /source/reports/stryker-incremental.json
    fi
    if [ "$1" = diagrams ]; then
      cp docs/diagrams/*.svg /source/docs/diagrams/
    fi
  ' sh "$NPM_SCRIPT"
