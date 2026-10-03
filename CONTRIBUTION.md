# Contributing

Thanks for your interest in Solar Energy Graphs Card. This project is a
Home Assistant Lovelace card with two synchronized solar-energy graphs. The
card is still under development; contributions should preserve its focused
scope and existing behavior.

## Project scope

The card displays two graphs and the controls needed to read them: titles,
axes, units, legends, a shared cursor, synchronized horizontal zoom, and
previous/next day navigation. Do not add KPIs, statistics panels, toolbars,
other period selectors, or a zoom-reset button.

Keep uPlot as the charting library. Do not introduce a second chart engine or
application framework. Before proposing a dependency, describe the concrete
need, a dependency-free alternative, and the bundle impact.

Do not assume Home Assistant entity IDs, units, signs, or energy-flow
semantics. Keep mock data explicitly separate from real Home Assistant data.
Measure fetching, transformation, and rendering before proposing caching or
point reduction.

## Development environment

Podman is the only host dependency. Node.js and npm run inside the development
container defined by `Containerfile`.

```sh
./dev.sh build
./dev.sh test
```

Other supported commands:

```sh
./dev.sh typecheck
./dev.sh coverage
./dev.sh mutation
./dev.sh diagrams
./dev.sh install
```

`install` updates dependencies and copies the resulting lockfile back to the
source tree. The development script keeps `node_modules` and the npm cache in
Podman volumes. `build` writes the distributable bundle to `dist/`;
`coverage` and `mutation` copy their reports into the project.

## Changes and tests

- Work from the open items in [`docs/TODO.md`](docs/TODO.md), one item at a
  time. Check the existing structure and patterns before changing them.
- Add targeted Vitest tests for every changed behavior. Test pure functions
  without the DOM; mock Home Assistant and uPlot boundaries when testing card
  behavior.
- Precede each test (`it`/`test`) with a short English comment explaining its
  purpose.
- Keep source code, comments, commit messages, and developer documentation in
  English. The user-facing README is in English for HACS; `docs/TODO.md` is in
  French.
- Keep the project buildable and preserve previously validated behavior. Run
  the relevant checks through `./dev.sh`.
- Do not mark a TODO item complete until technical checks pass and the user
  has explicitly confirmed the relevant Home Assistant behavior.

Automated checks do not replace visual confirmation in Home Assistant. Manual
checks should cover both themes, responsive layout, touch interactions, unit
readability, and behavior with the real configured entities.

## Releasing

1. Update `version` in `package.json` and in both version fields at the start
   of `package-lock.json`.
2. Commit the version change as `chore(release): X.Y.Z`.
3. Merge the change into `main`, then create and push an annotated tag:

   ```sh
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin vX.Y.Z
   ```

The release workflow checks that the tag matches `package.json`, builds and
tests the card, publishes `dist/solar-energy-graphs-card.js` as the GitHub
release asset, and validates the tagged repository with HACS. Tags containing
`-` (for example, `v0.2.0-beta.1`) are published as prereleases; HACS can use
one only after a complete release has been published. HACS displays the
README from the release tag, so README updates are reflected there only by a
subsequent release.

## Architecture

Read the [architecture guide](docs/architecture.md) for the data flow, module
responsibilities, chart behavior, and development environment details.
