import { randomUUID } from "node:crypto";
// The release-time measurement of ZotLit Query (spec #1314, "Performance
// acceptance criteria"). Run it before a release and after a planner change:
//
//   pnpm exec turbo run build:dev --filter=@zotlit/obsidian
//   pnpm --filter @zotlit/e2e measure:query
//
// It needs desktop Obsidian running with the CLI enabled, as the End-to-end Run
// does (packages/e2e/AGENTS.md). It opens one vault of its own, builds the
// Stress Build Library of each tier, and measures every query through the
// dev-build command `zotlit:query-measure`, which runs the handler of
// `zotlit:query` with the observers of the engine. After the queries of
// one Library, each tier takes the Stress Build of two Libraries (the group
// Library gets the Item count of the tier too) and measures the queries that
// read both as one result set.
//
// THE VAULT WINDOW MUST STAY VISIBLE: on screen, not minimized, and not fully
// covered by another window. Chromium throttles a hidden window, which changes
// every number. The script waits for a visible window before each tier, and it
// repeats a run in which the window was hidden. The E2E window setup disables
// background throttling and emulates focus while leaving OS focus unchanged.
//
// "Cancel through the Obsidian CLI" here is the production command
// `zotlit:query-cancel`, called with the `id` of the measured run from a
// second CLI call. The script measures a plugin unload too, which cancels
// every run.
//
// Output: `.scratch/query-measure/<time>/raw.json` and `summary.md`. Post
// `summary.md` as a comment on the release pull request. The thresholds are in
// `query-record.ts`.
//
// `--help` prints the options and the thresholds.
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { arch, cpus, release, totalmem } from "node:os";
import { join, relative } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import {
  buildFixture,
  discardFixture,
  getFixtureLayout,
} from "@zotlit/scripts/fixture";
import {
  STRESS_GROUP_LIBRARY,
  STRESS_LIBRARY_ITEM_COUNT_CONSTRAINT,
  STRESS_LIBRARY_MIN_ITEM_COUNT,
  STRESS_LIBRARY_TIERS,
  STRESS_LIBRARY_VALUES,
} from "@zotlit/scripts/fixture/spec";
import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import { keepRendering } from "./background-throttling.ts";
import { cli, cliCommand, obEval, waitFor } from "./obsidian-cli.ts";
import {
  DATASET_QUERY_SPECS,
  evaluateTier,
  failedEngineChecks,
  formatSummary,
  median,
  THRESHOLDS,
} from "./query-record.ts";
import type {
  CancelMeasurement,
  HeapMeasurement,
  MissedCancel,
  MeasurementRecord,
  QueryClass,
  QueryMeasurement,
  TierMeasurement,
} from "./query-record.ts";
import {
  clearVault,
  e2eVaultDir,
  isObsidianReachable,
  vaultScript,
} from "./vault-script.ts";

const MEASURE_COMMAND = "zotlit:query-measure";
const CANCEL_COMMAND = "zotlit:query-cancel";
/** One measured call may be a `limit=all` run on 100,000 Items. */
const CALL_TIMEOUT_MS = 180_000;
/** Runs to repeat when the window was hidden in a run. */
const VISIBILITY_RETRIES = 3;

/** The report of `zotlit:query-measure` (apps/obsidian/src/services/item-query/measure.ts). */
interface MeasureReport {
  outcome: "answered" | "cancelled" | "failed";
  error?: string;
  ok?: boolean;
  diagnosticCode?: string;
  returnedCount?: number;
  truncated?: boolean;
  totalMs: number;
  adapterMs?: number;
  engineMs?: number;
  answerMs?: number;
  channels?: { created: number; closed: number; open: number };
  answerBytes?: number;
  answerSteps: number[];
  slices: number[];
  uiGaps: number[];
  worstSlice?: {
    ms: number;
    index: number;
    statements: { reader: string; rows: number }[];
  };
  pauses: number;
  longestPauseMs: number;
  statements: Record<
    string,
    { count: number; rows: number; maxRows: number; longestSliceMs: number }
  >;
  heap?: {
    beforeBytes: number;
    peakBytes: number;
    afterAnswerBytes: number;
    samples: number;
  };
  cancel?: {
    intendedAtMs?: number;
    firedAtMs: number;
    settledAtMs: number;
    firedAtEpochMs: number;
    events?: { phase: string; atEpochMs: number }[];
  };
  window: {
    visibleAtStart: boolean;
    visibleAtEnd: boolean;
    hiddenDuringRun: boolean;
    focused: boolean;
  };
  startedAtEpochMs: number;
}

interface QuerySpec {
  id: string;
  class: QueryClass;
  args: Record<string, string>;
}

const { tags, collections, itemTypes, venues, uniqueTitle } =
  STRESS_LIBRARY_VALUES;
const collectionPath = (...names: string[]): string => names.join("/");
const quote = (value: string): string => JSON.stringify(value);

const SORT_BY_TITLE = "title";

/**
 * The queries of each tier. `selective`: one exact leaf that 0.1% of the
 * Library has, or one key. `other`: every other `limit 100` query, with the
 * 10% leaves, the near-cap union (20%), the dominant leaves that go above the
 * 25% cap and fall back to the scan, and the plain scans. `all`: `limit=all`.
 */
function querySpecs(uniqueKey: string): QuerySpec[] {
  const limited = (
    id: string,
    queryClass: QueryClass,
    filter?: string,
  ): QuerySpec => ({
    id,
    class: queryClass,
    args: { ...(filter === undefined ? {} : { filter }), limit: "100" },
  });
  const common = `tags.contains(${quote(tags.common)})`;
  return [
    ...DATASET_QUERY_SPECS,
    {
      id: "attachments-broken-files",
      class: "other",
      args: {
        from: "attachments",
        filter: 'linkMode == "linked_file" && !exists',
        limit: "100",
      },
    },
    limited("key", "selective", `key == ${quote(uniqueKey)}`),
    limited("title-exact", "selective", `title == ${quote(uniqueTitle)}`),
    limited("tag-rare", "selective", `tags.contains(${quote(tags.rare)})`),
    limited(
      "collection-rare",
      "selective",
      `collections.contains(${quote(collectionPath(collections.root.name, collections.common.name, collections.rare.name))})`,
    ),
    limited(
      "venue-rare",
      "selective",
      `publicationTitle == ${quote(venues.rare)}`,
    ),
    // Zotero has no index on the item type, so this leaf gives no candidate
    // set and the query is a scan, whatever share of the Library matches.
    limited("item-type-rare", "other", `itemType == ${quote(itemTypes.rare)}`),
    limited("tag-common", "other", common),
    limited(
      "collection-common",
      "other",
      `collections.contains(${quote(collectionPath(collections.root.name, collections.common.name))})`,
    ),
    limited(
      "collection-within-common",
      "other",
      `collections.within(${quote(collectionPath(collections.root.name, collections.common.name))})`,
    ),
    {
      id: "collection-annotation-parent",
      class: "other",
      args: {
        from: "annotations",
        // The Stress Build keeps the Fixture's annotated Items in Shared key;
        // its synthetic Items in the Stress Build Collections have no marks.
        filter: `attachment.item.collections.within(${quote(collectionPath("Shared key"))})`,
        limit: "100",
      },
    },
    limited(
      "venue-common",
      "other",
      `publicationTitle == ${quote(venues.common)}`,
    ),
    // Two disjoint 10% leaves: the largest candidate set the Stress Build
    // gives under the 25% cap.
    limited(
      "near-cap-union",
      "other",
      `${common} || collections.contains(${quote(collectionPath(collections.root.name, collections.common.name))})`,
    ),
    // One candidate statement returns `cap + 1` IDs, then the scan runs.
    limited("tag-dominant", "other", `tags.contains(${quote(tags.dominant)})`),
    limited(
      "collection-dominant",
      "other",
      `collections.contains(${quote(collectionPath(collections.root.name, collections.dominant.name))})`,
    ),
    limited("scan-no-filter", "other"),
    limited("scan-title-contains", "other", 'title.contains("stress item 1")'),
    {
      id: "scan-sort-title",
      class: "other",
      args: {
        limit: "100",
        sort: SORT_BY_TITLE,
      },
    },
    limited("scan-no-match", "other", 'title.contains("no such title")'),
    {
      id: "annotations-group-all",
      class: "all",
      args: { from: "annotations", group: "item.citationKey", limit: "all" },
    },
    { id: "all", class: "all", args: { limit: "all" } },
    { id: "all-keys", class: "all", args: { limit: "all", fields: "[]" } },
    {
      id: "all-tag-common",
      class: "all",
      args: { filter: common, limit: "all" },
    },
    {
      id: "all-sort-title",
      class: "all",
      args: {
        limit: "all",
        sort: SORT_BY_TITLE,
      },
    },
  ];
}

/** The arguments that name My Library and the group Library of the Stress Build. */
const TWO_LIBRARY_ARGS = {
  library: `personal,group:${STRESS_GROUP_LIBRARY.groupID}`,
};
/**
 * The queries over two large Libraries as one result set. An unlimited query
 * holds a match for every Item of both. A query that names no sort has the
 * default sort, `dateModified` descending; `two-all-no-sort` gives an empty
 * sort list, so the Indexed Key alone orders its matches.
 */
const TWO_LIBRARY_ALL: QuerySpec = {
  id: "two-all",
  class: "all",
  args: { ...TWO_LIBRARY_ARGS, limit: "all" },
};
const TWO_LIBRARY_SPECS: readonly QuerySpec[] = [
  TWO_LIBRARY_ALL,
  {
    id: "two-all-sort-title",
    class: "all",
    args: { ...TWO_LIBRARY_ARGS, limit: "all", sort: SORT_BY_TITLE },
  },
  {
    id: "two-all-no-sort",
    class: "all",
    args: { ...TWO_LIBRARY_ARGS, limit: "all", sort: "[]" },
  },
  {
    id: "two-all-keys",
    class: "all",
    args: { ...TWO_LIBRARY_ARGS, limit: "all", fields: "[]" },
  },
  {
    id: "two-scan-no-filter",
    class: "other",
    args: { ...TWO_LIBRARY_ARGS, limit: "100" },
  },
  {
    id: "two-scan-sort-title",
    class: "other",
    args: { ...TWO_LIBRARY_ARGS, limit: "100", sort: SORT_BY_TITLE },
  },
];

/** The runs of each query; the record takes their median. */
const DEFAULT_RUNS = 5;

/** The reference of `--help`, from the constants the script runs on. */
function renderReference(): string {
  const totals = Object.entries(THRESHOLDS.totalMs).flatMap(
    ([queryClass, budgets]) =>
      Object.entries(budgets).map(
        ([items, budget]) =>
          `  ${queryClass} limit 100 at ${Number(items).toLocaleString("en-US")} Items: median total at most ${budget} ms`,
      ),
  );
  return [
    "The vault window must stay visible for the whole run: on screen, not",
    "minimized, and not fully covered by another window.",
    "",
    "Tiers:",
    `  Default: ${STRESS_LIBRARY_TIERS.join(", ")} Items in My Library.`,
    `  A tier is ${STRESS_LIBRARY_ITEM_COUNT_CONSTRAINT}.`,
    "  A tier without a time threshold is recorded only.",
    `  Two Libraries: each tier also fills the group Library ${STRESS_GROUP_LIBRARY.name} to its`,
    `  Item count and measures ${TWO_LIBRARY_SPECS.map(({ id }) => id).join(", ")} over both,`,
    "  with the slice and cancel thresholds; their totals are recorded only.",
    "",
    "Thresholds:",
    `  slices: 99th percentile at most ${THRESHOLDS.slice.p99Ms} ms, longest at most ${THRESHOLDS.slice.maxMs} ms`,
    `  cancel: settled within ${THRESHOLDS.cancelMs} ms of the request`,
    ...totals,
    "",
    "Output:",
    "  .scratch/query-measure/<time>/raw.json and summary.md",
  ].join("\n");
}

/**
 * @throws {Error} when an entry is not an Item count a Stress Build takes.
 */
function parseTiers(text: string): number[] {
  return text.split(",").map((entry) => {
    const items = Number(entry.trim());
    if (
      entry.trim() === "" ||
      !Number.isSafeInteger(items) ||
      items < STRESS_LIBRARY_MIN_ITEM_COUNT
    ) {
      throw new Error(
        `--tiers: "${entry}" is not ${STRESS_LIBRARY_ITEM_COUNT_CONSTRAINT}`,
      );
    }
    return items;
  });
}

const options = await yargs(hideBin(process.argv))
  .scriptName("measure:query")
  .usage("$0 [--tiers=<items,...>] [--runs=<n>] [--keep]")
  .option("tiers", {
    describe:
      "Item counts of the Stress Build tiers to measure, comma-separated",
    type: "string",
    default: STRESS_LIBRARY_TIERS.join(","),
    coerce: parseTiers,
  })
  .option("runs", {
    describe: "Measured runs of each query, after one warm-up run",
    type: "number",
    default: DEFAULT_RUNS,
  })
  .option("keep", {
    describe: "Keep the vault and the Fixture when the script ends",
    type: "boolean",
    default: false,
  })
  .check(({ runs }) => {
    if (Number.isSafeInteger(runs) && runs >= 1) return true;
    throw new Error("--runs: give a whole number of at least 1");
  })
  .epilogue(renderReference())
  .strict()
  .version(false)
  .parse();
const { tiers } = options;
const runCount = options.runs;

const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);
const scratch = join(workspaceRoot, ".scratch", "query-measure");
const fixture = getFixtureLayout(join(scratch, "fixture"));
const vaultPath = e2eVaultDir(workspaceRoot, "query-measure");
const pluginBundleDir = join(workspaceRoot, "apps", "obsidian", "dist-dev");
const runVaultScript = vaultScript(workspaceRoot, fixture.root);
const startedAt = Temporal.Now.instant();
const outDir = join(
  scratch,
  startedAt.toString().replaceAll(":", "-").slice(0, 19),
);

await mkdir(outDir, { recursive: true });

const log = (message: string): void => console.error(message);

if (!(await isObsidianReachable(workspaceRoot))) {
  log(
    "No desktop Obsidian answers the CLI. Start Obsidian with the command line interface enabled, then run the script again. Nothing was measured.",
  );
  process.exit(1);
}

let vaultId = "";

/** The window is on screen and Chromium counts the page as visible. */
async function isVisible(): Promise<boolean> {
  const state = await obEval(
    vaultId,
    "(()=>{const win=require('@electron/remote').getCurrentWindow();return String(document.visibilityState==='visible'&&win.isVisible()&&!win.isMinimized());})()",
  ).catch(() => "false");
  return state === "true";
}

/** Wait for a visible window; the maintainer brings it forward. */
async function requireVisible(): Promise<void> {
  if (await isVisible()) return;
  // Shows a hidden or minimized window and leaves the OS focus where it is.
  await obEval(
    vaultId,
    "(()=>{const win=require('@electron/remote').getCurrentWindow();if(win.isMinimized())win.restore();win.showInactive();return true;})()",
  );
  log(
    `The window of the vault at ${vaultPath} is hidden. Bring it on screen and keep it uncovered: the script waits for 2 minutes.`,
  );
  if (await waitFor(isVisible, 480)) return;
  throw new Error(
    "The vault window stayed hidden. Nothing more was measured: keep the window visible and run the script again.",
  );
}

/**
 * The Library every query reads: the Stress Build fills My Library, and the
 * thresholds are those of one Library.
 */
const STRESS_LIBRARY = { library: "personal" };

/** One measured run. A run with a hidden window is repeated. */
async function measure(args: Record<string, string>): Promise<MeasureReport> {
  for (let attempt = 0; ; attempt++) {
    const output =
      args.limit === "all"
        ? join(outDir, `export-${randomUUID()}.json`)
        : undefined;
    let report: MeasureReport;
    try {
      report = JSON.parse(
        await cliCommand(vaultId, MEASURE_COMMAND, {
          args: { ...STRESS_LIBRARY, ...args, ...(output ? { output } : {}) },
          timeoutMs: CALL_TIMEOUT_MS,
        }),
      ) as MeasureReport;
    } finally {
      if (output) await rm(output, { force: true });
    }
    if (!report.window.hiddenDuringRun && report.window.visibleAtEnd) {
      return report;
    }
    if (attempt === VISIBILITY_RETRIES) {
      throw new Error(
        "The vault window was hidden in every try of one run. Keep it visible and run the script again.",
      );
    }
    await requireVisible();
  }
}

function expectAnswered(id: string, report: MeasureReport): MeasureReport {
  if (report.outcome !== "answered" || report.ok !== true) {
    throw new Error(
      `query ${id} did not answer a result: ${report.outcome} ${report.diagnosticCode ?? report.error ?? ""}`,
    );
  }
  return report;
}

/**
 * Wait until the plugin answers a query.
 *
 * @throws {Error} `failure`, with the last answer or error of the plugin.
 */
async function requirePluginReady(failure: string): Promise<void> {
  let last = "no answer";
  const ready = await waitFor(async () => {
    const answer = await cliCommand(vaultId, MEASURE_COMMAND, {
      args: {
        ...STRESS_LIBRARY,
        limit: "1",
        fields: "[]",
      },
    }).catch((error: unknown) => {
      last = `error: ${error instanceof Error ? error.message : String(error)}`;
      return undefined;
    });
    if (answer === undefined) return false;
    last = `answer: ${answer}`;
    try {
      return (JSON.parse(answer) as MeasureReport).ok === true;
    } catch {
      return false;
    }
  }, 240);
  if (!ready) throw new Error(`${failure}. Last ${last}`);
}

/**
 * Replace the Fixture database with the Stress Build of `items` Items. With
 * `groupItems`, the group Library of the Stress Build has that Item count.
 */
async function loadTier(items: number, groupItems?: number): Promise<void> {
  await cli([`vault=${vaultId}`, "plugin:disable", "id=zotlit"]);
  await buildFixture(fixture, {
    stressLibraryItemCount: items,
    stressGroupLibraryItemCount: groupItems,
    pluginBundleDir,
    linkedAttachmentVaultDir: vaultPath,
  });
  await cli([`vault=${vaultId}`, "plugin:enable", "id=zotlit"]);
  await requirePluginReady(
    `ZotLit did not answer a query on the ${items}-Item tier`,
  );
  // Initial fuzzy-search indexing is a separate renderer job. Wait for its
  // normal completion so this record measures ZotLit Query rather than startup.
  log("Waiting for the search index of this Fixture to finish...");
  await obEval(
    vaultId,
    '(async()=>{const hits=await app.plugins.plugins.zotlit.services.itemLookup.search("",{limit:1});if(hits.length!==1)throw new Error("Search index did not produce its first result");return true;})()',
    600_000,
  );
  // Citation snapshot pages share the query worker. Await the successful read;
  // Citation Index.ready only marks listener registration.
  log("Waiting for the Citation Index snapshot of this Fixture to finish...");
  await obEval(
    vaultId,
    "(async()=>{await app.plugins.plugins.zotlit.services.citationIndex.readSnapshot();return true;})()",
    600_000,
  );
}

interface RawQuery {
  spec: QuerySpec;
  warmUp: MeasureReport;
  runs: MeasureReport[];
}

interface RawCancel {
  delivery: CancelMeasurement["delivery"];
  query: string;
  /** When the terminal sent the cancel call. */
  sentAtEpochMs?: number;
  /** When the request reached the window. */
  arrivedAtEpochMs?: number;
  report: MeasureReport;
}

interface RawTier {
  items: number;
  uniqueKey: string;
  queries: RawQuery[];
  heaps: { spec: QuerySpec; runs: MeasureReport[] }[];
  cancels: RawCancel[];
  /** The cancel requests whose run gave no report. */
  unreported: { delivery: CancelMeasurement["delivery"]; query: string }[];
  /** The queries over two Libraries, each with the Items of the tier. */
  twoLibraries: {
    queries: RawQuery[];
    cancels: RawCancel[];
    /** The run measured every query and every cancel of the part. */
    complete: boolean;
  };
}

/** One warm-up run and the measured runs of one query. */
async function measureQuery(spec: QuerySpec): Promise<RawQuery> {
  const warmUp = expectAnswered(spec.id, await measure(spec.args));
  const runs: MeasureReport[] = [];
  for (let run = 0; run < runCount; run++) {
    runs.push(expectAnswered(spec.id, await measure(spec.args)));
  }
  log(
    `${spec.id}: median ${median(runs.map((run) => run.totalMs)).toFixed(1)} ms, worst slices ${runs.map((run) => run.worstSlice?.ms ?? 0).join(", ")} ms`,
  );
  return { spec, warmUp, runs };
}

/** The time a cancel can interrupt: the handler up to the end of the engine. */
function cancellableMs({ runs }: RawQuery): number {
  return median(runs.map((run) => (run.adapterMs ?? 0) + (run.engineMs ?? 0)));
}

/** Cancel one run of a query by a timer at a fraction of `cancellable`. */
async function cancelByTimer(
  spec: QuerySpec,
  { cancellable, fraction }: { cancellable: number; fraction: number },
): Promise<RawCancel> {
  return {
    delivery: "timer",
    query: `${spec.id} at ${fraction * 100}%`,
    report: await measure({
      ...spec.args,
      cancelAfterMs: String(Math.round(cancellable * fraction)),
    }),
  };
}

/** The wait before a cancel that comes from outside the window. */
function outsideCancelDelayMs(cancellable: number): number {
  return Math.min(cancellable * 0.3, 300);
}

/** Cancel one run of a query by a second CLI call that arrives in the run. */
async function cancelThroughCli(
  spec: QuerySpec,
  delayMs: number,
): Promise<RawCancel> {
  const id = `measure-${randomUUID()}`;
  const running = measure({ ...spec.args, id });
  await delay(delayMs);
  const sentAtEpochMs = Temporal.Now.instant().epochMilliseconds;
  const answer = JSON.parse(
    await cliCommand(vaultId, CANCEL_COMMAND, { args: { id } }),
  ) as { ok: boolean };
  if (!answer.ok) {
    throw new Error(`${CANCEL_COMMAND} failed: ${JSON.stringify(answer)}`);
  }
  const report = await running;
  return {
    delivery: "cli",
    query: spec.id,
    sentAtEpochMs,
    // The cancel command aborts the run when the call arrives in the window.
    arrivedAtEpochMs: report.cancel?.firedAtEpochMs,
    report,
  };
}

/** Measure one tier into `raw`, so a run that stops early keeps its part. */
async function measureTier(raw: RawTier): Promise<void> {
  const { items } = raw;
  log(`\n== ${items.toLocaleString("en-US")} Items ==`);
  await loadTier(items);
  await requireVisible();

  const located = JSON.parse(
    await cliCommand(vaultId, "zotlit:query", {
      args: {
        ...STRESS_LIBRARY,
        filter: `title == ${quote(uniqueTitle)}`,
        fields: "[]",
      },
    }),
  ) as { rows?: { indexedKey: string }[] };
  const uniqueKey = located.rows?.[0]?.indexedKey;
  if (!uniqueKey) throw new Error("the Stress Build has no unique-title Item");
  raw.uniqueKey = uniqueKey;
  const specs = querySpecs(uniqueKey);

  for (const spec of specs) raw.queries.push(await measureQuery(spec));

  // Absolute worker heap: a limited query and unlimited projections.
  const byId = (id: string): QuerySpec => specs.find((spec) => spec.id === id)!;
  for (const spec of [byId("scan-no-filter"), byId("all"), byId("all-keys")]) {
    const runs: MeasureReport[] = [];
    for (let run = 0; run < 3; run++) {
      runs.push(
        expectAnswered(spec.id, await measure({ ...spec.args, heap: "true" })),
      );
    }
    raw.heaps.push({ spec, runs });
  }

  // Cancel: the longest query, cancelled at five points of its run by a timer.
  const exportSpec = byId("all");
  const exportMs = cancellableMs(
    raw.queries.find(({ spec }) => spec === exportSpec)!,
  );
  for (const fraction of [0.1, 0.3, 0.5, 0.7, 0.9]) {
    raw.cancels.push(
      await cancelByTimer(exportSpec, { cancellable: exportMs, fraction }),
    );
  }

  // Cancel through a second CLI call, which arrives while the run is in progress.
  const cancelDelayMs = outsideCancelDelayMs(exportMs);
  for (let run = 0; run < 3; run++) {
    raw.cancels.push(await cancelThroughCli(exportSpec, cancelDelayMs));
  }

  // The cancel the product has for a CLI run: the plugin unloads.
  {
    const running = measure(exportSpec.args);
    await delay(cancelDelayMs);
    const sentAtEpochMs = Temporal.Now.instant().epochMilliseconds;
    const arrivedAtEpochMs = Number(
      await obEval(
        vaultId,
        "(async()=>{const at=Date.now();await app.plugins.disablePlugin('zotlit');return String(at);})()",
      ),
    );
    const report = await running.catch((error: unknown) => {
      log(`the run did not report after the unload: ${String(error)}`);
      return undefined;
    });
    if (report) {
      raw.cancels.push({
        delivery: "unload",
        query: exportSpec.id,
        sentAtEpochMs,
        arrivedAtEpochMs,
        report,
      });
    } else {
      raw.unreported.push({ delivery: "unload", query: exportSpec.id });
    }
    // `disablePlugin` leaves the plugin in the enabled list, so the CLI
    // `plugin:enable` refuses; load it again in the same way.
    await obEval(
      vaultId,
      "(async()=>{await app.plugins.enablePlugin('zotlit');return true;})()",
    );
    await requirePluginReady(
      "ZotLit did not load again after the unload cancel",
    );
  }

  await measureTwoLibraries(raw);
}

/**
 * Measure the queries over two Libraries into `raw`, on the Stress Build that
 * gives the group Library the Item count of the tier too. The queries of one
 * Library ran before, on the Stress Build of My Library alone.
 */
async function measureTwoLibraries(raw: RawTier): Promise<void> {
  const { items, twoLibraries: part } = raw;
  log(
    `\n== ${items.toLocaleString("en-US")} Items in each of two Libraries ==`,
  );
  await loadTier(items, items);
  await requireVisible();

  for (const spec of TWO_LIBRARY_SPECS) {
    part.queries.push(await measureQuery(spec));
  }
  const all = part.queries.find(({ spec }) => spec === TWO_LIBRARY_ALL)!;
  const rows = all.runs[0]!.returnedCount;
  if (rows !== items * 2) {
    throw new Error(
      `${TWO_LIBRARY_ALL.id} returned ${rows} rows: the two Libraries hold ${items * 2} Items`,
    );
  }

  const allMs = cancellableMs(all);
  for (const fraction of [0.3, 0.7]) {
    part.cancels.push(
      await cancelByTimer(TWO_LIBRARY_ALL, { cancellable: allMs, fraction }),
    );
  }
  part.cancels.push(
    await cancelThroughCli(TWO_LIBRARY_ALL, outsideCancelDelayMs(allMs)),
  );
  part.complete = true;
}

function toQuery(
  { spec, runs }: RawQuery,
  tier: string,
  notes: string[],
): QueryMeasurement {
  const counts = new Set(runs.map((run) => run.returnedCount));
  if (counts.size !== 1) {
    notes.push(
      `${tier} Items: \`${spec.id}\` returned different row counts in its runs (${[...counts].join(", ")}).`,
    );
  }
  return {
    id: spec.id,
    class: spec.class,
    args: spec.args,
    returnedCount: runs[0]!.returnedCount ?? 0,
    runs: runs.map((run) => ({
      totalMs: run.totalMs,
      slices: run.slices,
      answerSteps: run.answerSteps,
      uiGaps: run.uiGaps,
      worstSliceReaders: [
        ...new Set(
          run.worstSlice?.statements.map(({ reader }) => reader) ?? [],
        ),
      ],
    })),
  };
}

/** The measured cancels, and the requests that measured nothing. */
function toCancels(
  rawCancels: readonly RawCancel[],
  tier: string,
  notes: string[],
): { cancels: CancelMeasurement[]; missedCancels: MissedCancel[] } {
  const cancels: CancelMeasurement[] = [];
  const missedCancels: MissedCancel[] = [];
  for (const {
    delivery,
    query,
    sentAtEpochMs,
    arrivedAtEpochMs,
    report,
  } of rawCancels) {
    if (report.outcome !== "cancelled" || !report.cancel) {
      notes.push(
        `${tier} Items: the ${delivery} cancel of \`${query}\` was not measured: the run ended (${report.outcome}) before the request arrived.`,
      );
      missedCancels.push({ delivery, query, outcome: report.outcome });
      continue;
    }
    const settledAtEpochMs =
      report.startedAtEpochMs + report.cancel.settledAtMs;
    cancels.push({
      delivery,
      query,
      latencyMs:
        delivery === "timer"
          ? report.cancel.settledAtMs - report.cancel.intendedAtMs!
          : settledAtEpochMs - arrivedAtEpochMs!,
      transportMs:
        delivery === "timer" ? undefined : arrivedAtEpochMs! - sentAtEpochMs!,
      worstSliceMs: report.worstSlice?.ms,
    });
  }
  return { cancels, missedCancels };
}

/** The measurements of one tier, with the notes on runs that gave none. */
function toTier(raw: RawTier, notes: string[]): TierMeasurement {
  const tier = raw.items.toLocaleString("en-US");
  const queries = raw.queries.map((query) => toQuery(query, tier, notes));
  const measuredCancels = toCancels(raw.cancels, tier, notes);
  const cancels = measuredCancels.cancels;
  const missedCancels: MissedCancel[] = [
    ...raw.unreported.map((missed) => ({ ...missed, outcome: "no report" })),
    ...measuredCancels.missedCancels,
  ];

  const heaps = raw.heaps.map(({ spec, runs }): HeapMeasurement => {
    const peak = (run: MeasureReport) => run.heap!.peakBytes;
    const worst = runs.toSorted((a, b) => peak(b) - peak(a))[0]!;
    return {
      query: spec.id,
      class: spec.class,
      returnedCount: worst.returnedCount ?? 0,
      peakBytes: peak(worst),
      beforeBytes: worst.heap!.beforeBytes,
      afterAnswerBytes: worst.heap!.afterAnswerBytes,
    };
  });
  const rawPart = raw.twoLibraries;
  return {
    items: raw.items,
    queries,
    cancels,
    missedCancels,
    heaps,
    // A run that stopped before the queries of two Libraries has no part.
    twoLibraries:
      rawPart.queries.length > 0
        ? {
            groupItems: raw.items,
            queries: rawPart.queries.map((query) =>
              toQuery(query, tier, notes),
            ),
            ...toCancels(rawPart.cancels, tier, notes),
            complete: rawPart.complete,
          }
        : undefined,
  };
}

/** The statements each record makes from its own data. */
function findings(rawTiers: RawTier[], tiers: TierMeasurement[]): string[] {
  const notes: string[] = [];
  const allRuns = (raw: RawTier): MeasureReport[] =>
    raw.queries.flatMap(({ runs }) => runs);
  const longest = (raw: RawTier, reader: string): number =>
    Math.max(
      0,
      ...allRuns(raw).map((run) => run.statements[reader]?.longestSliceMs ?? 0),
    );
  const each = (text: (raw: RawTier) => string): string =>
    rawTiers
      .map((raw) => `${raw.items.toLocaleString("en-US")} Items: ${text(raw)}`)
      .join("; ");

  // Keyset paging: every query that reads a scan page.
  const scanFailures = tiers.flatMap((tier, index) => {
    const scanning = new Set(
      rawTiers[index]!.queries.filter(({ runs }) =>
        runs.some((run) => run.statements["scan-page"]),
      ).map(({ spec }) => spec.id),
    );
    return failedEngineChecks(tier, scanning);
  });
  notes.push(
    `Queries that read scan pages ${scanFailures.length === 0 ? "meet the execution-slice, renderer responsiveness, and total-time budgets" : `miss the budgets in ${scanFailures.length} checks (see the failed thresholds)`}. Longest worker slice with a scan page: ${each((raw) => `${longest(raw, "scan-page").toFixed(1)} ms`)}.`,
  );
  notes.push(
    `Candidate statements: the largest one returned ${each((raw) => `${Math.max(0, ...allRuns(raw).map((run) => run.statements["candidate-set"]?.maxRows ?? 0)).toLocaleString("en-US")} IDs, longest slice with a candidate statement ${longest(raw, "candidate-set").toFixed(1)} ms`)}. Renderer responsiveness is evaluated separately.`,
  );
  notes.push(
    `JSON encoding runs inside query execution, one projection chunk at a time. Its largest cumulative synchronous encoding time: ${each((raw) => `${Math.max(0, ...raw.queries.filter(({ spec }) => spec.class !== "all").flatMap(({ runs }) => runs.map((run) => run.answerMs ?? 0))).toFixed(1)} ms for \`limit 100\`, ${Math.max(0, ...raw.queries.filter(({ spec }) => spec.class === "all").flatMap(({ runs }) => runs.map((run) => run.answerMs ?? 0))).toFixed(1)} ms for \`limit=all\``)}. File I/O and scheduler waits are included in total query time.`,
  );
  notes.push(
    "Cancel, timer: a timer in the window aborts the run; the time is from the moment the timer was due to the rejection of the handler. Cancel, cli: a second Obsidian CLI call, the production `zotlit:query-cancel` with the `id` of the run, aborts the run; the time is from the arrival of that call in the window to the rejection, and the transport from the terminal to the window is given apart. Cancel, unload: the plugin unloads and cancels every run; the time is from the start of the unload to the rejection.",
  );
  const megabytes = (bytes: number): string => (bytes / 1024 / 1024).toFixed(1);
  notes.push(
    `Absolute worker heap peak of the limited scan: ${each((raw) => `${megabytes(Math.max(0, ...raw.heaps.filter(({ spec }) => spec.class !== "all").flatMap(({ runs }) => runs.map((run) => run.heap!.peakBytes))))} MB`)}. Baseline and final heap are recorded separately; these runs do not force garbage collection. The retention tests check live rows independently of V8 collection timing.`,
  );
  notes.push(
    `Scheduler channels in completed worker runs: ${each((raw) => {
      const counts = allRuns(raw).flatMap((run) => run.channels ?? []);
      return `${counts.reduce((n, count) => n + count.created, 0)} opened, ${counts.reduce((n, count) => n + count.closed, 0)} closed, ${Math.max(0, ...counts.map((count) => count.open))} maximum left open`;
    })}. Cancelled jobs acknowledge closed files and SQLite connections, or await process exit when a forced stop is needed.`,
  );
  const twoLibraries = rawTiers.filter(
    (raw) => raw.twoLibraries.queries.length > 0,
  );
  if (twoLibraries.length > 0) {
    const stats = (query: RawQuery | undefined): string =>
      query
        ? `${(query.runs[0]!.returnedCount ?? 0).toLocaleString("en-US")} rows, median ${median(query.runs.map((run) => run.totalMs)).toFixed(0)} ms, longest slice ${Math.max(0, ...query.runs.flatMap((run) => run.slices)).toFixed(1)} ms`
        : "not measured";
    const byId = (queries: RawQuery[], id: string): RawQuery | undefined =>
      queries.find(({ spec }) => spec.id === id);
    notes.push(
      `Two Libraries: after the queries of one Library, each tier takes the Stress Build that also fills the group Library ${STRESS_GROUP_LIBRARY.name} to the Item count of the tier, and the \`two-\` queries read both Libraries as one result set. \`limit=all\` with the default fields and the default sort (\`dateModified\` descending), two Libraries against one: ${twoLibraries.map((raw) => `${raw.items.toLocaleString("en-US")} Items: ${stats(byId(raw.twoLibraries.queries, TWO_LIBRARY_ALL.id))} against ${stats(byId(raw.queries, "all"))}`).join("; ")}.`,
    );
  }
  return notes;
}

async function environment(): Promise<string[]> {
  const versions = await obEval(
    vaultId,
    "JSON.stringify({obsidian:require('electron').ipcRenderer.sendSync('version'),electron:process.versions.electron,chrome:process.versions.chrome,zotlit:app.plugins.manifests.zotlit.version})",
  ).catch(() => "{}");
  const { obsidian, electron, chrome, zotlit } = JSON.parse(versions) as Record<
    string,
    string | undefined
  >;
  return [
    `Machine: ${cpus()[0]?.model ?? "unknown CPU"}, ${Math.round(totalmem() / 1024 ** 3)} GB, ${process.platform} ${arch()} ${release()}.`,
    `Obsidian ${obsidian ?? "?"} (Electron ${electron ?? "?"}, Chromium ${chrome ?? "?"}), ZotLit ${zotlit ?? "?"} dev build, ${runCount} runs for each query after one warm-up run.`,
  ];
}

await clearVault(runVaultScript, vaultPath);
const pluginDir = join(vaultPath, ".obsidian", "plugins", "zotlit");
await mkdir(pluginDir, { recursive: true });
await cp(pluginBundleDir, pluginDir, { recursive: true });

const rawTiers: RawTier[] = [];
let failure: Error | undefined;
let environmentLines: string[] = [];
try {
  const created = await runVaultScript(["create", vaultPath]);
  vaultId = created.stdout.trim().split("\n")[0]!.trim();
  await keepRendering(vaultId);
  environmentLines = await environment();
  for (const items of tiers) {
    const raw: RawTier = {
      items,
      uniqueKey: "",
      queries: [],
      heaps: [],
      cancels: [],
      unreported: [],
      twoLibraries: { queries: [], cancels: [], complete: false },
    };
    rawTiers.push(raw);
    await measureTier(raw);
  }
} catch (error) {
  // The tiers measured so far are still written.
  failure = error instanceof Error ? error : new Error(String(error));
} finally {
  if (!options.keep) {
    await runVaultScript(["remove", vaultPath, "--purge"]).catch(
      (error: unknown) => log(`could not remove the vault: ${String(error)}`),
    );
    await discardFixture(fixture);
  }
}

await mkdir(outDir, { recursive: true });
const rawPath = join(outDir, "raw.json");
const notes: string[] = [
  "Queries run in Electron utility processes. The measurement vault uses the E2E window setup: background throttling is disabled and focus is emulated without moving OS focus. Execution slices and encoding steps retain the spec's 16 ms p99 / 32 ms maximum limits. Renderer timer gaps (4 ms sampling) are an additional check against those limits. All limit=all runs write complete JSON files and return small receipts. These measurements include worker transfer and export publication. Fixture startup and initial search indexing finish before timing begins.",
];
const measured = rawTiers.map((raw) => toTier(raw, notes));
if (failure) {
  notes.push(
    `The run stopped early, in tier ${rawTiers.length} of ${tiers.length}: ${failure.message}`,
  );
}
const record: MeasurementRecord = {
  startedAt: startedAt.toString({ smallestUnit: "millisecond" }),
  environment: environmentLines,
  tiers: measured,
  notes: [...findings(rawTiers, measured), ...notes],
  rawPath: relative(workspaceRoot, rawPath),
};
await writeFile(
  rawPath,
  `${JSON.stringify({ record, tiers: rawTiers }, null, 1)}\n`,
);
const summary = formatSummary(record);
await writeFile(join(outDir, "summary.md"), summary);
process.stdout.write(summary);
log(`\nWritten to ${outDir}`);
if (failure) {
  console.error(failure);
  process.exit(1);
}
// A failed threshold blocks the release.
if (
  measured.some((tier) =>
    evaluateTier(tier).some((check) => check.status === "failed"),
  )
) {
  process.exitCode = 2;
}
