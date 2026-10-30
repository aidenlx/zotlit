#!/usr/bin/env node
// One bounded persona evaluation. Run data is private; compact evidence remains.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { obsidianCliSocketPath } from "@zotlit/scripts/obsidian-cli";

import { caseFamily, validate } from "./check.mjs";
import { startCliWrapper } from "./cli-wrapper.mjs";
import { measureEvents, parseEvents } from "./events.mjs";
export { measureEvents } from "./events.mjs";

const repo = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const cases = JSON.parse(
  await readFile(new URL("./cases.json", import.meta.url), "utf8"),
);
const fixtureTool = join(repo, "packages/scripts/scripts/obsidian-vault.ts");
const cliTool = join(repo, "packages/scripts/scripts/obsidian-cli.ts");
const prepareTool = fileURLToPath(new URL("./prepare.mjs", import.meta.url));
const skillFile = join(repo, "skills/zotlit-query/SKILL.md");
const catalogFile = join(repo, "packages/item-query/dist/query.schema.json");

function fail(message) {
  throw new Error(message);
}
function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
export function parseOptions(argv) {
  const usage =
    "usage: node run.mjs <case|all> [--agent codex|claude] --model <model> --effort <low|medium|high|xhigh> [--timeout-minutes 10]";
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      agent: { type: "string", default: "codex" },
      model: { type: "string" },
      effort: { type: "string" },
      "timeout-minutes": { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help) return null;
  const [caseName] = positionals;
  if (
    positionals.length !== 1 ||
    (!cases[caseName] && caseName !== "all") ||
    !values.model ||
    !values.effort
  )
    fail(usage);
  if (!["low", "medium", "high", "xhigh"].includes(values.effort))
    fail("invalid effort");
  if (!["codex", "claude"].includes(values.agent)) fail("invalid agent");
  const minutes = Number(values["timeout-minutes"] ?? 10);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 30)
    fail("timeout must be 1–30 minutes");
  return {
    caseName,
    agent: values.agent,
    model: values.model,
    effort: values.effort,
    agentTimeoutMs: minutes * 60_000,
  };
}

/** A bounded process, with stdout/stderr captured for evidence and test injection. */
export function runProcess(
  command,
  args,
  { cwd, input = "", timeoutMs = 180_000, signal, spawnImpl = spawn } = {},
) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      resolve({
        code: null,
        stdout: "",
        stderr: "",
        timedOut: false,
        aborted: true,
      });
      return;
    }
    const child = spawnImpl(command, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    const stdout = [],
      stderr = [];
    let timedOut = false,
      aborted = false,
      settled = false;
    let escalation, forceFinish;
    const kill = (name) => {
      try {
        if (process.platform !== "win32" && child.pid)
          process.kill(-child.pid, name);
        else child.kill(name);
      } catch {
        /* the process group already exited */
      }
    };
    const settle = (code, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(escalation);
      clearTimeout(forceFinish);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else {
        const bytes = Buffer.concat(stdout);
        resolve({
          code,
          stdout: bytes.toString(),
          stdoutBytes: bytes.length,
          stderr: Buffer.concat(stderr).toString(),
          timedOut,
          aborted,
        });
      }
    };
    const stop = (reason) => {
      if (settled || timedOut || aborted) return;
      if (reason === "timeout") timedOut = true;
      else aborted = true;
      kill("SIGTERM");
      escalation = setTimeout(() => kill("SIGKILL"), 5_000);
      forceFinish = setTimeout(() => {
        child.stdin.destroy();
        child.stdout.destroy();
        child.stderr.destroy();
        settle(null);
      }, 8_000);
    };
    const onAbort = () => stop("abort");
    const timer = setTimeout(() => stop("timeout"), timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk) => {
      stdout.push(Buffer.from(chunk));
    });
    child.stderr.on("data", (chunk) => {
      stderr.push(Buffer.from(chunk));
    });
    child.on("error", (error) => settle(null, error));
    child.on("close", (code) => settle(code));
    child.stdin.on("error", () => {
      /* an early process exit is reported by close/error */
    });
    child.stdin.end(input);
  });
}

function required(result, stage) {
  if (result.timedOut) fail(`${stage} timed out`);
  if (result.aborted) fail(`${stage} interrupted`);
  if (result.code !== 0)
    fail(`${stage} failed (${result.code}): ${result.stderr.slice(-2000)}`);
  return result.stdout;
}

/** Pure final-answer check for the runner and saved-response regrades. */
export function checkAnswer(caseName, answer, context) {
  const { spec, family } = caseFamily(caseName);
  return family.checkAnswer(spec, answer, context);
}

function prompt(caseName, vaultId, agentRoot) {
  const result = join(agentRoot, "query-result.json");
  const retained = resolve(agentRoot, "..", "result.json");
  const catalog = join(agentRoot, "packages/item-query/dist/query.schema.json");
  const preamble = `Read ${join(agentRoot, "SKILL.md")} and follow it for this request. Use only the evaluation vault ID ${vaultId}. The Obsidian CLI executable for this session is ${join(agentRoot, "obsidian")}. Use this executable for every Obsidian call, including calls from scripts. Put vault=${vaultId} before every Obsidian command name. The matching development schema catalog is ${catalog}. Read only the copied skill, that catalog, live CLI output, and files you make for this task; do not read evaluator sources.\n\nUser request: ${cases[caseName]}\n\n`;
  const { spec, family } = caseFamily(caseName);
  return family.prompt(spec, { preamble, agentRoot, result, retained });
}

/**
 * Grades the evidence retained in a run folder. A live run and a regrade of a
 * saved run both call this after the evidence is in `root`.
 */
export async function gradeRun(
  caseName,
  root,
  { runRoot, vaultPath, metrics, cliCalls },
) {
  const { spec, family } = caseFamily(caseName);
  const resultPath = join(root, "result.json");
  const resultText = await readFile(resultPath);
  const envelope = JSON.parse(resultText);
  const answer = JSON.parse(await readFile(join(root, "answer.json"), "utf8"));
  const evidence = await family.loadEvidence(spec, root);
  const errors = [
    ...validate(caseName, envelope, { runRoot, vaultPath }),
    ...family.checkRun(spec, {
      ...evidence,
      metrics,
      cliCalls,
      agentRoot: join(root, "agent"),
      resultBytes: Buffer.byteLength(resultText),
    }),
    ...checkAnswer(caseName, answer, {
      ...evidence,
      resultPath,
      runRoot,
      envelope,
    }),
  ];
  if (metrics.forbiddenReads.length)
    errors.push("agent read evaluator sources");
  return { answer, errors };
}

/** The lifecycle seam accepts a fake process runner in tests; production uses spawn. */
export async function runCase(
  {
    caseName,
    agent: agentKind = "codex",
    model,
    effort,
    agentTimeoutMs = 600_000,
  },
  { processRunner = runProcess, runId = randomUUID(), signal } = {},
) {
  if (!cases[caseName]) fail(`unknown case: ${caseName}`);
  const { spec, family } = caseFamily(caseName);
  if (!/^[a-f0-9-]{36}$/i.test(runId)) fail("run ID must be a UUID");
  const parent = join(repo, ".scratch", "zotlit-query-evals");
  await mkdir(parent, { recursive: true });
  const root = join(parent, runId);
  await mkdir(root);
  const base = join(root, "base"),
    corpus = join(root, "corpus"),
    vault = join(root, `vault-${runId}`),
    agent = join(root, "agent");
  await mkdir(agent);
  const report = {
    case: caseName,
    agent: agentKind,
    runId,
    model,
    effort,
    state: "running",
    failureKind: null,
    errors: [],
    metrics: null,
    misreadings: [],
    cleanupRequired: [],
    files: {
      root,
      report: join(root, "report.json"),
      result: join(root, "result.json"),
      exportReceipt: join(root, "export-receipt.json"),
      image: join(root, "image.json"),
      answer: join(root, "answer.json"),
      check: join(root, "check.json"),
      cliCalls: join(root, "cli-calls.jsonl"),
    },
  };
  let cliWrapper;
  let vaultOpened = false;
  let vaultId = null;
  try {
    vaultOpened = true; // A failed open may still have registered a window.
    const open = await processRunner(
      process.execPath,
      [fixtureTool, "--fixture-root", base, "--inactive", "open", vault],
      { cwd: repo, timeoutMs: 180_000, signal },
    );
    required(open, "Fixture vault setup");
    vaultId = open.stdout.trim().split("\n")[0];
    if (!vaultId) fail("vault setup returned no vault ID");
    const prepared = await processRunner(
      process.execPath,
      [prepareTool, base, corpus],
      { cwd: repo, timeoutMs: 180_000, signal },
    );
    required(prepared, "Fixture copy and seed");
    const data = join(corpus, "zotero-data");
    const evalCode = `{const pref=app.plugins.plugins.zotlit.services.zoteroPref;pref.setDataDir(${JSON.stringify(data)});"configured"}`;
    const linked = await processRunner(
      process.execPath,
      [cliTool, "--code", evalCode, `vault=${vaultId}`],
      { cwd: repo, timeoutMs: 35_000, signal },
    );
    if (required(linked, "source switch").trim() !== "=> configured")
      fail(`source switch failed: ${linked.stdout}`);
    const expectedDb = join(data, "zotero.sqlite");
    let ready = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      if (signal?.aborted) fail("evaluation interrupted");
      const schema = await processRunner(
        process.execPath,
        [cliTool, `vault=${vaultId}`, "zotlit:query-schema"],
        { cwd: repo, timeoutMs: 35_000, signal },
      );
      try {
        const response = JSON.parse(required(schema, "source identity check"));
        if (
          response.ok === true &&
          response.identity?.source?.databasePath === expectedDb &&
          response.identity?.vault?.path === vault
        ) {
          ready = true;
          break;
        }
      } catch {
        /* source refresh may still be in progress */
      }
      await pause(500);
    }
    if (!ready) fail("evaluation vault did not resolve the seeded database");
    report.state = "agent";
    await cp(skillFile, join(agent, "SKILL.md"));
    const copiedCatalog = join(
      agent,
      "packages/item-query/dist/query.schema.json",
    );
    await mkdir(resolve(copiedCatalog, ".."), { recursive: true });
    await cp(catalogFile, copiedCatalog);
    await writeFile(
      join(agent, "answer.schema.json"),
      JSON.stringify(family.answerSchema(spec), null, 2),
    );
    const answerPath = join(agent, "answer.json");
    const schema = JSON.parse(
      await readFile(join(agent, "answer.schema.json"), "utf8"),
    );
    const gitPointer = await readFile(join(repo, ".git"), "utf8").catch(
      () => null,
    );
    const gitDir = gitPointer?.startsWith("gitdir: ")
      ? resolve(repo, gitPointer.trim().slice(8))
      : join(repo, ".git");
    const commonDir = await readFile(join(gitDir, "commondir"), "utf8").catch(
      () => ".",
    );
    cliWrapper = await startCliWrapper({
      agentRoot: agent,
      callLog: report.files.cliCalls,
      vaultId,
      invoke: (argv, callSignal) =>
        processRunner(process.execPath, [cliTool, ...argv], {
          cwd: agent,
          timeoutMs: agentTimeoutMs,
          signal: callSignal,
        }),
    });
    const args =
      agentKind === "codex"
        ? [
            "exec",
            "--json",
            "--ephemeral",
            "--skip-git-repo-check",
            "--sandbox",
            "workspace-write",
            "--cd",
            agent,
            "--model",
            model,
            "-c",
            `model_reasoning_effort=${effort}`,
            "--output-schema",
            join(agent, "answer.schema.json"),
            "--output-last-message",
            answerPath,
            "-",
          ]
        : [
            "-p",
            "--model",
            model,
            "--effort",
            effort,
            "--output-format",
            "stream-json",
            "--verbose",
            "--json-schema",
            JSON.stringify(schema),
            "--no-session-persistence",
            "--safe-mode",
            "--restricted",
            "--strict-mcp-config",
            "--tools",
            "Bash,Read,Write,Edit",
            "--allowedTools",
            "Bash,Read,Write,Edit",
            "--permission-mode",
            "dontAsk",
            "--settings",
            JSON.stringify({
              sandbox: {
                enabled: true,
                failIfUnavailable: true,
                autoAllowBashIfSandboxed: true,
                allowUnsandboxedCommands: false,
                filesystem: {
                  allowWrite: [agent],
                  denyWrite: [
                    gitDir,
                    resolve(gitDir, commonDir.trim()),
                    report.files.cliCalls,
                  ],
                },
                network: {
                  allowUnixSockets: [
                    obsidianCliSocketPath(),
                    cliWrapper.socketPath,
                  ],
                },
              },
            }),
          ];
    const run = await processRunner(agentKind, args, {
      cwd: agent,
      input: prompt(caseName, vaultId, agent),
      timeoutMs: agentTimeoutMs,
      signal,
    });
    await writeFile(join(root, "agent-events.jsonl"), run.stdout);
    await writeFile(join(root, "agent-stderr.txt"), run.stderr);
    await cliWrapper.close();
    const cliCalls = (await readFile(report.files.cliCalls, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map(JSON.parse);
    report.metrics = measureEvents(run.stdout, agentKind, cliCalls);
    report.misreadings = report.metrics.misreadings;
    report.metrics.agentExitCode = run.code;
    report.metrics.agentTimedOut = run.timedOut;
    report.metrics.agentAborted = run.aborted ?? false;
    if (run.timedOut || run.aborted || run.code !== 0) {
      report.failureKind = "environment";
      fail(
        `agent execution ${run.timedOut ? "timed out" : run.aborted ? "interrupted" : `exited ${run.code}`}: ${run.stderr.slice(-2000)}`,
      );
    }
    const sandboxFailure = report.misreadings.find((entry) =>
      entry.output?.includes(
        "sandbox-exec: sandbox_apply: Operation not permitted",
      ),
    );
    if (sandboxFailure && report.metrics.queryExitZero === 0) {
      report.failureKind = "environment";
      fail(
        "The parent sandbox prevented the agent's Bash sandbox from starting: sandbox-exec: sandbox_apply: Operation not permitted",
      );
    }
    if (agentKind === "claude") {
      const final = parseEvents(run.stdout).findLast(
        (event) => event.type === "result",
      );
      if (final?.is_error || !final?.structured_output)
        fail(
          `Claude returned no structured answer: ${final?.subtype ?? "missing result"}`,
        );
      await writeFile(answerPath, JSON.stringify(final.structured_output));
    }
    report.answer = JSON.parse(await readFile(answerPath, "utf8"));
    await cp(answerPath, report.files.answer);
    await cp(join(agent, "query-result.json"), report.files.result);
    await family.retainEvidence(spec, { agentRoot: agent, root });
    const graded = await gradeRun(caseName, root, {
      runRoot: corpus,
      vaultPath: vault,
      metrics: report.metrics,
      cliCalls,
    });
    report.errors = graded.errors;
    report.state = report.errors.length ? "failed" : "passed";
    if (report.errors.length) report.failureKind = "task";
  } catch (error) {
    report.errors.push(error.message);
    if (!report.failureKind)
      report.failureKind = report.state === "agent" ? "agent" : "environment";
    report.state = "failed";
  } finally {
    await cliWrapper?.close();
    let removed = true;
    if (vaultOpened) {
      const removal = await processRunner(
        process.execPath,
        [fixtureTool, "remove", vault, "--purge"],
        { cwd: repo, timeoutMs: 180_000 },
      ).catch((error) => ({ code: -1, stderr: error.message }));
      if (removal.code !== 0) {
        removed = false;
        report.errors.push(`vault cleanup failed: ${removal.stderr}`);
        report.state = "failed";
        report.failureKind ??= "environment";
        report.cleanupRequired = [vault, base, corpus];
      }
    }
    if (removed) {
      await rm(base, { recursive: true, force: true });
      await rm(corpus, { recursive: true, force: true });
    }
    await rm(agent, { recursive: true, force: true });
    await writeFile(
      report.files.check,
      `${JSON.stringify(
        {
          pass: report.errors.length === 0 && report.state === "passed",
          errors: report.errors,
        },
        null,
        2,
      )}\n`,
    );
    await writeFile(join(root, "report.md"), renderReport(report));
    await writeFile(
      report.files.report,
      `${JSON.stringify(report, null, 2)}\n`,
    );
  }
  return report;
}

export function renderReport(report) {
  return `# ${report.case}: ${report.state}\n\nAgent: ${report.agent}; model: ${report.model}; effort: ${report.effort}\n\n${report.errors.join("\n")}\n\n## Misreadings\n\n${
    (report.misreadings ?? [])
      .map(
        (entry) =>
          `- Command: \`${entry.command}\`\n  Diagnostic / warnings: \`${JSON.stringify(entry.diagnostic ?? entry.warnings)}\`\n  Output: ${entry.output ?? "See structured report"}\n  Retried: ${entry.retry}; recovered: ${entry.recovered}\n`,
      )
      .join("\n") || "None observed.\n"
  }`;
}

export async function runBatch(
  options,
  { caseRunner = runCase, signal, runId = randomUUID() } = {},
) {
  const root = join(repo, ".scratch", "zotlit-query-evals", runId);
  await mkdir(root, { recursive: true });
  const reports = [];
  const summary = {
    agent: options.agent ?? "codex",
    model: options.model,
    effort: options.effort,
    state: "running",
    cases: [],
    failures: { environment: 0, agent: 0, task: 0 },
    files: { report: join(root, "summary.json") },
  };
  for (const caseName of Object.keys(cases)) {
    if (signal?.aborted) break;
    const report = await caseRunner({ ...options, caseName }, { signal });
    reports.push(report);
    summary.cases.push({
      case: caseName,
      state: report.state,
      failureKind: report.failureKind,
      errors: report.errors,
      metrics: report.metrics,
      misreadings: report.misreadings ?? [],
      report: report.files.report,
    });
    if (report.failureKind) summary.failures[report.failureKind]++;
    await writeFile(summary.files.report, JSON.stringify(summary, null, 2));
  }
  summary.state =
    reports.length === Object.keys(cases).length &&
    reports.every((r) => r.state === "passed")
      ? "passed"
      : "failed";
  await writeFile(summary.files.report, JSON.stringify(summary, null, 2));
  await writeFile(
    join(root, "summary.md"),
    `# ${summary.agent}: ${summary.model}\n\nEffort: ${summary.effort}. State: ${summary.state}.\n\nFailures: ${JSON.stringify(summary.failures)}\n\n| Case | Result | Failure kind | Query / schema / guide / image calls | Context bytes |\n| --- | --- | --- | --- | --- |\n${summary.cases
      .map(
        (r) =>
          `| ${r.case} | ${r.state} | ${r.failureKind ?? ""} | ${[r.metrics?.queryAttempts, r.metrics?.schemaAttempts, r.metrics?.guideAttempts, r.metrics?.imageAttempts].join(" / ")} | ${r.metrics?.contextualBytes ?? 0} |`,
      )
      .join("\n")}\n\n${reports.map(renderReport).join("\n")}`,
  );
  return summary;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (!options) {
    console.log(
      "usage: node run.mjs <case|all> [--agent codex|claude] --model <model> --effort <low|medium|high|xhigh> [--timeout-minutes 10]",
    );
    return;
  }
  const controller = new AbortController();
  let interrupted = false;
  const onInterrupt = () => {
    interrupted = true;
    controller.abort();
  };
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onInterrupt);
  let report;
  try {
    report =
      options.caseName === "all"
        ? await runBatch(options, { signal: controller.signal })
        : await runCase(options, { signal: controller.signal });
  } finally {
    process.removeListener("SIGINT", onInterrupt);
    process.removeListener("SIGTERM", onInterrupt);
  }
  console.log(
    JSON.stringify(
      {
        state: report.state,
        failureKind: report.failureKind,
        errors: report.errors,
        metrics: report.metrics,
        report: report.files.report,
      },
      null,
      2,
    ),
  );
  if (interrupted) process.exitCode = 130;
  else if (report.state !== "passed") process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 2;
  });
