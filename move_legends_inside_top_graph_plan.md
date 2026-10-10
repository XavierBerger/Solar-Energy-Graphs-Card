# Plan -- issue #19: legend inside the top graph

Branch: `feat/move_legends_inside_top_graph` (at `b40fc4b`, same as `main`).

## Context

Issue #19 asks for one legend, drawn in the top-left corner of the top graph
while the mouse is over the graphs, with one entry per line, and for the two
legend rows under the graphs to go. The values must keep updating exactly as
they do today, stay translated, keep coverage from dropping and add no
surviving mutant.

Decisions you made (2026-10-08):

- **Read-only legend.** It uses `pointer-events: none`, so clicking an entry no
  longer hides a curve. In exchange the cursor, drag-to-zoom, pan, wheel and
  double-click work underneath it.
- **Shown while the shared cursor is on either graph**, hidden once it leaves
  both.
- **Same entries as today's top legend:** Time, Self-consumption, Solar
  production, Consumption, Grid import, Grid export. The bottom graph's
  `Grid export (+W)` and `Grid import (-W)` show the same measured values, so
  they are dropped.
- Once you approve, I copy this plan to `move_legends_inside_top_graph_plan.md`
  at the repo root. It stays untracked and is never committed.

## Approach

Keep uPlot's built-in live legend on the top chart, but mount it inside the
plot overlay `chart.over` instead of a card container. Turn off the legend of
the grid chart. No new dependency and no new translation string: the labels
already come from `translations(...).chart.*`.

uPlot 1.6.32 facts this relies on (`uplot/dist/uPlot.esm.js` in the
`solar-energy-graphs-card-node-modules` volume):

- `self.over` is created (l.2961) before `legend.mount(self, legendTable)` is
  called (l.3200), so `mount` can append the table to `chart.over`.
- `cursor.left` starts at `-10` (l.1404). `mouseLeave` sets it back to `-10`
  (l.5942) and publishes that to the sync group, where the receiving chart also
  sets `-10` (l.5736). `setCursor` fires on both the source chart and the
  synced chart (l.5682). uPlot itself uses `cursor.left >= 0` as its "cursor
  shown" test (l.4176).
- `.u-inline * {display: inline-block}` puts every entry on one line, and
  `.u-inline {display: block}` would override a `[hidden]` attribute. The plan
  therefore changes the row layout with card CSS and toggles visibility through
  `style.display`.
- `destroy()` removes `root` and the legend table (l.6067), so the in-plot
  legend needs no cleanup of its own.

## Slice 1 -- code and tests

### `src/energy-charts-renderer.ts`

- `ChartTarget` (l.253): drop `legendElement`.
- Constructor (l.283): remove the `legendContainers` parameter. The new
  signature is `(containers, data, timeZone, darkMode = false, language = "en")`.
  Drop `legendContainers[index]` (l.301) and stop passing it to
  `createOptions` (l.304); return `{ element, chart }` (l.320).
- `destroy()` (l.344): keep only `chart.destroy()` in the `forEach`.
- `createOptions` (l.556): drop the `legendContainer` parameter. After
  `bands` (l.675), add this, with a short comment on why:
  ```ts
  let legendTable!: HTMLElement;
  const showLegendWithCursor = (chart: UPlotInstance) => {
    legendTable.style.display = chart.cursor.left! >= 0 ? "" : "none";
  };
  ```
  In the returned options:
  - `legend` (l.686) becomes
    `mainChart ? { mount: (chart, table) => { legendTable = table; chart.over.append(table); showLegendWithCursor(chart); } } : { show: false }`.
  - The `...(mainChart ? {} : { hooks: ... })` spread (l.702) becomes
    `hooks: mainChart ? { setCursor: [showLegendWithCursor] } : { draw: [(chart) => drawZeroLine(chart, this.theme.grid)] }`.

  The `!` on `cursor.left` follows the existing `cursor.drag!.x` (l.454),
  because uPlot always initializes `left`.

### `src/solar-energy-graphs-card.ts`

- `render()`: delete the two `<div class="chart-legend" data-legend=...>`
  (l.450, l.464). `.chart` keeps only `.chart-plot`.
- `initializeCharts()` (l.488-503): drop the `firstLegend`/`secondLegend`
  queries, test `first && second`, and call
  `new EnergyChartsRenderer([first, second], this.historyData, ...)`.
- `styles`:
  - Delete `.chart-legend` (l.257-263) and `.chart-legend .u-legend`
    (l.265-270).
  - Delete `.chart .u-legend .u-series.legend-values-only { pointer-events: none; }`
    (l.276-278). It is redundant once the whole legend ignores the pointer.
  - Keep `hide-helper-legend` (l.272). It outranks the new `tr` rule
    (specificity 0,4,0 against 0,3,1). Also keep `legend-values-only > * { opacity: 1; }`
    (l.280).
  - Add these rules, properties in alphabetical order as in the file:
    ```css
    .chart .u-over .u-legend {
      background: color-mix(in srgb, var(--ha-card-background, var(--card-background-color, #fff)) 85%, transparent);
      border-radius: 0.25rem;
      left: 0.25rem;
      pointer-events: none;
      position: absolute;
      text-align: left;
      top: 0.25rem;
      white-space: nowrap;
      z-index: 1;
    }

    .chart .u-over .u-legend tr {
      display: block;
      margin-right: 0;
    }
    ```
    `z-index: 1` is needed because uPlot adds the cursor lines and the
    selection to `over` after the legend (l.5003, l.5029). Without it they
    would paint over the legend. I'll explain this in the commit body: the CSS
    in this file has no comments.

### `src/energy-charts-renderer.test.ts`

- Test wrapper class (l.63-79) becomes `(containers, darkMode, language)`.
  Remove `legendContainers` from `beforeEach` (l.105, l.136-137) and from the
  sync-group test (l.499-502). Replace every
  `new EnergyChartsRenderer(containers, legendContainers` with
  `new EnergyChartsRenderer(containers`.
- In "creates the solar and signed grid-exchange charts":
  - Replace the duplicate mount checks (l.321, l.323, l.351-352) with
    `firstOptions.legend.mount` being a function and
    `expect(secondOptions.legend).toEqual({ show: false })`.
  - Replace `firstOptions.hooks` undefined (l.353) with
    `expect(firstOptions.hooks.setCursor).toHaveLength(1)`.
- Replace "mounts each legend into its dedicated container" (l.465-478) with
  "mounts the top legend inside the plot overlay, hidden until the cursor is on
  it". It calls `mount` with `{ over: div, cursor: { left: -10 } }`, then
  asserts that `over.firstElementChild` is the table and that
  `style.display === "none"`.
- Replace "clears mounted legends on destroy" (l.480-491), whose behavior is
  removed, with "shows the top legend while its own or the synced cursor is on
  the plot". It runs `mount`, then `hooks.setCursor[0]` with `left` set to
  `0` and then `120` (display `""`), and to `-10` (display `"none"`). The
  `0` case kills `>= 0` -> `> 0`.
- Each new `it` gets an English comment of at most two lines. Translation
  stays covered by "uses French chart labels..." (l.198), since the legend
  labels are the series labels.

### `src/solar-energy-graphs-card.test.ts`

- Renderer mock (l.22-48): drop the `legendContainers` field and constructor
  parameter.
- "renders both chart areas..." (l.402): replace the `.chart-legend` count
  (l.408) with `.chart-legend` being absent and each `.chart` holding only its
  `.chart-plot` (`children.length` `[1, 1]`).
- "reserves an in-flow row for each chart legend" (l.577-591): rename it to
  "overlays the legend at the plot's top-left, one entry per line, without
  catching the pointer". It asserts the new rules (`.chart .u-over .u-legend`
  with `position: absolute`, `pointer-events: none`, `z-index: 1`, and the `tr`
  rule with `display: block`), that `hide-helper-legend` and the opacity rule
  are still there, and that `.chart-legend` is gone.
- "initializes the renderer..." (l.593-610): drop the `legendContainers`
  expectation.

### Checks for slice 1, all run through `./dev.sh` in Podman

1. **Baseline, before any edit.** Run `./dev.sh coverage` and record the
   totals and the rows for both changed files. Move
   `reports/stryker-incremental.json` aside, then run `./dev.sh mutation` and
   record the score and the survivor list. A full run is needed because
   incremental mode reuses stale static mutants.
2. **After the edits.** Run `./dev.sh typecheck`, `./dev.sh test` and
   `./dev.sh coverage`. Coverage must be at or above the baseline.
   `./dev.sh build` must also pass.
3. Run `./dev.sh mutation` (full run, same setup) and compare the survivors
   with the baseline. Kill any new survivor by strengthening the closest
   existing test, never with a new `it`, or simplify the code if the mutant is
   equivalent. No `Stryker disable`. I'll report the score and any survivor.
4. Stop and report what changed, its limits and the Home Assistant steps
   below. I commit once you confirm:
   `feat: show the legend inside the top graph`, with the body saying why,
   `Refs #19`, and the `Co-Authored-By` trailer. I stage the 4 files by name.

### Home Assistant check for slice 1

Copy `dist/solar-energy-graphs-card.js` to `/config/www/` and press `Ctrl+F5`.

1. Neither graph has a legend row under it, and both plots are a little taller.
2. Hovering the top graph shows a box at the top-left of the plot area, right
   of the y axis. It lists Time, Self-consumption, Solar production,
   Consumption, Grid import and Grid export, one per line, with values that
   follow the cursor and no helper rows.
3. Hovering the bottom graph shows the same box in the top graph, with the
   values for the synced time.
4. Leaving both graphs hides the box.
5. Starting a drag-zoom, a pan, a wheel zoom or a double-click on the box
   itself works as it does elsewhere on the plot.
6. In light and dark themes the text is readable over the curves, the
   background is translucent, and the cursor line passes under the box.
7. With the Home Assistant language set to French, the labels are in French.
8. On today, live values update while hovering. With high precision on and
   off, values still follow.
9. At phone width and on touch, a tap shows the box. Check that it does not
   get in the way.

## Slice 2 -- documentation, after slice 1 is confirmed

- `README.md` l.113-114: replace the sentence with: moving the cursor over
  either graph shows a legend in the top-left corner of the upper graph, with
  the time and one line per series, including the separately measured grid
  import and export.
- `docs/architecture.md`:
  - Under "Worth knowing" in "Anatomy of the charts", add a bullet. Only the
    top chart has a legend. uPlot mounts it in the plot overlay
    (`chart.over`), at the top-left, one entry per line. A `setCursor` hook
    shows it while the own or synced cursor is on a plot. It ignores the
    pointer, so curves are no longer toggled from the legend. The grid chart
    has no legend; its values are the Grid import/export entries.
  - Add a row to "Where do I change...?": "Change the legend" ->
    `createOptions` (`legend.mount`, `setCursor`) and the `.u-legend` rules in
    `styles`.
- `docs/diagrams/lifecycle.mmd` l.31: change it to
  `new EnergyChartsRenderer(containers, data)`, then run `./dev.sh diagrams`.
  I commit only `lifecycle.svg`; if other SVGs change, I report them without
  committing them.
- Commit: `docs: describe the legend inside the top graph`. I stage the 4
  files by name.

## Not done

- **Grid-chart labels and translations stay.** The series labels and the
  translations `gridExportPositive` and `gridImportNegative` are no longer
  displayed, but they still name the series in the options and the existing
  test asserts them. Removing them is a separate cleanup if you want it.
- **No screenshots.** `docs/images/*.png` will show the old bottom legends.
  Only your Home Assistant instance can produce new ones.
- **No push and no PR.** At the end I give you the commands to run.

## Left for you

- Run the Home Assistant checks above and confirm, or point out what is wrong.
- Retake `docs/images/Solar-Energy-Graphs-Card_{light,dark}.png` if you want
  the README to match.
- Push the branch and open the PR yourself (it closes #19).
