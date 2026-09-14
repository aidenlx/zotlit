// Aggregates run gradings into benchmark.json and benchmark.md.
//
// Reads the workspace layout the case store records:
//
//   <benchmarkDir>/
//   └── eval-N/
//       ├── with_skill/
//       │   └── run-1/grading.json
//       └── without_skill/
//           └── run-1/grading.json
//
// A `runs/` subdirectory wrapping the eval-N directories is also accepted.

import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

export interface Stats {
  mean: number;
  stddev: number;
  min: number;
  max: number;
}

export interface Expectation {
  text: string;
  passed: boolean;
  evidence: string;
}

export interface RunResult {
  pass_rate: number;
  passed: number;
  failed: number;
  total: number;
  time_seconds: number;
  tokens: number;
  tool_calls: number;
  errors: number;
}

export interface Run {
  eval_id: EvalId;
  configuration: string;
  run_number: number;
  result: RunResult;
  expectations: Expectation[];
  notes: string[];
}

/**
 * An eval's identity.
 *
 * An eval-set entry may carry a numeric `id` or a slug, and a grading directory
 * may be named `eval-<n>` rather than after its eval, so the same eval can
 * appear under either form. Identity resolves to the eval-set id when the case
 * declares one.
 */
export type EvalId = number | string;

export interface Benchmark {
  metadata: {
    skill_name: string;
    skill_path: string;
    executor_model: string;
    analyzer_model: string;
    timestamp: string;
    evals_run: EvalId[];
    runs_per_configuration: number;
  };
  runs: Run[];
  run_summary: Record<string, unknown>;
  notes: string[];
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** Mean, population standard deviation, minimum, and maximum. */
export function calculateStats(values: number[]): Stats {
  if (values.length === 0) return { mean: 0, stddev: 0, min: 0, max: 0 };

  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;

  return {
    mean: round(mean, 4),
    stddev: round(Math.sqrt(variance), 4),
    min: round(Math.min(...values), 4),
    max: round(Math.max(...values), 4),
  };
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

async function isDirectory(path: string): Promise<boolean> {
  return stat(path).then(
    (info) => info.isDirectory(),
    () => false,
  );
}

/**
 * Locate the eval directories under a benchmark directory.
 *
 * `eval-N` is the graded layout: each holds `run-N` directories beside its
 * `eval_metadata.json`, and the case's `evals.json` names it. A directory named
 * after an eval (`json-e-spread`) restates one of those trials — the committed
 * benchmark counts each trial once — so the `eval-N` directory wins and the
 * named duplicate is skipped.
 */
async function findEvalDirs(benchmarkDir: string): Promise<string[]> {
  const searchDir = (await isDirectory(join(benchmarkDir, "runs")))
    ? join(benchmarkDir, "runs")
    : benchmarkDir;

  const candidates: string[] = [];
  for (const entry of await readdir(searchDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (await hasConfigurationDir(join(searchDir, entry.name))) {
      candidates.push(entry.name);
    }
  }

  const graded = candidates.filter((name) => /^eval-\d+$/.test(name));
  const named = candidates.filter((name) => !/^eval-\d+$/.test(name));
  const chosen = graded.length > 0 ? graded : named;

  const skipped = candidates.filter((name) => !chosen.includes(name));
  if (skipped.length > 0) {
    console.warn(
      `Warning: graded the ${graded.join(", ")} directories and skipped ${skipped.join(", ")}, which restate those trials.`,
    );
  }

  return chosen.toSorted().map((name) => join(searchDir, name));
}

/**
 * True when a configuration directory holds a reachable grading.
 *
 * A grading sits either in the configuration directory or in a `run-N` child.
 * Requiring one keeps evidence directories — which share the configuration
 * names but hold transcripts — out of the candidate set.
 */
async function hasConfigurationDir(dir: string): Promise<boolean> {
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(
    () => [],
  )) {
    if (!entry.isDirectory() || !isConfigurationName(entry.name)) continue;
    const configDir = join(dir, entry.name);
    if (await exists(join(configDir, "grading.json"))) return true;
    if (await hasGradingBelow(configDir)) return true;
  }
  return false;
}

/** True when any direct child directory holds a grading. */
async function hasGradingBelow(dir: string): Promise<boolean> {
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(
    () => [],
  )) {
    if (!entry.isDirectory()) continue;
    if (await exists(join(dir, entry.name, "grading.json"))) return true;
  }
  return false;
}

const KNOWN_CONFIGURATIONS = [
  "with_skill",
  "without_skill",
  "new_skill",
  "old_skill",
];

function isConfigurationName(name: string): boolean {
  return (
    KNOWN_CONFIGURATIONS.includes(name) ||
    (name.includes("skill") && !name.startsWith("."))
  );
}

interface EvalMetadata {
  eval_id?: EvalId;
  eval_name?: string;
}

/**
 * The declared identity for each eval in a case, keyed by the slug and the
 * numeric directory name that may stand for it.
 */
async function readEvalIdentities(
  benchmarkDir: string,
): Promise<Map<string, EvalId>> {
  const identities = new Map<string, EvalId>();
  const evalSet = await readJson<{ evals?: { id?: EvalId }[] }>(
    join(benchmarkDir, "evals.json"),
  );

  for (const [index, item] of (evalSet?.evals ?? []).entries()) {
    const id = item.id ?? index;
    identities.set(String(id), id);
    identities.set(`eval-${index}`, id);
  }

  return identities;
}

/**
 * Resolve a grading directory's eval identity.
 *
 * Precedence: the eval-set declaration matched on the directory name, then the
 * directory's own `eval_name` matched against the eval set, then its `eval_id`,
 * then the directory name. An `eval-<n>` directory carries no identity of its
 * own, so it needs `evals.json` or `eval_metadata.json` to name the eval it
 * grades; a directory named after its eval is already the identity.
 */
async function evalIdFor(
  evalDir: string,
  identities: Map<string, EvalId>,
): Promise<EvalId> {
  const name = basename(evalDir);
  const declared = identities.get(name);

  const metadata = await readJson<EvalMetadata>(
    join(evalDir, "eval_metadata.json"),
  );
  const evalName = metadata?.eval_name
    ? (identities.get(metadata.eval_name) ?? metadata.eval_name)
    : undefined;

  return declared ?? evalName ?? metadata?.eval_id ?? name;
}

/** Load every run grading under `benchmarkDir`, grouped by configuration name. */
export async function loadRunResults(
  benchmarkDir: string,
): Promise<Record<string, Run[]>> {
  const results: Record<string, Run[]> = {};
  const identities = await readEvalIdentities(benchmarkDir);
  const evalDirs = await findEvalDirs(benchmarkDir);

  for (const evalDir of evalDirs) {
    const evalId = await evalIdFor(evalDir, identities);

    // Read directory order so configuration precedence matches the recorded
    // case layout (`with_skill` before `without_skill`), which sets the delta sign.
    for (const configEntry of await readdir(evalDir, { withFileTypes: true })) {
      if (!configEntry.isDirectory()) continue;
      if (!isConfigurationName(configEntry.name)) continue;
      const configuration = configEntry.name;
      const configDir = join(evalDir, configuration);

      for (const [runNumber, runDir] of (
        await findRunDirs(configDir)
      ).entries()) {
        const grading = await readJson<Record<string, unknown>>(
          join(runDir, "grading.json"),
        );
        if (!grading) {
          console.warn(`Warning: no readable grading.json in ${runDir}`);
          continue;
        }

        const summary = (grading.summary ?? {}) as Partial<RunResult>;
        const timing = (grading.timing ?? {}) as {
          total_duration_seconds?: number;
        };
        const metrics = (grading.execution_metrics ?? {}) as {
          total_tool_calls?: number;
          output_chars?: number;
          errors_encountered?: number;
        };

        const result: RunResult = {
          pass_rate: summary.pass_rate ?? 0,
          passed: summary.passed ?? 0,
          failed: summary.failed ?? 0,
          total: summary.total ?? 0,
          time_seconds: timing.total_duration_seconds ?? 0,
          tokens: 0,
          tool_calls: metrics.total_tool_calls ?? 0,
          errors: metrics.errors_encountered ?? 0,
        };

        // A configuration may record its run in place, or split it across
        // `run-N` directories. An in-place run has no timing sidecar.
        if (runDir !== configDir && result.time_seconds === 0) {
          const sibling = await readJson<{
            total_duration_seconds?: number;
            total_tokens?: number;
          }>(join(runDir, "timing.json"));
          result.time_seconds = sibling?.total_duration_seconds ?? 0;
          result.tokens = sibling?.total_tokens ?? 0;
        }
        if (!result.tokens) result.tokens = metrics.output_chars ?? 0;

        const notes = (grading.user_notes_summary ?? {}) as Record<
          string,
          string[]
        >;

        (results[configuration] ??= []).push({
          eval_id: evalId,
          configuration,
          run_number: runNumber,
          result,
          expectations: (grading.expectations ?? []) as Expectation[],
          notes: [
            ...(notes.uncertainties ?? []),
            ...(notes.needs_review ?? []),
            ...(notes.workarounds ?? []),
          ],
        });
      }
    }
  }

  return results;
}

/**
 * The run directories inside a configuration directory, each paired with its
 * recorded run number.
 *
 * A configuration either splits runs into `run-N` directories or holds its
 * grading directly, in which case it is run 1.
 */
async function findRunDirs(configDir: string): Promise<Map<number, string>> {
  const runs = new Map<number, string>();
  const entries = await readdir(configDir, { withFileTypes: true });

  for (const entry of entries.toSorted((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true }),
  )) {
    if (!entry.isDirectory() || !entry.name.startsWith("run-")) continue;
    const parsed = Number(entry.name.slice("run-".length));
    runs.set(
      Number.isInteger(parsed) ? parsed : runs.size + 1,
      join(configDir, entry.name),
    );
  }

  if (runs.size === 0 && (await exists(join(configDir, "grading.json")))) {
    runs.set(1, configDir);
  }

  return runs;
}

/** Per-configuration statistics plus the delta between the first two configurations. */
export function aggregateResults(
  results: Record<string, Run[]>,
): Record<string, unknown> {
  const summary: Record<string, unknown> = {};

  for (const [configuration, runs] of Object.entries(results)) {
    if (runs.length === 0) {
      summary[configuration] = {
        pass_rate: calculateStats([]),
        time_seconds: calculateStats([]),
        tokens: calculateStats([]),
      };
      continue;
    }
    summary[configuration] = {
      pass_rate: calculateStats(runs.map((run) => run.result.pass_rate)),
      time_seconds: calculateStats(runs.map((run) => run.result.time_seconds)),
      tokens: calculateStats(runs.map((run) => run.result.tokens)),
    };
  }

  const configs = Object.keys(results);
  const meanOf = (config: string | undefined, metric: string): number => {
    const entry = config
      ? (summary[config] as Record<string, Stats>)
      : undefined;
    return entry?.[metric]?.mean ?? 0;
  };

  summary.delta = {
    pass_rate: `${meanOf(configs[0], "pass_rate") - meanOf(configs[1], "pass_rate") >= 0 ? "+" : ""}${(meanOf(configs[0], "pass_rate") - meanOf(configs[1], "pass_rate")).toFixed(2)}`,
    time_seconds: `${meanOf(configs[0], "time_seconds") - meanOf(configs[1], "time_seconds") >= 0 ? "+" : ""}${(meanOf(configs[0], "time_seconds") - meanOf(configs[1], "time_seconds")).toFixed(1)}`,
    tokens: `${meanOf(configs[0], "tokens") - meanOf(configs[1], "tokens") >= 0 ? "+" : ""}${(meanOf(configs[0], "tokens") - meanOf(configs[1], "tokens")).toFixed(0)}`,
  };

  return summary;
}

export interface BenchmarkOptions {
  skillName?: string;
  skillPath?: string;
}

/** Build a complete benchmark object from the gradings under `benchmarkDir`. */
export async function generateBenchmark(
  benchmarkDir: string,
  options: BenchmarkOptions = {},
): Promise<Benchmark> {
  const results = await loadRunResults(benchmarkDir);
  const runs = Object.values(results).flat();

  return {
    metadata: {
      skill_name: options.skillName || "<skill-name>",
      skill_path: options.skillPath || "<path/to/skill>",
      executor_model: "<model-name>",
      analyzer_model: "<model-name>",
      timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      evals_run: [...new Set(runs.map((run) => run.eval_id))].toSorted((a, b) =>
        String(a).localeCompare(String(b), undefined, { numeric: true }),
      ),
      runs_per_configuration: 3,
    },
    runs,
    run_summary: aggregateResults(results),
    notes: [],
  };
}

/** Render the human-readable benchmark.md body. */
export function generateMarkdown(benchmark: Benchmark): string {
  const summary = benchmark.run_summary as Record<
    string,
    Record<string, Stats>
  >;
  const [configA = "config_a", configB = "config_b"] = Object.keys(
    summary,
  ).filter((key) => key !== "delta");
  const delta = (summary.delta ?? {}) as unknown as Record<string, string>;

  const line = (
    label: string,
    metric: string,
    format: { scale: number; places: number; suffix: string },
  ): string => {
    const { scale, places, suffix } = format;
    const a = summary[configA]?.[metric];
    const b = summary[configB]?.[metric];
    const aText =
      a === undefined
        ? "—"
        : `${(a.mean * scale).toFixed(places)}${suffix} ± ${(a.stddev * scale).toFixed(places)}${suffix}`;
    const bText =
      b === undefined
        ? "—"
        : `${(b.mean * scale).toFixed(places)}${suffix} ± ${(b.stddev * scale).toFixed(places)}${suffix}`;
    return `| ${label} | ${aText} | ${bText} | ${delta[metric] ?? "—"} |`;
  };

  const title = (name: string): string =>
    name.replaceAll("_", " ").replaceAll(/\b\w/g, (c) => c.toUpperCase());

  const lines = [
    `# Skill Benchmark: ${benchmark.metadata.skill_name}`,
    "",
    `**Model**: ${benchmark.metadata.executor_model}`,
    `**Date**: ${benchmark.metadata.timestamp}`,
    `**Evals**: ${benchmark.metadata.evals_run.join(", ")} (${benchmark.metadata.runs_per_configuration} runs each per configuration)`,
    "",
    "## Summary",
    "",
    `| Metric | ${title(configA)} | ${title(configB)} | Delta |`,
    "|--------|------------|---------------|-------|",
    line("Pass Rate", "pass_rate", { scale: 100, places: 0, suffix: "%" }),
    line("Time", "time_seconds", { scale: 1, places: 1, suffix: "s" }),
    line("Tokens", "tokens", { scale: 1, places: 0, suffix: "" }),
  ];

  if (benchmark.notes.length > 0) {
    lines.push("", "## Notes", "");
    for (const note of benchmark.notes) lines.push(`- ${note}`);
  }

  return lines.join("\n");
}

/** Write `benchmark.json` and `benchmark.md` for `benchmarkDir`. */
export async function writeBenchmark(
  benchmarkDir: string,
  options: BenchmarkOptions & { output?: string } = {},
): Promise<Benchmark> {
  const benchmark = await generateBenchmark(benchmarkDir, options);
  const jsonPath = options.output ?? join(benchmarkDir, "benchmark.json");

  await writeFile(jsonPath, `${JSON.stringify(benchmark, null, 2)}\n`);
  await writeFile(
    jsonPath.replace(/\.json$/, ".md"),
    generateMarkdown(benchmark),
  );

  return benchmark;
}
