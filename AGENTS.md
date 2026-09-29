# Agent instructions

## Scope

Work only on **`solar-energy-graphs-card/`**. The card is functional; the work
to do is listed in
[`docs/TODO.md`](solar-energy-graphs-card/docs/TODO.md), and its current design
is described in
[`docs/architecture.md`](solar-energy-graphs-card/docs/architecture.md).

The goal is a Home Assistant Lovelace card containing two synchronized solar
energy graphs. Do not work on or introduce dependencies on the Fronius
simulator, its viewer, the Home Assistant integration, or other repository
components. The simulator viewer remains the visual reference only.

## Scope boundaries

- Keep the card focused on the two graphs and what is needed to read them:
  titles, axes, units, legends, cursor, synchronized horizontal zoom, and the
  top-right day navigation arrows.
- Do not add KPIs, statistics, status panels, toolbars, other period selectors,
  or a zoom-reset button. A loading, empty or error message is allowed when it
  stays local to the graph it concerns.
- Do not assume Home Assistant entity IDs, units, signs, or energy-flow
  semantics. Confirm these with the user before implementing real-data
  transformations.
- Keep mock data explicitly separate from real Home Assistant data.
- Keep uPlot for the graphs, with no second chart engine or application
  framework. Before adding a dependency, state the concrete need, the
  dependency-free alternative, and the bundle impact.
- Do not optimize prematurely: measure fetching, transformation and rendering
  before adding caching or point reduction.

## Development workflow

- Work from `docs/TODO.md`, one item at a time. Inspect the card's existing
  structure and tooling before changing them.
- At each significant step, explain what changed and its limits, then give
  precise Home Assistant test steps and ask the user to verify the result.
- Automated tests and builds do not replace visual confirmation in Home
  Assistant. Tick an item (`- [x]`) only after the technical checks and the
  user's explicit confirmation. Add newly discovered tasks to `docs/TODO.md`.
- Keep the project buildable and preserve previously validated behavior.
- Run the relevant existing tests, build, and formatting checks for changes,
  through `./dev.sh` in the Podman environment; report any checks that could
  not be run.
- Cover every added or changed behavior with targeted Vitest unit tests. Test
  pure functions without the DOM; mock the Home Assistant and uPlot boundaries
  to test the card's behavior, not its dependencies' internals.
- Precede each test (`it`/`test`) with an English comment of at most two lines
  stating its purpose.
- Manual Home Assistant checks cover visual parity with the viewer, unit
  readability, touch interactions, responsive layout, themes, and behavior with
  the real entities.
- Keep source code, code comments, commit messages and developer documentation
  in English; the card README and `docs/TODO.md` stay in French. Follow the
  card's existing conventions and Home Assistant Lovelace practices.
