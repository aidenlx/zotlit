import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";

import { measureEvents, runCase, runProcess } from "./run.mjs";

const repo = resolve(import.meta.dirname, "../../..");
const oracle = JSON.parse(
  await readFile(new URL("./oracle.json", import.meta.url), "utf8"),
);

async function exercise(
  answerCount,
  {
    openFailure = false,
    agentTimedOut = false,
    removalFailure = false,
    noQuery = false,
    wrongDetail = false,
  } = {},
) {
  const runId = randomUUID();
  const root = join(repo, ".scratch", "zotlit-query-evals", runId);
  const vault = join(root, `vault-${runId}`);
  const corpus = join(root, "corpus");
  const commands = [];
  const processRunner = async (command, args, options) => {
    commands.push([command, args]);
    if (args.includes("open")) {
      await mkdir(join(root, "base"));
      await mkdir(vault);
      return openFailure
        ? { code: 1, stdout: "", stderr: "host unavailable", timedOut: false }
        : {
            code: 0,
            stdout: "fake-vault-id\nextra log\n",
            stderr: "",
            timedOut: false,
          };
    }
    if (args.some((arg) => arg.endsWith("prepare.mjs"))) {
      await mkdir(corpus);
      return { code: 0, stdout: "{}", stderr: "", timedOut: false };
    }
    if (args.includes("--code"))
      return { code: 0, stdout: "=> configured", stderr: "", timedOut: false };
    if (args.includes("zotlit:item-query-schema"))
      return {
        code: 0,
        stdout: JSON.stringify({
          ok: true,
          identity: {
            source: {
              databasePath: join(corpus, "zotero-data", "zotero.sqlite"),
            },
            vault: { path: vault },
          },
        }),
        stderr: "",
        timedOut: false,
      };
    if (command === "codex") {
      assert.match(options.input, /vault=fake-vault-id/);
      assert.doesNotMatch(options.input, /oracle\.json/);
      if (agentTimedOut)
        return { code: null, stdout: "", stderr: "", timedOut: true };
      const rows = oracle.cases.edge.rows.map((row) => ({
        indexedKey: row.indexedKey,
        values: {
          title: row.title,
          "date.year": row.year,
          creators: [
            {
              fullName: row.firstCreator,
              role: row.firstAuthor ? "author" : "editor",
            },
          ],
        },
      }));
      const envelope = {
        ok: true,
        identity: {
          source: {
            databasePath: join(corpus, "zotero-data", "zotero.sqlite"),
          },
          vault: { path: vault },
        },
        request: { limit: null, fields: ["title", "date.year", "creators"] },
        libraries: [{ type: "personal" }, { type: "group", groupID: 118 }],
        returnedCount: 3,
        truncated: false,
        rows,
      };
      await writeFile(
        join(options.cwd, "query-result.json"),
        JSON.stringify(envelope),
      );
      await writeFile(
        join(options.cwd, "answer.json"),
        JSON.stringify({
          answer: "Three books",
          count: answerCount,
          missingPublicationYears: 1,
          items: oracle.cases.edge.rows.map((row, index) => ({
            indexedKey: row.indexedKey,
            title: wrongDetail && index === 0 ? "Unknown book" : row.title,
            publicationYear: row.year,
            library: row.indexedKey.endsWith("g118")
              ? "Lab Archive"
              : "My Library",
            firstAuthor: row.firstAuthor,
            editor: row.firstAuthor === null ? row.firstCreator : null,
          })),
          duplicateKeyGroups: [
            { key: "EVALSAME", libraries: ["My Library", "Lab Archive"] },
          ],
          exportPath: null,
        }),
      );
      return {
        code: 0,
        stdout: `${JSON.stringify({
          type: "item.completed",
          item: {
            id: "command-1",
            type: "command_execution",
            command: noQuery
              ? "echo done"
              : "node obsidian-cli.ts vault=fake-vault-id zotlit:item-query",
            aggregated_output: "result",
            exit_code: 0,
          },
        })}\n`,
        stderr: "",
        timedOut: false,
      };
    }
    if (args.includes("remove")) {
      if (removalFailure)
        return {
          code: 1,
          stdout: "",
          stderr: "window did not close",
          timedOut: false,
        };
      await rm(vault, { recursive: true, force: true });
      return { code: 0, stdout: "", stderr: "", timedOut: false };
    }
    throw new Error(`unexpected process: ${command} ${args.join(" ")}`);
  };
  try {
    const report = await runCase(
      { caseName: "edge", model: "fake-model", effort: "low" },
      { runId, processRunner },
    );
    assert.equal(
      commands.filter(([, args]) => args.includes("remove")).length,
      1,
    );
    assert.equal((await stat(join(root, "report.json"))).isFile(), true);
    if (removalFailure) {
      for (const path of [join(root, "base"), corpus, vault])
        assert.equal((await stat(path)).isDirectory(), true);
      assert.deepEqual(report.cleanupRequired, [
        vault,
        join(root, "base"),
        corpus,
      ]);
      const check = JSON.parse(
        await readFile(join(root, "check.json"), "utf8"),
      );
      assert.equal(check.pass, false);
      assert.match(check.errors.join("\n"), /vault cleanup failed/);
    } else {
      for (const path of [join(root, "base"), corpus, vault])
        await assert.rejects(stat(path));
    }
    await assert.rejects(stat(join(root, "agent")));
    return report;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await test("fake agent passes and leaves a compact report after cleanup", async () => {
  const report = await exercise(3);
  assert.equal(report.state, "passed");
  assert.equal(report.metrics.queryAttempts, 1);
});

await test("fake agent's wrong answer is a task failure", async () => {
  const report = await exercise(2);
  assert.equal(report.state, "failed");
  assert.equal(report.failureKind, "task");
  assert.match(report.errors.join("\n"), /answer count/);
});

await test("saved envelope without an observed query call fails", async () => {
  const report = await exercise(3, { noQuery: true });
  assert.equal(report.failureKind, "task");
  assert.match(
    report.errors.join("\n"),
    /no completed Item Query call with exit code zero/,
  );
});

await test("a complete query envelope does not excuse a wrong final detail", async () => {
  const report = await exercise(3, { wrongDetail: true });
  assert.equal(report.failureKind, "task");
  assert.match(report.errors.join("\n"), /wrong Item details/);
});

await test("setup failure and agent timeout both tear down the owned vault", async () => {
  const setup = await exercise(3, { openFailure: true });
  assert.equal(setup.failureKind, "environment");
  assert.match(setup.errors.join("\n"), /host unavailable/);
  const timeout = await exercise(3, { agentTimedOut: true });
  assert.equal(timeout.failureKind, "environment");
  assert.match(timeout.errors.join("\n"), /timed out/);
});

await test("failed vault removal retains its database and reports recovery paths", async () => {
  const report = await exercise(3, { removalFailure: true });
  assert.equal(report.state, "failed");
  assert.match(report.errors.join("\n"), /vault cleanup failed/);
});

await test("metrics count completed commands once and distinguish retries from extra queries", () => {
  const query = "node obsidian-cli.ts vault=fake zotlit:item-query";
  const event = (id, output, exit_code = 0) =>
    JSON.stringify({
      type: "item.completed",
      item: {
        id,
        type: "command_execution",
        command: query,
        aggregated_output: output,
        exit_code,
      },
    });
  const events = [
    JSON.stringify({
      type: "item.started",
      item: { id: "q1", type: "command_execution", command: query },
    }),
    event("q1", '{"ok":true}'),
    event("q1", '{"ok":true}'),
    event("q2", '{"ok":false}'),
    event("q3", '{"ok":true}'),
  ].join("\n");
  assert.deepEqual(measureEvents(events), {
    calls: 3,
    queryAttempts: 3,
    queryExitZero: 3,
    itemQueryAttempts: 3,
    itemQueryExitZero: 3,
    annotationQueryAttempts: 0,
    annotationQueryExitZero: 0,
    imageAttempts: 0,
    imageExitZero: 0,
    queryRetries: 1,
    contextualBytes: Buffer.byteLength('{"ok":true}{"ok":false}{"ok":true}'),
    forbiddenReads: [],
  });
});

await test("metrics distinguish Item, Annotation, and Excerpt Image commands", () => {
  const event = (id, command) =>
    JSON.stringify({
      type: "item.completed",
      item: {
        id,
        type: "command_execution",
        command: `node obsidian-cli.ts vault=fake ${command}`,
        aggregated_output: '{"ok":true}',
        exit_code: 0,
      },
    });
  const metrics = measureEvents(
    [
      event("item", "zotlit:item-query"),
      event("annotation", "zotlit:annotation-query"),
      event("image", "zotlit:annotation-image key=FDRFQ7C2"),
    ].join("\n"),
  );
  assert.equal(metrics.itemQueryExitZero, 1);
  assert.equal(metrics.annotationQueryExitZero, 1);
  assert.equal(metrics.imageExitZero, 1);
});

await test("a process timeout and an abort stop the process group", async () => {
  const hanging = [
    "-e",
    'const {spawn}=require("node:child_process");spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"inherit"});setInterval(()=>{},1000)',
  ];
  const timed = await runProcess(process.execPath, hanging, { timeoutMs: 50 });
  assert.equal(timed.timedOut, true);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 50);
  try {
    const aborted = await runProcess(process.execPath, hanging, {
      signal: controller.signal,
      timeoutMs: 5000,
    });
    assert.equal(aborted.aborted, true);
  } finally {
    clearTimeout(timer);
  }
});
