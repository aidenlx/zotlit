#!/usr/bin/env node
// Regrade saved evaluation runs with the current checkers and compare verdicts.
import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { measureEvents } from "./events.mjs";
import { gradeRun } from "./run.mjs";

/**
 * Regrades one saved run folder through the same `gradeRun` path as a live run.
 * @returns `graded: false` when the run stopped before it saved an answer.
 */
export async function regrade(root) {
  const report = JSON.parse(await readFile(join(root, "report.json"), "utf8"));
  const saved = JSON.parse(await readFile(join(root, "check.json"), "utf8"));
  const verdict = { case: report.case, root, savedPass: saved.pass };
  try {
    await access(join(root, "answer.json"));
    await access(join(root, "result.json"));
  } catch {
    return { ...verdict, graded: false };
  }
  const cliCalls = (await readFile(join(root, "cli-calls.jsonl"), "utf8"))
    .split("\n")
    .filter(Boolean)
    .map(JSON.parse);
  const metrics = measureEvents(
    await readFile(join(root, "agent-events.jsonl"), "utf8"),
    report.agent,
    cliCalls,
  );
  const { errors } = await gradeRun(report.case, root, {
    runRoot: join(root, "corpus"),
    vaultPath: join(root, `vault-${report.runId}`),
    metrics,
    cliCalls,
  });
  const pass = errors.length === 0;
  return {
    ...verdict,
    graded: true,
    pass,
    same: pass === saved.pass,
    errors,
  };
}

async function main() {
  const roots = process.argv.slice(2);
  if (!roots.length) throw new Error("usage: node regrade.mjs <run-folder>...");
  const verdicts = [];
  for (const root of roots)
    verdicts.push(
      await regrade(resolve(root)).catch((error) => ({
        root,
        graded: false,
        error: error.message,
      })),
    );
  console.log(JSON.stringify(verdicts, null, 2));
  if (verdicts.some((verdict) => verdict.graded && !verdict.same))
    process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 2;
  });
}
