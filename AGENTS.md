# Agent instructions

## Scope

Work only on this repository, which contains the standalone card. The card is
released; the work to do comes from the user's request or from the GitHub
issue they point to, and the card's current design is described in
[`docs/architecture.md`](docs/architecture.md).

The goal is a Home Assistant Lovelace card containing two synchronized solar
energy graphs.

## Scope boundaries

- Keep the card focused on the two graphs and what is needed to read them:
  titles, axes, units, legends, cursor, synchronized horizontal zoom, and the
  top-right controls -- the day navigation arrows, the displayed date that
  returns to today, and the high-precision toggle.
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

- Work on one request or issue at a time. Inspect the card's existing
  structure and tooling before changing them.
- At each significant step, explain what changed and its limits, then give
  precise Home Assistant test steps and ask the user to verify the result.
- Automated tests and builds do not replace visual confirmation in Home
  Assistant. Consider a change done only after the technical checks and the
  user's explicit confirmation. Report newly discovered tasks to the user
  instead of doing them.
- Keep the project buildable and preserve previously validated behavior.
- Run the relevant typecheck, tests and build for changes, through `./dev.sh`
  in the Podman environment; report any checks that could not be run.
- Cover every added or changed behavior with targeted Vitest unit tests. Test
  pure functions without the DOM; mock the Home Assistant and uPlot boundaries
  to test the card's behavior, not its dependencies' internals.
- Precede each test (`it`/`test`) with an English comment of at most two lines
  stating its purpose.
- After a logic change, run `./dev.sh mutation` and leave no new surviving
  mutant: kill it by strengthening the closest existing test -- never add an
  `it` or `test` block for a survivor -- or simplify the code when the mutant
  is equivalent. Report the score and any remaining survivor; see
  [`docs/mutation-testing-walkthrough.md`](docs/mutation-testing-walkthrough.md).
- Manual Home Assistant checks cover the absence of visual regression against
  the current card (`docs/images/`), unit readability, touch interactions,
  responsive layout, themes, and behavior with the real entities.
- Keep source code, code comments, commit messages, and developer
  documentation in English. The user-facing README is in English for HACS;
  temporary working files such as plans may be in French. Follow existing
  conventions and Home Assistant Lovelace practices.
