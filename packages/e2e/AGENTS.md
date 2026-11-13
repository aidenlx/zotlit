# @zotlit/e2e

The End-to-end Run suite — the plugin running in a real desktop Obsidian window, reading the Fixture's Zotero data directory from disk. See `packages/scripts/GLOSSARY.md` for the glossary (Fixture, Fixture Vault, Scope Case, End-to-end Run).

## Commands

- `pnpm e2e` (root) or `pnpm --filter @zotlit/e2e e2e` — runs the suite.
- `pnpm e2e:query` (root) — builds dependencies and runs only the ZotLit Query CLI cases, including cancellation.
- For another focused desktop run, pass a file and test name: `pnpm e2e --project=desktop src/<area>.e2e.ts -t '<test name>'`. Add the paired project only when the changed behavior needs Zotero. `pnpm --filter @zotlit/e2e exec vitest run` accepts the same selection for an inner loop; it installs the dev plugin bundle on disk and fails, naming the rebuild command, when that bundle is older than its sources.
- `pnpm --filter @zotlit/e2e typecheck` — type-checks the suite.
- Worker responsiveness: `pnpm e2e:worker` requires desktop Obsidian and passes only when the unchanged refresh, changed-Item rebuild, and rejected-snapshot cases all execute. `pnpm verify --release` runs it after the full End-to-end Run on the desktop. Its worker timer detects stalls that sequential search p99 can hide.

- `pnpm --filter @zotlit/e2e measure:query` — the release-time measurement of ZotLit Query (see below).
- `pnpm --filter @zotlit/e2e test` — unit tests of the measurement record (`src/**/*.test.ts`, `vitest.unit.config.ts`). They touch no Obsidian.

The End-to-end Run and the measurement drive a real Electron app. The `test` script runs the unit tests alone. `pnpm verify --release` requires the full End-to-end Run, including the Paired Run, followed by worker responsiveness on the desktop. GitHub Actions skips the desktop checks; `pnpm release` runs them before the version commit.

## Docs walks

A docs walk is one lesson of the `/learn` course, run as its reader would through the real apps: `src/docs-walks/<slug>.walk.ts`. A walk's `<slug>` (its `SLUG`) is the name of the lesson's media folder, `apps/docs/public/img/learn/<slug>/`, and can differ from the lesson's page slug: `track-reading-status.walk.ts` walks `/learn/track-papers-you-have-read`. The take record and the capture, layout and camera folders use the same `<slug>`. Each `it` is one step of the lesson, in the lesson's order and named after it, and asserts what the step says the reader sees, with the expected text read from `messages/en.json`. A step whose product behavior differs from the lesson asserts what the product does and says so in an `// OUTLINE-MISMATCH:` comment. Walks run under their own config, `vitest.docs-walk.config.ts`, and stay out of `pnpm e2e` and the release gate.

- Run one walk per run: `pnpm --filter @zotlit/e2e docs-walk src/docs-walks/<slug>.walk.ts`. Each walk opens its own Paired Run, and the first failure ends the run. Build the dev bundles first (`pnpm exec turbo run build:dev --filter=@zotlit/obsidian --filter=@zotlit/zotero`); a stale bundle fails the setup.
- A run that neither captures nor records holds one Desktop Slot and leaves the OS focus where it is. A run with `DOCS_WALK_CAPTURE=1` or `DOCS_WALK_RECORD=1` takes an Exclusive Hold of every slot (`exclusiveHoldRequested` in `src/docs-walks/docs-walk.ts`): its Zotero and desktop shots bring apps to the front, hide Obsidian, and can send real input, so no other run may use the desktop meanwhile. `DOCS_WALK_NATIVE=1` acts only in a step that records. A walk brings an app to the front only in a step whose clip records. Under an outer `pnpm desktop-slot run`, the walk reuses that hold, so wrap a capturing or recording run in `pnpm desktop-slot run --exclusive`: under an outer hold of one slot, such a run fails at once and names that command. With capture, the run writes each step's image to `apps/docs/public/img/learn/<slug>/step-<n>.webp` (Git LFS). Exit 75 means another run holds a slot; retry later.
- With `DOCS_WALK_RECORD=1`, a step the walk wraps in `walk.record("step-<n>", actions)` is also recorded: a CDP screencast of the window, with a drawn pointer (`page.scratch.docsWalkPointer`) that glides to each click and types at a person's pace, resting 1.5 s on the result, encoded by ffmpeg at its real timing as `step-<n>.mp4` (H.264) beside the image, 1440 px wide. Without the switch, `record` only runs the actions and the pointer is absent.
- A recorded clip has a calm camera. The pointer logs each action to `camera.json` beside the frames, and `planCamera` (`src/docs-walks/camera.ts`) plans the view from it. The camera keeps the whole window by default and moves seldom:
  - The opening shot of the whole window holds at least `openHold` (1.5 s) in the clip, and at least `hold` with the open pad before it: the encoder holds the first frame long enough. After each move, the shot holds at least `hold` (2.5 s) before the next move starts.
  - A shot frames every action due before the next move could arrive: the union of each element with `context` (160 CSS px) around it, at 1× to `zoom` (1.4×). A run of close actions gets one shot; actions spread across the window keep the whole window.
  - The camera zooms in only on actions the current view shows, when the tighter shot is at most 80% of the view's width and the move can take its whole `ease` (1 s) to arrive `lead` (0.5 s) before the action. An action outside the view widens the shot to a view of both. A late move takes `minEase` (0.6 s) at least.
  - A drag is one action: `pointer.drag(from, to)` presses at `from`, glides to `to` and releases there. Its shot is one still view of both ends with their context, in place `lead` before the press and held through the release, at 1× to `zoom`; ends that lie far apart get a wider view, up to the whole window. A move to that view starts without waiting for earlier actions to end, and when it still cannot arrive in time, the shot before it takes the wider view. Show a drag-and-drop and a selection made with the pointer through `drag`; `park` is a pointer move that keeps the view as it is.
  - The closing shot, often a zoom onto a `look`, rests at least `hold` too: the encoder holds the last frame long enough.
- The encoder (`src/docs-walks/clip-encode.ts`) crops each frame to the view, holds the first frame `openPad` (0.8 s) before the clip, or longer, so the opening shot rests `hold` (`openingPad` in `camera.ts`), and the last frame `endPad` (1 s) after it, or longer, so the shot after the last move rests `hold` (`closingPad`), and writes the last frame as `step-<n>.poster.webp`, the site's poster and reduced-motion still. With the clip's `rest`, the result shows about 2.5 s. The pace of the actions inside a clip (`glide`, `typing`) changes only with a new recording. End each recorded step with `pointer.look(...)` on what its check names, and leave the pointer at the last action rather than parked at a pane edge. A clip recorded with `{ notices: true }` keeps its notices on screen to its end.
- Every value of a clip (camera on or off, zoom, hold, ease and lead, opening hold and still start, context and padding, rest, open and end pads, glide, typing pace, output width, fps, CRF, poster quality) has its default in `src/docs-walks/clip-settings.ts`. A walk sets its own with `openDocsWalk({ clip })` (the landing walk turns the camera and the pads off); one run overrides them with `DOCS_WALK_CLIP='{"zoom":1.2,"rest":2.5}'` or `DOCS_WALK_CLIP_FILE=<json file>`.
- Each recorded clip writes its take into the walk's take record: `video/docs-walks/takes/<slug>.takes.json` in the private `video/` submodule when it is checked out (commit it there), else `.scratch/docs-walks/<slug>/takes.json`. A take holds the step, the recipe to make it again, the switches, the recorder's commit, the Obsidian, installer and Zotero versions, the Vault Case, the settings, the logged actions, the track (planned, override, or whole), the length, and the output sizes. The footage stays out of git.
- To record one clip again, build the dev bundles, then run the take's `recipe.record`: `DOCS_WALK_RECORD=1 DOCS_WALK_ONLY=step-<n> pnpm --filter @zotlit/e2e docs-walk src/docs-walks/<slug>.walk.ts`. The walk runs every step, since each builds on the one before, and records only the clips `DOCS_WALK_ONLY` names (comma-separated).
- To cut a clip again without the apps, run the take's `recipe.recut`: `node packages/e2e/src/docs-walks/clip-encode.ts <frames dir> <out> [<track.json>|whole]`. It cuts with today's camera and pads (`zoom`, `hold`, `openHold`, `lead`, `ease`, `minEase`, `central`, `context`, `padding`, `openPad`, `endPad`) from `clipSettings()`, and with the recording's own settings from the clip's `camera.json` (camera on or off, fps, width, CRF), so a plain recut gives the current cut. `--help` lists both groups. A walk's own cut settings, such as the landing walk's pads, are part of the recipe as `DOCS_WALK_CLIP`; give other settings the same way, or in `DOCS_WALK_CLIP_FILE`. It writes over the clip and leaves the take as it was. The frames stay in `.scratch/docs-walks/<slug>/step-<n>.frames/` (out of git) until the next recording of that clip; its `track.json` is the track last used. A plan that frames the wrong part takes a hand-written track, `src/docs-walks/<slug>.camera/step-<n>.json`, in the format of that `track.json`, which the next recording uses too. A Zotero clip has no camera, and its poster is its last frame.
- A step in a Zotero window records with `walk.recordZotero("step-<n>", title, actions)`: Zotero comes to the front, and macOS screen capture (`screencapture -v`) records the window whose title matches `title`, with a drawn pointer from `pointAt`. Every shot's drawn pointer has one look and timing (`src/docs-walks/pointer-look.ts`), with its glide from `clip-settings.ts`. It needs the screen-recording permission, and it refuses to record when another app's window covers that window. The macOS cursor shows in these clips. Call `stop` before an action that closes the window.
- A clip that crosses apps records with `walk.recordClip("step-<n>", run)`: `run` records shots in a row through `shots.obsidian` (the screencast above), `shots.browser` (`src/docs-walks/docs-browser.ts`: a headless Chrome on a new, empty profile, its page content alone, with the same drawn pointer; downloads go to a folder the walk names; `DOCS_WALK_CHROME` names another Chrome) and `shots.desktop` (`src/docs-walks/macos-desktop.ts`: a screen region that ffmpeg records with the real macOS pointer and a wall-clock time on each frame, keys sent through System Events, framed by the views the walk chooses, with private parts blurred in every frame of the shot). The shots' folders sit in `step-<n>.frames/` with a `sequence.json`, and `recipe.recut` cuts them again into one clip. A walk calls `recordClip` only when `recordRequested("step-<n>")`.
- A desktop shot sends real input, and each click first checks that its app is in front. Record one only under the run's Exclusive Hold, in an unattended window, with the other apps hidden, not quit. Lesson 1 step 3 records its two macOS shots (Tools › Plugins in the menu bar, and the file dialog) only under `DOCS_WALK_NATIVE=1`; between the shots the walk moves the dialog to its scratch `Downloads` folder, in icon view, and frames the file list, so the computer's folders stay out. Its browser shot opens the local docs server (`http://localhost:4833`, or `DOCS_WALK_DOCS_URL`). Lesson 1 step 1 records the real install from Obsidian's community directory and needs the network. Without a recording, both steps take an offline path. Lesson 2 step 2 presses Always Allow in Zotero's dialog with the real pointer only under `DOCS_WALK_NATIVE=1`, and holds the notice from before that press with `holdNotices`. Without a recording, it presses the button through RDP.
- The setup section of the Zotero library tab is closed in every walk after Lesson 1: `closeWelcome(vaultId)` writes the setting its × writes.
- `openDocsWalk` (`src/docs-walks/docs-walk.ts`) opens a Paired Run of the walk's own on a Vault Case (`docs` for the lessons): a new Fixture, a new vault, and a Paired Zotero with its Local API open, disposed after the file. `walk.zotero` evaluates in Zotero for the reader's steps there. Nothing carries over between walks, so a walk sets up what earlier lessons left, such as the Lesson 1 literature note, in its `beforeAll`.
- `walk.capture(layer)` saves the Obsidian window to `.scratch/docs-walks/<slug>/<layer>.png`, without notices unless `{ notices: true }` keeps them for a step whose check is a notice. `walk.compose(name)` composes the image with `.agents/skills/docs-screenshot/compose.mjs` from the committed layout `src/docs-walks/<slug>.layouts/<name>.json`, whose layers name captures by file (`"src": "<layer>.png"`); without a layout, the capture `name` becomes one centred window. The window is 1440 × 860 points, so a crop in a layout holds on any screen at least that tall.
- Data a walk needs and the Vault Case lacks belongs in the Fixture Spec, so the next build reproduces the scene (`docs/fixture.md`).
## Page callbacks

Use `obRun` from `src/obsidian-cli.ts` to run page code. It serializes a
self-contained arrow or function expression and returns its inferred JSON result
(`undefined` for a callback that returns nothing). Pass host values in the JSON
`args` parameter; the callback's second parameter determines their type:

```ts
const name = await obRun(
  run.vaultId,
  ({ app }, { path }) => app.vault.getFileByPath(path)?.basename ?? null,
  { path: notePath },
);
```

The first parameter is `{ app, zotlit, page }`: the typed Obsidian app, the
current plugin's `zotlit.services`, and the helpers in `src/page-helpers.ts`.
Use `page.press`, `page.pick`, `page.trusted`, `page.menuReady`, and
`page.windowDocuments` for page interactions. Helpers install on demand in each
receiving window, including after reload. Keep state between calls in
`page.scratch`; extend `PageScratch` with the case's types in its page-type module.
The memory clipboard remains installed by `prepareRunWindow`.

Use `obRunUntil(vaultId, callback, args, { what, ready?, tries? })` to poll a
callback. It returns the value accepted by `ready` (default: `true`). Throws and
missing replies count as not ready; exhaustion names `what` and the last value.
For a single long call, pass `{ timeoutMs }` as `obRun`'s fourth argument.
For embedded Query Views, use `revealQueryView` and the typed callback form of
`readQueryViewUntil` in `src/note-query-view.ts`.

Write page callbacks as ordinary TypeScript: `await obRunUntil(…)` directly, name args by role, return booleans and numbers as they are. The `zotlit-tests/*` rules in `packages/config/oxlint-plugin-tests.ts` enforce the shapes; each message shows the readable form.

- A value that is not JSON-typed (an Effect `Duration`, a layout) returns through `JSON.stringify` and compares with `value === JSON.stringify(expected)`.
- To add page diagnostics to a timeout, catch the rejection and throw a new `Error` with the original as `cause`.

The [`zotlit-tests/no-eval-capture` rule](../config/oxlint-plugin-tests.ts) checks serialized callbacks.

The type and serialization proofs are in `src/ob-run.types.ts` and
`src/ob-run*.test.ts`. The eval wrapper is private;
`cliCommand` continues to dispatch registered commands.

## End-to-end Run layout

Shared Fixture setup, vault bootstrap, and helpers live in `src/e2e-run-*.ts` (`e2e-run-fixture.ts`, `e2e-run-lifecycle.ts`, `e2e-run-suite-helpers.ts`, and related modules). Every area file calls `registerEndToEndRunHooks()` so the Fixture vault opens once per run across files.

Add a new case to the area file that matches its feature (create a new area file only when an existing one would pass ~2,000 lines):

| File | Area |
| --- | --- |
| `annotations.e2e.ts` | Annotation View, sidebar grouping, early Query File embeds |
| `annotation-links.e2e.ts` | Durable Annotation Links in a note: click-to-land and pass-through to Zotero, the hover popover, and the Annotation Suggester's search-and-insert |
| `annotation-citations.e2e.ts` | Annotation Citations shown as citations: the in-text rendering in Live Preview and reading view, and the hover that holds the Annotation and the Item's reference |
| `annotations-excerpts.e2e.ts` | PDF excerpts, rendering, worker reads |
| `query-file.e2e.ts` | Query File tabs, new-query hotkey |
| `query-view.e2e.ts`, `query-view-properties.e2e.ts`, `query-view-table.e2e.ts`, `query-view-filter.e2e.ts` | Query View UI, formulas, table and Items layout, the Filter's property list |
| `library-view.e2e.ts`, `library-view-navigation.e2e.ts`, `library-view-reading.e2e.ts` | Library View browsing, search, Reading Card |
| `literature-notes.e2e.ts` | Literature Note create/update, profiles, match workbench |
| `template-workbench.e2e.ts` | Template Workbench editing: Properties rows keep their example values through a reorder while the preview renders again |
| `local-bridge.e2e.ts` | Local Bridge / web workbench (needs `WEB_WORKBENCH_ENABLED=true`) |
| `follow-mode.e2e.ts` | Follow Mode menu rendering |
| `query-cli*.e2e.ts` | `zotlit:query`, schema, scope CLI |
| `fresh-destination.e2e.ts` | Fresh vault destination flow |
| `window-reload.e2e.ts` | Window reload startup order; a plugin start-up that a disable interrupts; an off and on again that overlaps the old instance's start-up; old plugin instances released after a restart |
| `walkthrough.e2e.ts` | Walkthrough regressions on the demo vault: the demo starts with Sync disabled; citations (Cited by counts, CSL style, HTML export, render recovery, caret, the Citation Popover on hover, suggester and pickers, citation settings refresh and close); Welcome and Library View tabs; literature note updates; Explorer template actions; Choose item preview; Profile editing; and Annotation fields kept when Customize reopens the Template Workbench |
| `citation-index.e2e.ts` | Citation Index on an isolated Stress Build of 100,000 Items: answers and worker reads stay responsive during a refresh and a rebuild, and a failed snapshot integrity check keeps the held search index |
| `docs-walks/*.walk.ts` | Docs walks, one per /learn lesson, under their own config (see "Docs walks") |

The default reporter prints suite progress, the run's evidence folder, and the final counts. Each run writes its evidence to its own folder, `.scratch/e2e-results/<start time>-<pid>/`, and `.scratch/e2e-results/latest` points to the run that started last. Read `results.json` there for individual results and `console.log` for console evidence. A Paired Run setup failure writes `paired-startup.log` in that folder with the launch error chain. The ten newest run folders stay; copy evidence you need to retain longer. A tool that reads the results of a run it starts sets `ZOTLIT_E2E_RESULTS` to the folder (see `src/verify-worker.ts`).

## Requirements

Needs desktop Obsidian running locally with the CLI enabled (Settings → General → Advanced → "Command line interface"). The app and installer must match the exact version pair in `src/vault-script.ts`; a mismatch fails before Fixture setup. Without a reachable Obsidian, `pnpm e2e` skips its tests cleanly and exits 0. Set `ZOTLIT_E2E_REQUIRED=1` to require Obsidian and fail instead; `pnpm verify --release` sets this variable.

The suite talks to Obsidian's CLI socket directly, so the `obsidian` command need not be registered. Run `packages/scripts/scripts/obsidian-cli.ts version` to verify that Obsidian answers.

The e2e vault's plugin bundle comes from `@zotlit/obsidian`'s dev build (`build:dev`), never the production build: the Scope Case assertion reads `zotlit:library-scope`, a CLI command registered only under `__DEV__` and absent from production plugin bundles.

## Desktop Slot

The desktop Obsidian has a pool of Desktop Slots, 2 by default (`ZOTLIT_DESKTOP_SLOTS`), shared by all clones, worktrees, and sessions on the machine ([ADR 0077](../../docs/adr/0077-desktop-admission-is-an-exclusive-slot-plus-a-memory-gate.md), [ADR 0078](../../docs/adr/0078-desktop-slots-are-a-pool-of-n-vaults.md)). Each holder drives its own vault, so runs in different worktrees overlap; a worktree holds at most one slot at a time. `pnpm e2e` (each Vitest project's first global setup), `pnpm e2e:worker`, `measure:query`, the desktop step of `pnpm verify --release`, and `pnpm fixture open|dev` take a Desktop Slot themselves. A `pnpm e2e` run without a reachable Obsidian skips its tests without the slot. `pnpm desktop-slot --help` has the full contract; code: `packages/scripts/lib/desktop-slot.ts`.

- **Queue:** a waiter joins the Desktop Queue, first in, first out; only its head claims, once a slot is free and no holder from its worktree (its git toplevel) has one. No later waiter overtakes the head. The waiter prints the holders and its position when they change and every 5 min. The head clears the ticket of a dead waiter and takes over from a dead holder (pid gone, or its start time changed).
- **Exclusive Hold:** `measure:query`, `pnpm desktop-slot run --exclusive`, and a docs walk that captures or records take every slot, once all are free, for work that needs the whole app (timings, a screen capture, apps brought to the front). Waiters behind it wait.
- **Admission Deadline:** one deadline covers the queue, the slot, and the Memory Gate: 9 min by default, `--wait <duration>` for `pnpm desktop-slot run`, `ZOTLIT_DESKTOP_WAIT` for the other tools. At the deadline the waiter prints one block that names every holder and the waiters ahead, and exits 75; the Vitest process of `pnpm e2e` exits 75 too. Report it as blocked by the Desktop Slot, held by the process the block names, not as a test failure.
- **Lease:** admission starts a Lease: `pnpm e2e` 20 min, `e2e:worker` 10 min, `measure:query` 2 h, and 30 min for both desktop runs of `pnpm verify --release`. `ZOTLIT_DESKTOP_LEASE=<duration>` overrides these defaults. A manual hold and `pnpm fixture open|dev` must state `--for <duration>`, up to 60 min. No Lease exceeds 2 h. When the Lease ends, the holder ends its own run and exits 76. The head waiter evicts any holder still alive 2 min after its Lease: SIGTERM to its process group, then SIGKILL. An Exclusive Hold's Lease, extension, and eviction cover all its slots.
- **Nested reuse:** the holder exports `ZOTLIT_DESKTOP_SLOT`; a ZotLit tool started under it reuses the hold, inside the same Lease.
- **Manual session:** wrap an `/obsidian-debug` walk or a series of `git commit` runs in `pnpm desktop-slot run --for <duration> -- <command>`. The command runs in its own process group, which the Lease ends. The exit code is the command's.
- **Commands:** `pnpm desktop-slot status` shows each slot with its holder, worktree, Lease end (and whether it is overdue), and whether it is an Exclusive Hold; then the waiters with their deadlines, and the Memory Gate's last start; `--json` prints it for scripts. `pnpm desktop-slot extend <duration>` moves the Lease end of the hold that `ZOTLIT_DESKTOP_SLOT` or `--token` names, only while no one waits. `pnpm desktop-slot evict <token|pid>` ends that holder by the eviction path.
- **Shared app state:** `obsidian-vault open|remove` makes its registry calls under a short machine-wide mutex. Each vault window of a run has an in-memory clipboard (`src/memory-clipboard.ts`, installed by `prepareRunWindow`). A test never uses the OS clipboard, and never opens or removes a vault outside `obsidian-vault`.
- **Memory Gate:** after it claims a slot, a holder passes the Memory Gate: macOS memory pressure is normal, or Windows and Linux commit at most 1.25x physical memory, with waiting runs admitted in arrival order as soon as pressure allows. Root `pnpm test`, the Test step of `pnpm verify`, and a bare `vitest run` also pass it, once per top-level run; nested runs see `ZOTLIT_MEMORY_GATE_ADMITTED` and skip it. `ZOTLIT_MEMORY_GATE=off` skips the gate.
- **State:** `/tmp/zotlit-desktop-<uid>/` (`%TEMP%\zotlit-desktop` on Windows), shared by every clone and cleared on reboot. `ZOTLIT_DESKTOP_DIR` overrides it.

## Isolation

Each suite builds its own Fixture and new purged vaults under `.scratch/e2e-*`. The paired project's setup (`src/paired-setup.ts`) starts its Paired Zotero before test collection and owns its teardown at the end of the run; startup failure stops the run before tests begin. Desktop-only selections do not start Paired Zotero. The next run clears what a crashed run left. The developer's Fixture, Development Vault, and Paired Run stay open and untouched.

- Files within a run go one at a time (`fileParallelism: false`): they share the run's vault and Desktop Slot. Runs in other worktrees hold their own slots.
- The OS focus stays with the developer and with runs in other worktrees, and vault windows and popouts open behind other apps' windows. A docs walk that records under its Exclusive Hold is the one exception (see "Docs walks"). `prepareRunWindow` makes a vault's windows render, and one of them act focused, behind other apps.
- `reloadWindow` (`src/window-reload.ts`) reloads a vault's whole window, so ZotLit loads in Obsidian startup order; use it for bugs a plugin reload hides.
- A Paired Zotero that fails to start or to serve its Local API fails the file.
- `src/paired-zotero.ts` holds the Local API client and the RDP levers. The [Fixture guide](../../docs/fixture.md) has the paths.

## ZotLit Query measurement

`src/query-measure.ts` proves the performance acceptance criteria of ZotLit Query in a visible Obsidian window, on the Stress Build Libraries of 10,000, 50,000, and 100,000 Items. Each tier has two parts: the queries of one Library on the Stress Build of My Library, then the `two-` queries over My Library and the group Library on the Stress Build that fills both to the Item count of the tier. Run it before a release and after a planner change; its header has the usage. The vault window must stay visible for the whole run.

- Thresholds, their evaluation, and the summary format: `src/query-record.ts`, with unit tests beside it. The queries over two Libraries (`twoLibraries` of a tier) have the execution-slice, encoding, renderer responsiveness, and cancel limits, and their totals are recorded. A tier whose run did not end that part has a failed check.
- The measurement vault uses `prepareRunWindow`, like the End-to-end Run, so background timer throttling does not enter responsiveness samples. It remains visible and leaves OS focus with the developer.
- Each tier waits for the normal initial Item Lookup index build before timing ZotLit Query. Its separate renderer hydration and indexing work would otherwise contaminate query responsiveness and total-time samples.
- Worker runs check execution slices and encoding steps against the spec's limits, and check renderer timer gaps against the same limits. Unlimited queries write complete JSON files; the runner deletes each file after its receipt.
- The numbers come from the dev-build command `zotlit:query-measure` (`apps/obsidian/src/services/item-query/measure.ts`). A cancel through the CLI uses the production command `zotlit:query-cancel` with the `id` of the measured run.
- Output goes to `.scratch/query-measure/<time>/`: `raw.json` and `summary.md`, the comment for the release pull request.
