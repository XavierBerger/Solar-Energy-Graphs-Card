# Agent instructions

## Scope

Work only on **`solar-energy-graphs-card/`**, following
[`docs/SOLAR-ENERGY-CARD-DEVELOPMENT-PLAN.md`](solar-energy-graphs-card/docs/SOLAR-ENERGY-CARD-DEVELOPMENT-PLAN.md).
Treat that plan as the source of truth for the card's scope, implementation
sequence, and validation requirements.

The goal is a Home Assistant Lovelace card containing two synchronized solar
energy graphs. Do not work on or introduce dependencies on the Fronius
simulator, its viewer, the Home Assistant integration, or other repository
components.

## Scope boundaries

- Keep the card focused on the two graphs and what is needed to read them:
  titles, axes, units, legends, cursor, and synchronized horizontal zoom.
- Do not add KPIs, statistics, status panels, toolbars, period selectors, or a
  zoom-reset button.
- Do not assume Home Assistant entity IDs, units, signs, or energy-flow
  semantics. Confirm these with the user before implementing real-data
  transformations.
- Keep mock data explicitly separate from real Home Assistant data.

## Development workflow

- Proceed incrementally in the order described by the plan. Inspect the card's
  existing structure and tooling before initializing or changing them.
- At each significant step, explain what changed and its limits, then give
  precise Home Assistant test steps and ask the user to verify the result.
- Automated tests and builds do not replace visual confirmation in Home
  Assistant. Do not mark a step validated or proceed past a required user
  validation until the user explicitly confirms it.
- Keep the plan's TODO list current: mark work **En cours** when started,
  **Validée** only after technical checks and required user confirmation, or
  **Bloquée** with the reason. Preserve useful history and add newly discovered
  tasks.
- Keep the project buildable and preserve previously validated behavior.
- Run the relevant existing tests, build, and formatting checks for changes;
  report any checks that could not be run.
- Keep source code, code comments, and commit messages in English. Follow the
  card's existing conventions and Home Assistant Lovelace practices.
