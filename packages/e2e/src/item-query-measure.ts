// The release-time measurement of Item Query (spec #1314, "Performance
// acceptance criteria"). Run it before a release and after a planner change:
//
//   pnpm exec turbo run build:dev --filter=@zotlit/obsidian
//   pnpm --filter @zotlit/e2e measure:item-query
//
// It needs desktop Obsidian running with the CLI enabled, as the End-to-end Run
// does (packages/e2e/AGENTS.md). It opens one vault of its own, builds the
// Stress Build Library of each tier, and measures every query through the
// dev-build command `zotlit:item-query-measure`, which runs the handler of
// `zotlit:item-query` with the observers of the engine.
//
// THE VAULT WINDOW MUST STAY VISIBLE: on screen, not minimized, and not fully
// covered by another window. Chromium throttles a hidden window, which changes
// every number. The script waits for a visible window before each tier, and it
// repeats a run in which the window was hidden. It leaves background
// throttling on: the numbers are those of the window a user works in.
//
// "Cancel through the Obsidian CLI" here is a second CLI call
// (`zotlit:item-query-measure-cancel`) that aborts the measured run. Obsidian
// gives a CLI handler no `AbortSignal`, so `zotlit:item-query` has no cancel
// command: in the product, only a plugin unload cancels a CLI run. The script
// measures the unload too.
//
// Output: `.scratch/item-query-measure/<time>/raw.json` and `summary.md`. Post
// `summary.md` as a comment on the release pull request. The thresholds are in
// `item-query-record.ts`.
//
// `--help` prints the options and the thresholds.

import { cp, mkdir, writeFile } from "node:fs/promises";
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
  STRESS_LIBRARY_ITEM_COUNT_CONSTRAINT,
  STRESS_LIBRARY_MIN_ITEM_COUNT,
  STRESS_LIBRARY_TIERS,
  STRESS_LIBRARY_VALUES,
} from "@zotlit/scripts/fixture/spec";
import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import {
  evaluateTier,
  formatSummary,
  median,
  THRESHOLDS,
} from "./item-query-record.ts";
import type {
  CancelMeasurement,
  HeapMeasurement,
  MissedCancel,
  MeasurementRecord,
  QueryClass,
  QueryMeasurement,
  TierMeasurement,
} from "./item-query-record.ts";
import { cli, cliCommand, obEval, waitFor } from "./obsidian-cli.ts";
import {
  clearVault,
  e2eVaultDir,
  isObsidianReachable,
  vaultScript,
} from "./vault-script.ts";

const MEASURE_COMMAND = "zotlit:item-query-measure";
const CANCEL_COMMAND = "zotlit:item-query-measure-cancel";
/** One measured call may be a `limit=all` run on 100,000 Items. */
const CALL_TIMEOUT_MS = 180_000;
/** Runs to repeat when the window was hidden in a run. */
const VISIBILITY_RETRIES = 3;

/** The report of `zotlit:item-query-measure` (apps/obsidian/src/services/item-query/measure.ts). */
interface MeasureReport {
  outcome: "answered" | "cancelled" | "failed";
  error?: string;
  ok?: boolean;
  diagnosticCode?: string;
  returnedCount?: number;
  truncated?: boolean;
  totalMs: number;
  leaseMs?: number;
  engineMs?: number;
  answerMs?: number;
  answerBytes?: number;
  slices: number[];
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
    engineSettledAtMs?: number;
    settledAtMs: number;
    firedAtEpochMs: number;
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
const collectionPath = (...names: string[]): string =>
  [collections.root.name, ...names].join("/");
const quote = (value: string): string => JSON.stringify(value);

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
    limited("key", "selective", `key == ${quote(uniqueKey)}`),
    limited("title-exact", "selective", `title == ${quote(uniqueTitle)}`),
    limited("tag-rare", "selective", `tags.contains(${quote(tags.rare)})`),
    limited(
      "collection-rare",
      "selective",
      `collections.contains(${quote(collectionPath(collections.common.name, collections.rare.name))})`,
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
      `collections.contains(${quote(collectionPath(collections.common.name))})`,
    ),
    limited(
      "collection-within-common",
      "other",
      `collections.within(${quote(collectionPath(collections.common.name))})`,
    ),
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
      `${common} || collections.contains(${quote(collectionPath(collections.common.name))})`,
    ),
    // One candidate statement returns `cap + 1` IDs, then the scan runs.
    limited("tag-dominant", "other", `tags.contains(${quote(tags.dominant)})`),
    limited(
      "collection-dominant",
      "other",
      `collections.contains(${quote(collectionPath(collections.dominant.name))})`,
    ),
    limited("scan-no-filter", "other"),
    limited("scan-title-contains", "other", 'title.contains("stress item 1")'),
    {
      id: "scan-sort-title",
      class: "other",
      args: {
        limit: "100",
        sort: JSON.stringify([{ field: "title", direction: "asc" }]),
      },
    },
    limited("scan-no-match", "other", 'title.contains("no such title")'),
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
        sort: JSON.stringify([{ field: "title", direction: "asc" }]),
      },
    },
  ];
}

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
    "",
    "Thresholds:",
    `  slices: 99th percentile at most ${THRESHOLDS.slice.p99Ms} ms, longest at most ${THRESHOLDS.slice.maxMs} ms`,
    `  cancel: settled within ${THRESHOLDS.cancelMs} ms of the request`,
    ...totals,
    "",
    "Output:",
    "  .scratch/item-query-measure/<time>/raw.json and summary.md",
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
  .scriptName("measure:item-query")
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
const scratch = join(workspaceRoot, ".scratch", "item-query-measure");
const fixture = getFixtureLayout(join(scratch, "fixture"));
const vaultPath = e2eVaultDir(workspaceRoot, "item-query-measure");
const pluginBundleDir = join(workspaceRoot, "apps", "obsidian", "dist-dev");
const runVaultScript = vaultScript(workspaceRoot, fixture.root);
const startedAt = Temporal.Now.instant();
const outDir = join(
  scratch,
  startedAt.toString().replaceAll(":", "-").slice(0, 19),
);

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

/** One measured run. A run with a hidden window is repeated. */
async function measure(args: Record<string, string>): Promise<MeasureReport> {
  for (let attempt = 0; ; attempt++) {
    const report = JSON.parse(
      await cliCommand(vaultId, MEASURE_COMMAND, {
        args,
        timeoutMs: CALL_TIMEOUT_MS,
      }),
    ) as MeasureReport;
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

/** A garbage collection in the window, through the DevTools protocol. */
async function collectGarbage(): Promise<void> {
  await obEval(
    vaultId,
    "(async()=>{const debug=require('@electron/remote').getCurrentWebContents().debugger;const attached=debug.isAttached();if(!attached)debug.attach('1.3');await debug.sendCommand('HeapProfiler.collectGarbage');if(!attached)debug.detach();return true;})()",
  );
}

/** Count the `MessageChannel` objects the window opens and closes. */
const CHANNEL_COUNTER = "__ztItemQueryMeasureChannels";
async function countChannels(): Promise<void> {
  await obEval(
    vaultId,
    `(()=>{if(window.${CHANNEL_COUNTER})return true;const Original=window.MessageChannel;const counter={created:0,closed:0,open:new Map(),Original};window.${CHANNEL_COUNTER}=counter;window.MessageChannel=class extends Original{constructor(){super();counter.created++;counter.open.set(this,new Error().stack);const close=this.port1.close.bind(this.port1);this.port1.close=()=>{if(counter.open.delete(this))counter.closed++;close();};}};return true;})()`,
  );
}
interface ChannelCount {
  created: number;
  closed: number;
  /** The creation stack of each channel that is still open. */
  open: string[];
}
async function readChannels(): Promise<ChannelCount> {
  return JSON.parse(
    await obEval(
      vaultId,
      `(()=>{const counter=window.${CHANNEL_COUNTER};window.MessageChannel=counter.Original;delete window.${CHANNEL_COUNTER};return JSON.stringify({created:counter.created,closed:counter.closed,open:[...counter.open.values()]});})()`,
    ),
  ) as ChannelCount;
}

async function pluginReady(): Promise<boolean> {
  return waitFor(async () => {
    const answer = await cliCommand(vaultId, MEASURE_COMMAND, {
      args: {
        limit: "1",
        fields: "[]",
      },
    }).catch(() => "");
    try {
      return (JSON.parse(answer) as MeasureReport).ok === true;
    } catch {
      return false;
    }
  }, 240);
}

/** Replace the Fixture database with the Stress Build of `items` Items. */
async function loadTier(items: number): Promise<void> {
  await cli([`vault=${vaultId}`, "plugin:disable", "id=zotlit"]);
  await buildFixture(fixture, {
    stressLibraryItemCount: items,
    pluginBundleDir,
    linkedAttachmentVaultDir: vaultPath,
  });
  await cli([`vault=${vaultId}`, "plugin:enable", "id=zotlit"]);
  if (!(await pluginReady())) {
    throw new Error(`ZotLit did not answer a query on the ${items}-Item tier`);
  }
}

interface RawTier {
  items: number;
  uniqueKey: string;
  queries: { spec: QuerySpec; warmUp: MeasureReport; runs: MeasureReport[] }[];
  heaps: { spec: QuerySpec; runs: MeasureReport[] }[];
  cancels: {
    delivery: CancelMeasurement["delivery"];
    query: string;
    /** When the terminal sent the cancel call. */
    sentAtEpochMs?: number;
    /** When the request reached the window. */
    arrivedAtEpochMs?: number;
    report: MeasureReport;
  }[];
  /** The cancel requests whose run gave no report. */
  unreported: { delivery: CancelMeasurement["delivery"]; query: string }[];
  channels: ChannelCount;
}

/** Measure one tier into `raw`, so a run that stops early keeps its part. */
async function measureTier(raw: RawTier): Promise<void> {
  const { items } = raw;
  log(`\n== ${items.toLocaleString("en-US")} Items ==`);
  await loadTier(items);
  await requireVisible();

  const located = JSON.parse(
    await cliCommand(vaultId, "zotlit:item-query", {
      args: {
        filter: `title == ${quote(uniqueTitle)}`,
        fields: "[]",
      },
    }),
  ) as { rows?: { indexedKey: string }[] };
  const uniqueKey = located.rows?.[0]?.indexedKey;
  if (!uniqueKey) throw new Error("the Stress Build has no unique-title Item");
  raw.uniqueKey = uniqueKey;
  const specs = querySpecs(uniqueKey);

  for (const spec of specs) {
    const warmUp = expectAnswered(spec.id, await measure(spec.args));
    const runs: MeasureReport[] = [];
    for (let run = 0; run < runCount; run++) {
      runs.push(expectAnswered(spec.id, await measure(spec.args)));
    }
    raw.queries.push({ spec, warmUp, runs });
    log(
      `${spec.id}: median ${median(runs.map((run) => run.totalMs)).toFixed(1)} ms, worst slices ${runs.map((run) => run.worstSlice?.ms ?? 0).join(", ")} ms`,
    );
  }

  // Peak heap: a limited query and `limit=all`, each from a collected heap.
  const byId = (id: string): QuerySpec => specs.find((spec) => spec.id === id)!;
  for (const spec of [byId("scan-no-filter"), byId("all"), byId("all-keys")]) {
    const runs: MeasureReport[] = [];
    for (let run = 0; run < 3; run++) {
      await collectGarbage();
      runs.push(
        expectAnswered(spec.id, await measure({ ...spec.args, heap: "true" })),
      );
    }
    raw.heaps.push({ spec, runs });
  }

  // Cancel: the longest query, cancelled at five points of its run by a timer.
  const exportSpec = byId("all");
  // The time a cancel can interrupt: the handler up to the end of the engine.
  const exportMs = median(
    raw.queries
      .find(({ spec }) => spec === exportSpec)!
      .runs.map((run) => (run.leaseMs ?? 0) + (run.engineMs ?? 0)),
  );
  for (const fraction of [0.1, 0.3, 0.5, 0.7, 0.9]) {
    raw.cancels.push({
      delivery: "timer",
      query: `${exportSpec.id} at ${fraction * 100}%`,
      report: await measure({
        ...exportSpec.args,
        cancelAfterMs: String(Math.round(exportMs * fraction)),
      }),
    });
  }

  // Cancel through a second CLI call, which arrives while the run is in progress.
  const cancelDelayMs = Math.min(exportMs * 0.3, 300);
  for (let run = 0; run < 3; run++) {
    const running = measure(exportSpec.args);
    await delay(cancelDelayMs);
    const sentAtEpochMs = Temporal.Now.instant().epochMilliseconds;
    const cancelled = JSON.parse(await cliCommand(vaultId, CANCEL_COMMAND)) as {
      cancelled: number;
      arrivedAtEpochMs: number;
    };
    raw.cancels.push({
      delivery: "cli",
      query: exportSpec.id,
      sentAtEpochMs,
      arrivedAtEpochMs: cancelled.arrivedAtEpochMs,
      report: await running,
    });
  }

  // The MessageChannel of the scheduler: a limited run, an unlimited run, and
  // a cancelled run leave no open channel.
  await countChannels();
  await measure(byId("scan-no-filter").args);
  await measure(exportSpec.args);
  await measure({
    ...exportSpec.args,
    cancelAfterMs: String(Math.round(exportMs * 0.5)),
  });
  raw.channels = await readChannels();

  // The cancel the product has for a CLI run: the plugin unloads.
  {
    const running = measure(exportSpec.args);
    await delay(cancelDelayMs);
    const sentAtEpochMs = Temporal.Now.instant().epochMilliseconds;
    const arrivedAtEpochMs = Number(
      await obEval(
        vaultId,
        "(async()=>{const at=performance.timeOrigin+performance.now();await app.plugins.disablePlugin('zotlit');return String(at);})()",
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
    if (!(await pluginReady())) {
      throw new Error("ZotLit did not load again after the unload cancel");
    }
  }
}

/** The measurements of one tier, with the notes on runs that gave none. */
function toTier(raw: RawTier, notes: string[]): TierMeasurement {
  const tier = raw.items.toLocaleString("en-US");
  const queries = raw.queries.map(({ spec, runs }): QueryMeasurement => {
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
        worstSliceReaders: [
          ...new Set(
            run.worstSlice?.statements.map(({ reader }) => reader) ?? [],
          ),
        ],
      })),
    };
  });

  const cancels: CancelMeasurement[] = [];
  const missedCancels: MissedCancel[] = raw.unreported.map((missed) => ({
    ...missed,
    outcome: "no report",
  }));
  for (const {
    delivery,
    query,
    sentAtEpochMs,
    arrivedAtEpochMs,
    report,
  } of raw.cancels) {
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
      worstSliceMs: report.worstSlice?.ms ?? 0,
    });
  }

  const heaps = raw.heaps.map(({ spec, runs }): HeapMeasurement => {
    const peak = (run: MeasureReport) =>
      run.heap!.peakBytes - run.heap!.beforeBytes;
    const worst = runs.toSorted((a, b) => peak(b) - peak(a))[0]!;
    return {
      query: spec.id,
      class: spec.class,
      returnedCount: worst.returnedCount ?? 0,
      peakBytes: peak(worst),
      afterAnswerBytes: worst.heap!.afterAnswerBytes - worst.heap!.beforeBytes,
    };
  });
  return { items: raw.items, queries, cancels, missedCancels, heaps };
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
    return evaluateTier(tier).filter(
      (check) => check.status === "failed" && scanning.has(check.subject),
    );
  });
  notes.push(
    `Keyset paging for the scan ${scanFailures.length === 0 ? "meets the budgets: every query that reads scan pages holds its slice limits and its total budget" : `misses the budgets in ${scanFailures.length} checks of queries that read scan pages (see the failed thresholds)`}. Longest slice with a scan page: ${each((raw) => `${longest(raw, "scan-page").toFixed(1)} ms`)}.`,
  );
  notes.push(
    `Candidate statements: the largest one returned ${each((raw) => `${Math.max(0, ...allRuns(raw).map((run) => run.statements["candidate-set"]?.maxRows ?? 0)).toLocaleString("en-US")} IDs, longest slice with a candidate statement ${longest(raw, "candidate-set").toFixed(1)} ms`)}. The limit of one slice is ${THRESHOLDS.slice.maxMs} ms.`,
  );
  notes.push(
    `The answer of the CLI handler (the JSON envelope) is one synchronous step after the engine settles and is not a slice of the engine. Its longest time: ${each((raw) => `${Math.max(0, ...raw.queries.filter(({ spec }) => spec.class !== "all").flatMap(({ runs }) => runs.map((run) => run.answerMs ?? 0))).toFixed(1)} ms for \`limit 100\`, ${Math.max(0, ...raw.queries.filter(({ spec }) => spec.class === "all").flatMap(({ runs }) => runs.map((run) => run.answerMs ?? 0))).toFixed(1)} ms for \`limit=all\``)}.`,
  );
  notes.push(
    "Cancel, timer: a timer in the window aborts the run; the time is from the moment the timer was due to the rejection of the handler. Cancel, cli: a second Obsidian CLI call (`zotlit:item-query-measure-cancel`, dev build) aborts the run; the time is from the arrival of that call in the window to the rejection, and the transport from the terminal to the window is given apart. Cancel, unload: the plugin unloads, which is the only cancel `zotlit:item-query` has in the product, because Obsidian gives a CLI handler no `AbortSignal`; the time is from the start of the unload to the rejection.",
  );
  const megabytes = (bytes: number): string => (bytes / 1024 / 1024).toFixed(1);
  notes.push(
    `Peak heap of the limited scan above its start: ${each((raw) => `${megabytes(Math.max(0, ...raw.heaps.filter(({ spec }) => spec.class !== "all").flatMap(({ runs }) => runs.map((run) => run.heap!.peakBytes - run.heap!.beforeBytes))))} MB`)}. The engine keeps \`limit + 1\` rows, one page, and one hydrate chunk, which the retention test proves in CI. The heap in the window is above that bound: it counts the rows that V8 has not collected yet, and V8 with its optimizing compilers can keep a finished page or chunk for a short time.`,
  );
  notes.push(
    `MessageChannel of the scheduler, over one limited, one unlimited, and one cancelled run: ${each((raw) => `${raw.channels.created} opened, ${raw.channels.closed} closed, ${raw.channels.open.length} left open`)}.`,
  );
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
  environmentLines = await environment();
  for (const items of tiers) {
    const raw: RawTier = {
      items,
      uniqueKey: "",
      queries: [],
      heaps: [],
      cancels: [],
      unreported: [],
      channels: { created: 0, closed: 0, open: [] },
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
const notes: string[] = [];
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
