import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, test } from "vitest";

import { calculateStats, loadRunResults } from "#benchmark";

describe("calculateStats", () => {
  test("returns zeroes for an empty sample", () => {
    expect(calculateStats([])).toEqual({ mean: 0, stddev: 0, min: 0, max: 0 });
  });

  test("computes the population deviation", () => {
    expect(calculateStats([1, 1, 1])).toEqual({
      mean: 1,
      stddev: 0,
      min: 1,
      max: 1,
    });
  });

  test("spreads across a mixed sample", () => {
    const stats = calculateStats([0, 0.5, 1]);
    expect(stats.mean).toBeCloseTo(0.5);
    expect(stats.min).toBe(0);
    expect(stats.max).toBe(1);
    expect(stats.stddev).toBeCloseTo(0.4082, 3);
  });
});

interface GradingFixture {
  benchmarkDir: string;
  evalName: string;
  configuration: string;
  runNumber: number;
  passRate: number;
  /** Write `grading.json` directly in the configuration directory. */
  flat?: boolean;
}

async function writeGrading(fixture: GradingFixture): Promise<void> {
  const { benchmarkDir, evalName, configuration, runNumber, passRate, flat } =
    fixture;
  const configDir = join(benchmarkDir, evalName, configuration);
  const runDir = flat ? configDir : join(configDir, `run-${runNumber}`);
  await mkdir(runDir, { recursive: true });
  await writeFile(
    join(runDir, "grading.json"),
    JSON.stringify({
      summary: { pass_rate: passRate, passed: 3, failed: 0, total: 3 },
      expectations: [{ text: "a", passed: true, evidence: "b" }],
    }),
  );
}

describe("loadRunResults", () => {
  let benchmarkDir: string;

  beforeEach(async () => {
    benchmarkDir = await mkdtemp(join(tmpdir(), "eval-benchmark-"));
  });

  test("groups runs by configuration in directory order", async () => {
    await writeGrading({
      benchmarkDir,
      evalName: "eval-0",
      configuration: "with_skill",
      runNumber: 1,
      passRate: 1,
    });
    await writeGrading({
      benchmarkDir,
      evalName: "eval-0",
      configuration: "without_skill",
      runNumber: 1,
      passRate: 0.5,
    });

    const results = await loadRunResults(benchmarkDir);

    expect(Object.keys(results)).toEqual(["with_skill", "without_skill"]);
    expect(results.with_skill).toHaveLength(1);
    expect(results.without_skill?.[0]?.result.pass_rate).toBe(0.5);
  });

  test("resolves a numeric eval_id through the eval set", async () => {
    // `eval-0` grades the eval that `evals.json` names `json-e-spread`.
    await writeGrading({
      benchmarkDir,
      evalName: "eval-0",
      configuration: "with_skill",
      runNumber: 1,
      passRate: 1,
    });
    await writeFile(
      join(benchmarkDir, "evals.json"),
      JSON.stringify({ evals: [{ id: "json-e-spread" }] }),
    );
    await writeFile(
      join(benchmarkDir, "eval-0", "eval_metadata.json"),
      JSON.stringify({ eval_id: 0, eval_name: "json-e-spread" }),
    );

    const results = await loadRunResults(benchmarkDir);
    expect(results.with_skill?.[0]?.eval_id).toBe("json-e-spread");
  });

  test("prefers the graded eval-N directories over eval-named duplicates", async () => {
    await writeGrading({
      benchmarkDir,
      evalName: "eval-0",
      configuration: "with_skill",
      runNumber: 1,
      passRate: 1,
    });
    await writeGrading({
      benchmarkDir,
      evalName: "json-e-spread",
      configuration: "with_skill",
      runNumber: 1,
      passRate: 1,
      flat: true,
    });

    const results = await loadRunResults(benchmarkDir);
    expect(results.with_skill).toHaveLength(1);
  });

  test("registers a configuration that holds its grading without run-N", async () => {
    await writeGrading({
      benchmarkDir,
      evalName: "json-e-spread",
      configuration: "with_skill",
      runNumber: 1,
      passRate: 0.75,
      flat: true,
    });

    const results = await loadRunResults(benchmarkDir);
    expect(results.with_skill?.[0]?.result.pass_rate).toBe(0.75);
    expect(results.with_skill?.[0]?.run_number).toBe(1);
  });

  test("numbers each run-N directory", async () => {
    for (const runNumber of [1, 2]) {
      await writeGrading({
        benchmarkDir,
        evalName: "eval-0",
        configuration: "with_skill",
        runNumber,
        passRate: 1,
      });
    }

    const results = await loadRunResults(benchmarkDir);
    expect(results.with_skill?.map((run) => run.run_number)).toEqual([1, 2]);
  });

  test("loads a case that has only eval-named directories", async () => {
    await writeGrading({
      benchmarkDir,
      evalName: "json-e-spread",
      configuration: "with_skill",
      runNumber: 1,
      passRate: 1,
      flat: true,
    });

    const results = await loadRunResults(benchmarkDir);
    expect(results.with_skill?.[0]?.eval_id).toBe("json-e-spread");
  });

  test("ignores an evidence directory that shares configuration names", async () => {
    await writeGrading({
      benchmarkDir,
      evalName: "eval-0",
      configuration: "with_skill",
      runNumber: 1,
      passRate: 1,
    });
    // Evidence directories carry the configuration names but hold transcripts.
    await mkdir(join(benchmarkDir, "evidence", "without_skill"), {
      recursive: true,
    });

    const results = await loadRunResults(benchmarkDir);
    expect(results.with_skill).toHaveLength(1);
    expect(results.without_skill).toBeUndefined();
  });

  test("skips a run directory with no grading", async () => {
    await mkdir(join(benchmarkDir, "eval-0", "with_skill", "run-1"), {
      recursive: true,
    });

    expect(await loadRunResults(benchmarkDir)).toEqual({});
  });

  test("returns nothing when no eval directories exist", async () => {
    expect(await loadRunResults(benchmarkDir)).toEqual({});
  });
});
