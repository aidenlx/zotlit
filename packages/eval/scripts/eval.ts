#!/usr/bin/env node

// Agent evaluation platform: aggregates case gradings and probes skill triggers.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import yargs from "yargs";
import type { Argv } from "yargs";
import { hideBin } from "yargs/helpers";

import { loadRunResults, writeBenchmark } from "#benchmark";
import {
  getCasesRoot,
  getWorkspaceRootFromHere,
  listCases,
  readEvalSet,
  resolveCase,
} from "#case-store";
import { runTriggerEval } from "#pi-run";
import { readSkillMd } from "#skill";

const casesRoot = getCasesRoot();
const caseIds = await listCases();
const workspaceRoot = await getWorkspaceRootFromHere();

function caseBuilder(y: Argv) {
  return y.positional("case", {
    describe: `Case id or path (committed: ${caseIds.join(", ")})`,
    type: "string",
  });
}

const cli = yargs(hideBin(process.argv))
  .scriptName("eval")
  .usage("$0 <command> [options]")
  .command(
    "list",
    "list the committed cases",
    () => {},
    async () => {
      for (const id of caseIds) console.log(id);
      if (caseIds.length === 0) console.log(`No cases under ${casesRoot}`);
    },
  )
  .command(
    "benchmark <case>",
    "aggregate a case's gradings into benchmark.json and benchmark.md",
    (y) =>
      caseBuilder(y)
        .option("skill-name", {
          describe: "Name recorded in the benchmark metadata",
          type: "string",
        })
        .option("skill-path", {
          describe: "Skill path recorded in the benchmark metadata",
          type: "string",
        })
        .option("output", {
          describe: "Output path for benchmark.json",
          type: "string",
        }),
    async (argv) => {
      const casePath = await resolveCase(argv.case!);
      const benchmark = await writeBenchmark(casePath, {
        skillName: argv["skill-name"],
        skillPath: argv["skill-path"],
        output: argv.output,
      });
      const summary = benchmark.run_summary as Record<
        string,
        { pass_rate?: { mean: number } }
      >;

      console.log(`Case      ${casePath}`);
      for (const [configuration, entry] of Object.entries(summary)) {
        if (configuration === "delta" || !entry.pass_rate) continue;
        const label = configuration.replaceAll("_", " ");
        console.log(
          `  ${label.padEnd(16)}${(entry.pass_rate.mean * 100).toFixed(1)}% pass rate`,
        );
      }
      console.log(`Runs      ${benchmark.runs.length}`);
    },
  )
  .command(
    "inspect <case>",
    "list a case's eval set and graded runs",
    (y) => caseBuilder(y),
    async (argv) => {
      const casePath = await resolveCase(argv.case!);
      const evalSet = await readEvalSet(join(casePath, "evals.json"));

      console.log(`Case        ${casePath}`);
      console.log(`Skill       ${evalSet.skill_name ?? "(unset)"}`);
      console.log(`Contract    ${evalSet.cli_contract ?? "(unset)"}`);
      console.log(
        `Model       ${evalSet.model ?? "(unset)"} ${evalSet.reasoning ?? ""}`.trimEnd(),
      );
      console.log(`Evals       ${evalSet.evals.length}`);
      for (const item of evalSet.evals) {
        console.log(`  ${item.id}: ${item.assertions.length} assertions`);
      }

      // Report the runs the benchmark grades, not every grading.json on disk:
      // an eval-named directory restates a trial already graded under eval-<n>.
      const results = await loadRunResults(casePath);
      const runs = Object.values(results).flat();
      console.log(`Graded runs ${runs.length}`);
      for (const [configuration, configRuns] of Object.entries(results)) {
        console.log(`  ${configuration}: ${configRuns.length}`);
      }
    },
  )
  .command(
    "trigger <skill-path>",
    "probe whether a skill's description makes pi load it",
    (y) =>
      y
        .positional("skill-path", {
          describe: "Path to the skill directory containing SKILL.md",
          type: "string",
        })
        .option("evals", {
          describe: "Eval set with query/should_trigger pairs",
          type: "string",
          demandOption: true,
        })
        .option("description", {
          describe: "Description to test instead of the SKILL.md value",
          type: "string",
        })
        .option("runs-per-query", {
          describe: "Probes per query",
          type: "number",
          default: 3,
        })
        .option("trigger-threshold", {
          describe: "Trigger rate a should_trigger query must reach",
          type: "number",
          default: 0.5,
        })
        .option("timeout", {
          describe: "Abort a probe after this many seconds",
          type: "number",
          default: 120,
        })
        .option("model", {
          describe: "Model pattern passed to pi",
          type: "string",
        })
        .option("concurrency", {
          describe: "Parallel probes",
          type: "number",
        })
        .option("output", {
          describe: "Write the JSON result to this path",
          type: "string",
        })
        .option("verbose", {
          describe: "Report each probe as it completes",
          type: "boolean",
          default: false,
        }),
    async (argv) => {
      const skillPath = argv["skill-path"]!;
      const skill = await readSkillMd(skillPath);
      const evalSet = await readEvalSet(argv.evals);
      const description = argv.description ?? skill.description;

      if (argv.verbose) console.error(`Evaluating: ${description}`);

      const results = await runTriggerEval({
        evalSet: evalSet.evals.map((item) => ({
          query: item.prompt,
          should_trigger: true,
        })),
        skillPath,
        cwd: workspaceRoot,
        timeoutMs: argv.timeout * 1000,
        runsPerQuery: argv["runs-per-query"],
        triggerThreshold: argv["trigger-threshold"],
        model: argv.model,
        concurrency: argv.concurrency,
        verbose: argv.verbose,
      });

      const payload = {
        skill_name: skill.name,
        description,
        results,
        summary: {
          total: results.length,
          passed: results.filter((result) => result.pass).length,
          failed: results.filter((result) => !result.pass).length,
        },
      };

      if (argv.output) {
        await mkdir(dirname(argv.output), { recursive: true });
        await writeFile(argv.output, `${JSON.stringify(payload, null, 2)}\n`);
        console.log(`Wrote ${argv.output}`);
      }
      console.log(JSON.stringify(payload, null, 2));

      const summary = payload.summary;
      console.error(`Results: ${summary.passed}/${summary.total} passed`);
    },
  )
  .demandCommand(1)
  .strict()
  .version(false)
  .fail((message, error) => {
    console.error(
      `eval: ${error instanceof Error ? error.message : (message ?? String(error))}`,
    );
    process.exitCode = 1;
    throw error instanceof Error ? error : new Error(String(message));
  });

try {
  await cli.parseAsync();
} catch {
  // The fail handler reports the error and sets the exit code; this only stops
  // the throw from surfacing as an uncaught error.
}
