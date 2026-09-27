#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
IMAGE=localhost/solar-energy-graphs-card-dev:24.15.0
DEPENDENCIES_VOLUME=solar-energy-graphs-card-node-modules
NPM_CACHE_VOLUME=solar-energy-graphs-card-npm-cache
ACTION=${1:-build}

case "$ACTION" in
  build|install|test|typecheck|deploy)
    ;;
  *)
    printf 'Usage: %s [build|install|test|typecheck|deploy]\n' "$0" >&2
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
if [ "$ACTION" = deploy ]; then
  NPM_SCRIPT=build
fi

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
  ' sh "$NPM_SCRIPT"

if [ "$ACTION" = deploy ]; then
  WEB_ROOT="$REPO_ROOT/docker/ha-config/www"
  mkdir -p "$WEB_ROOT"
  cp "$SCRIPT_DIR/dist/solar-energy-graphs-card.js" \
    "$WEB_ROOT/solar-energy-graphs-card.js"
  printf 'Published bundle to %s\n' "$WEB_ROOT/solar-energy-graphs-card.js"
fi
