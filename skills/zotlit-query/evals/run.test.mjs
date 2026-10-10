import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
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
    skipDiscovery = false,
    sandboxFailure = false,
    observedEvaluatorRead = false,
    wrongDetail = false,
    wrongExportReceipt = false,
    caseName = "edge",
    agent = "codex",
    changeAnnotation = () => {},
  } = {},
) {
  const runId = randomUUID();
  const root = join(repo, ".scratch", "zotlit-query-evals", runId);
  const vault = join(root, `vault-${runId}`);
  const corpus = join(root, "corpus");
  const commands = [];
  let queryResponse;
  const logQuery = async (envelope, options) => {
    if (noQuery) return;
    queryResponse = envelope;
    await writeFile(
      join(options.cwd, "nested.sh"),
      '#!/bin/sh\nexec ./obsidian "$@"\n',
      { mode: 0o700 },
    );
    const discovery = oracle.cases[caseName].discovery;
    if (discovery && !skipDiscovery) {
      const listed = await runProcess(
        "./obsidian",
        [
          "vault=fake-vault-id",
          "zotlit:query-values",
          "kind=collections",
          `library=${discovery.library}`,
        ],
        { cwd: options.cwd },
      );
      assert.equal(listed.code, 0, listed.stderr);
    }
    const queried = await runProcess(
      "./nested.sh",
      [
        "vault=fake-vault-id",
        "zotlit:query",
        `from=${envelope.request.from}`,
        ...(discovery ? [`filter=${envelope.request.filter}`] : []),
      ],
      { cwd: options.cwd },
    );
    assert.equal(queried.code, 0, queried.stderr);
  };
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
    if (args.includes("zotlit:query-schema"))
      return {
        code: 0,
        stdout: JSON.stringify({
          ok: true,
          contractVersion: 3,
          command: "zotlit:query",
          warnings: [],
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
    if (args.includes("zotlit:query-values"))
      return {
        code: 0,
        stderr: "",
        timedOut: false,
        stdout: JSON.stringify({
          ok: true,
          values: [{ library: "personal", values: ["Query thesis"] }],
        }),
      };
    if (args[0]?.endsWith("obsidian-cli.ts") && args.includes("zotlit:query"))
      return {
        code: 0,
        stdout: JSON.stringify(queryResponse),
        stderr: "",
        timedOut: false,
      };
    if (command === "codex" || command === "claude") {
      if (command === "claude") {
        assert.ok(args.includes("--restricted"));
        assert.ok(args.includes("--json-schema"));
        assert.ok(args.includes("--effort"));
      }
      assert.match(options.input, /vault=fake-vault-id/);
      assert.doesNotMatch(options.input, /oracle\.json|obsidian-cli\.ts/);
      assert.ok(options.input.includes(join(options.cwd, "obsidian")));
      assert.ok((await stat(join(options.cwd, "obsidian"))).mode & 0o100);
      if (sandboxFailure)
        return {
          code: 0,
          stderr: "",
          timedOut: false,
          stdout: `${JSON.stringify({
            type: "assistant",
            message: {
              content: [
                {
                  type: "tool_use",
                  id: "denied",
                  name: "Bash",
                  input: {
                    command:
                      "node obsidian-cli.ts vault=fake zotlit:query-guide",
                  },
                },
              ],
            },
          })}\n${JSON.stringify({
            type: "user",
            message: {
              content: [
                {
                  type: "tool_result",
                  tool_use_id: "denied",
                  is_error: true,
                  content:
                    "sandbox-exec: sandbox_apply: Operation not permitted",
                },
              ],
            },
          })}`,
        };
      if (agentTimedOut)
        return { code: null, stdout: "", stderr: "", timedOut: true };
      if (oracle.cases[caseName].kind === "research") {
        const live = JSON.parse(
          await readFile(
            new URL("./live-projections.json", import.meta.url),
            "utf8",
          ),
        )[caseName];
        const envelope = JSON.parse(
          JSON.stringify(live.envelope).replaceAll(
            "/evaluation-run/corpus",
            corpus,
          ),
        );
        envelope.identity.vault.path = vault;
        const answer = JSON.parse(
          JSON.stringify(live.answer)
            .replaceAll("/evaluation-run/corpus", corpus)
            .replaceAll(
              "/evaluation-run/advisor.csv",
              join(root, "advisor.csv"),
            ),
        );
        changeAnnotation(answer, envelope);
        await logQuery(envelope, options);
        await writeFile(
          join(options.cwd, "query-result.json"),
          JSON.stringify(envelope),
        );
        await writeFile(
          join(options.cwd, "answer.json"),
          JSON.stringify(answer),
        );
        if (caseName === "csv_for_advisor") {
          assert.ok(
            options.input.includes(
              `save advisor.csv at ${join(options.cwd, "advisor.csv")}`,
            ),
          );
          assert.ok(
            options.input.includes(
              `The runner copies advisor.csv to ${join(root, "advisor.csv")} after the run.`,
            ),
          );
          assert.ok(
            options.input.includes(
              "Report that retained path; do not write there.",
            ),
          );
        }
        if (caseName === "csv_for_advisor")
          await writeFile(
            join(options.cwd, "advisor.csv"),
            `title,year\n${oracle.cases[caseName].rows
              .map((r) => `${r.values.title},${r.values["date.year"] ?? ""}`)
              .join("\n")}`,
          );
        const query = `node obsidian-cli.ts vault=fake-vault-id zotlit:query from=${envelope.request.from}`;
        const events =
          command === "claude"
            ? [
                {
                  type: "assistant",
                  message: {
                    content: [
                      {
                        type: "tool_use",
                        id: "q",
                        name: "Bash",
                        input: { command: query },
                      },
                    ],
                  },
                },
                {
                  type: "user",
                  message: {
                    content: [
                      {
                        type: "tool_result",
                        tool_use_id: "q",
                        content: JSON.stringify(envelope),
                      },
                    ],
                  },
                },
                { type: "result", structured_output: answer, is_error: false },
              ]
            : [
                {
                  type: "item.completed",
                  item: {
                    id: "q",
                    type: "command_execution",
                    command: query,
                    aggregated_output: JSON.stringify(envelope),
                    exit_code: 0,
                  },
                },
              ];
        if (observedEvaluatorRead) {
          if (command === "claude")
            events.push(
              {
                type: "assistant",
                message: {
                  content: [
                    {
                      type: "tool_use",
                      id: "read-oracle",
                      name: "Read",
                      input: { file_path: "../oracle.json" },
                    },
                  ],
                },
              },
              {
                type: "user",
                message: {
                  content: [
                    {
                      type: "tool_result",
                      tool_use_id: "read-oracle",
                      content: "oracle",
                    },
                  ],
                },
              },
            );
          else
            events.push({
              type: "item.completed",
              item: {
                id: "read-oracle",
                type: "command_execution",
                command: "cat ../oracle.json",
                aggregated_output: "oracle",
                exit_code: 0,
              },
            });
        }
        return {
          code: 0,
          stderr: "",
          timedOut: false,
          stdout: events.map((e) => JSON.stringify(e)).join("\n"),
        };
      }
      if (
        oracle.annotationRows[oracle.cases[caseName]?.keys?.[0]]?.sourceSuffix
      ) {
        const expected = oracle.cases[caseName];
        const schema = JSON.parse(
          await readFile(args[args.indexOf("--output-schema") + 1], "utf8"),
        );
        assert.deepEqual(Object.hasOwn(schema.properties, "papers"), false);
        if (caseName === "missing_source")
          assert.ok(
            schema.properties.annotations.items.required.includes(
              "attachmentExists",
            ),
          );
        const identity = {
          source: {
            databasePath: join(corpus, "zotero-data", "zotero.sqlite"),
          },
          vault: { path: vault },
        };
        const rows = expected.keys
          .map((key) => oracle.annotationRows[key])
          .map((spec) => ({
            indexedKey: spec.key,
            itemIndexedKey: spec.item,
            attachmentIndexedKey: spec.attachment,
            values: {
              type: spec.type,
              pageLabel: spec.pageLabel,
              text: spec.text,
              comment: spec.comment,
              colorName: spec.colorName,
              library: spec.library,
              tags: spec.tags,
              pageIndex: spec.pageIndex,
              attachment: {
                path: join(
                  corpus,
                  "zotero-data",
                  "storage",
                  spec.attachment.endsWith("g118")
                    ? spec.attachment.slice(0, -4)
                    : spec.attachment,
                  basename(spec.sourceSuffix),
                ),
                exists: spec.sourceExists,
              },
            },
          }));
        const envelope = {
          ok: true,
          contractVersion: 3,
          command: "zotlit:query",
          warnings: [],
          identity,
          libraries: [{ type: "personal" }, { type: "group", groupID: 118 }],
          request: {
            from: "annotations",
            limit: null,
            fields: [
              "type",
              "pageLabel",
              "text",
              "comment",
              "library",
              "colorName",
              "tags",
              "pageIndex",
              "attachment",
            ],
            filter:
              caseName === "colors"
                ? 'item.indexedKey == "QANPAPER" && colorName == "blue" && tags.contains("query-annotation-method") && pageIndex == 0'
                : caseName === "missing_source"
                  ? 'comment == "Check this source when the file arrives."'
                  : caseName === "attachment" ||
                      caseName === "export_annotations"
                    ? 'attachment.indexedKey == "QANPDF22g118"'
                    : null,
            sort:
              caseName === "reverse_pages"
                ? [{ field: "pageIndex", direction: "desc" }]
                : [],
          },
          returnedCount: expected.count,
          truncated: false,
          rows,
        };
        const answer = {
          answer: "Complete matches",
          count: expected.count,
          annotations: rows.map((row) => {
            const result = { indexedKey: row.indexedKey };
            for (const field of schema.properties.annotations.items.required) {
              if (field === "indexedKey") continue;
              result[field] =
                field === "attachmentPath"
                  ? row.values.attachment.path
                  : field === "library"
                    ? row.indexedKey.endsWith("g118")
                      ? "Lab Archive"
                      : "My Library"
                    : field === "attachmentExists"
                      ? row.values.attachment.exists
                      : field === "itemIndexedKey" ||
                          field === "attachmentIndexedKey"
                        ? row[field]
                        : row.values[field];
            }
            return result;
          }),
          ...(caseName === "export_annotations"
            ? { exportPath: join(root, "result.json") }
            : {}),
          imagePath: null,
          imageProvenance: null,
          imageFormat: null,
          validPng: null,
        };
        changeAnnotation(answer, envelope);
        await logQuery(envelope, options);
        await writeFile(
          join(options.cwd, "query-result.json"),
          JSON.stringify(envelope),
        );
        if (caseName === "export_annotations")
          await writeFile(
            join(options.cwd, "export-receipt.json"),
            JSON.stringify({
              ok: true,
              contractVersion: 3,
              command: "zotlit:query",
              warnings: [],
              file: {
                path: join(options.cwd, "query-result.json"),
                bytes:
                  Buffer.byteLength(JSON.stringify(envelope)) +
                  (wrongExportReceipt ? 1 : 0),
                format: "json",
              },
            }),
          );
        await writeFile(
          join(options.cwd, "answer.json"),
          JSON.stringify(answer),
        );
        const events = ["zotlit:query from=annotations"];
        return {
          code: 0,
          stderr: "",
          timedOut: false,
          stdout: `${events
            .map((name, index) =>
              JSON.stringify({
                type: "item.completed",
                item: {
                  id: `query-${index}`,
                  type: "command_execution",
                  command: `node obsidian-cli.ts vault=fake-vault-id ${name}`,
                  aggregated_output: "result",
                  exit_code: 0,
                },
              }),
            )
            .join("\n")}\n`,
        };
      }
      if (caseName !== "edge") {
        const schema = JSON.parse(
          await readFile(args[args.indexOf("--output-schema") + 1], "utf8"),
        );
        const itemSchema = schema.properties.annotations.items;
        assert.equal(
          Object.hasOwn(itemSchema.properties, "attachmentExists"),
          false,
        );
        if (caseName === "mixed") {
          assert.deepEqual(itemSchema.required, [
            "indexedKey",
            "itemTitle",
            "tags",
            "hasExcerptImage",
          ]);
          assert.equal(
            Object.hasOwn(itemSchema.properties, "attachmentPath"),
            false,
          );
        } else {
          assert.ok(itemSchema.required.includes("attachmentPath"));
        }
        const expected = oracle.cases[caseName];
        const path = join(corpus, "attachments/rougier-2014.pdf");
        const source = caseName === "annotations" || caseName === "position";
        const rows = expected.keys.map((indexedKey) => ({
          indexedKey,
          itemIndexedKey: "RUGIER24",
          attachmentIndexedKey: "RGRPDF24",
          values:
            caseName === "mixed"
              ? {
                  type: "image",
                  tags: ["figure"],
                  hasExcerptImage: true,
                  "item.title": expected.itemTitle,
                }
              : {
                  type:
                    expected.details?.[indexedKey]?.type ??
                    (indexedKey === "FDRFQ7C2" ? "image" : "highlight"),
                  pageLabel: expected.details?.[indexedKey]?.pageLabel ?? "1",
                  text: expected.details?.[indexedKey]
                    ? expected.details[indexedKey].text
                    : (expected.text ?? "Quoted text"),
                  comment: expected.details?.[indexedKey]?.comment ?? null,
                  ...(source ? { attachment: { path, exists: true } } : {}),
                  ...(caseName === "position"
                    ? { position: expected.position }
                    : {}),
                },
        }));
        const envelope = {
          ok: true,
          contractVersion: 3,
          command: "zotlit:query",
          warnings: [],
          identity: {
            source: {
              databasePath: join(corpus, "zotero-data", "zotero.sqlite"),
            },
            vault: { path: vault },
          },
          request: {
            from: "annotations",
            limit: null,
            fields: Object.keys(rows[0].values),
            filter:
              'type == "image" && tags.contains("figure") && item.citationKey == "rougierTenSimpleRules2014"',
          },
          libraries: [{ type: "personal" }],
          returnedCount: expected.count,
          truncated: false,
          rows,
        };
        const answer = {
          answer: "Complete matches",
          count: expected.count,
          annotations: rows.map((row) =>
            caseName === "mixed"
              ? {
                  indexedKey: row.indexedKey,
                  type: "image",
                  pageLabel: null,
                  text: null,
                  comment: null,
                  tags: ["figure"],
                  itemTitle: expected.itemTitle,
                  attachmentPath: null,
                  // Reproduce the live answer: the old shared schema forced this unrequested value.
                  attachmentExists: true,
                  hasExcerptImage: true,
                  position: null,
                }
              : {
                  indexedKey: row.indexedKey,
                  ...(caseName === "annotations"
                    ? {
                        type: row.values.type,
                        pageLabel: row.values.pageLabel,
                        text: row.values.text,
                        comment: row.values.comment,
                      }
                    : { position: expected.position }),
                  attachmentPath: path,
                },
          ),
          imagePath: null,
          imageProvenance: null,
          imageFormat: null,
          validPng: null,
        };
        changeAnnotation(answer, envelope);
        await logQuery(envelope, options);
        await writeFile(
          join(options.cwd, "query-result.json"),
          JSON.stringify(envelope),
        );
        await writeFile(
          join(options.cwd, "answer.json"),
          JSON.stringify(answer),
        );
        return {
          code: 0,
          stderr: "",
          timedOut: false,
          stdout: `${JSON.stringify({
            type: "item.completed",
            item: {
              id: "annotation",
              type: "command_execution",
              command:
                "node obsidian-cli.ts vault=fake-vault-id zotlit:query from=annotations",
              aggregated_output: "result",
              exit_code: 0,
            },
          })}\n`,
        };
      }
      const rows = oracle.cases.edge.rows.map((row) => ({
        indexedKey: row.indexedKey,
        values: {
          title: row.title,
          "date.year": row.year,
          library: row.indexedKey.endsWith("g118") ? "group:118" : "personal",
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
        contractVersion: 3,
        command: "zotlit:query",
        warnings: [],
        identity: {
          source: {
            databasePath: join(corpus, "zotero-data", "zotero.sqlite"),
          },
          vault: { path: vault },
        },
        request: {
          from: "items",
          limit: null,
          fields: ["title", "date.year", "creators", "library"],
        },
        libraries: [{ type: "personal" }, { type: "group", groupID: 118 }],
        returnedCount: 3,
        truncated: false,
        rows,
      };
      await logQuery(envelope, options);
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
              : "node obsidian-cli.ts vault=fake-vault-id zotlit:query",
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
      { caseName, agent, model: "fake-model", effort: "low" },
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
  const query = "node obsidian-cli.ts vault=fake zotlit:query";
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
  assert.partialDeepStrictEqual(
    measureEvents(events, "codex", [
      { argv: ["zotlit:query"], exitCode: 0, stdoutBytes: 11 },
      { argv: ["zotlit:query"], exitCode: 0, stdoutBytes: 12 },
      { argv: ["zotlit:query"], exitCode: 0, stdoutBytes: 11 },
    ]),
    {
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
    },
  );
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
      event("item", "zotlit:query"),
      event("annotation", "zotlit:query from=annotations"),
      event("image", "zotlit:annotation-image key=FDRFQ7C2"),
    ].join("\n"),
    "codex",
    [
      { argv: ["zotlit:query"], exitCode: 0, stdoutBytes: 11 },
      {
        argv: ["zotlit:query", "from=annotations"],
        exitCode: 0,
        stdoutBytes: 11,
      },
      { argv: ["zotlit:annotation-image"], exitCode: 0, stdoutBytes: 11 },
    ],
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

await test("mixed answer accepts its requested projection without attachment metadata", async () => {
  const report = await exercise(1, { caseName: "mixed" });
  assert.equal(report.state, "passed", report.errors.join("\n"));
});

await test("expanded cases pass through the runner and reject a wrong paper count", async () => {
  for (const caseName of [
    "reading_plan",
    "shared_marks",
    "attachment",
    "colors",
    "reverse_pages",
    "missing_source",
    "repair_filter",
    "export_annotations",
  ]) {
    const report = await exercise(null, { caseName });
    assert.equal(report.state, "passed", report.errors.join("\n"));
  }
  const wrong = await exercise(null, {
    caseName: "reading_plan",
    changeAnnotation(answer) {
      answer.rows[1].values["annotations.length"] = 1;
    },
  });
  assert.equal(wrong.failureKind, "task");
  assert.match(wrong.errors.join("\n"), /wrong annotations.length/);
  const badReceipt = await exercise(null, {
    caseName: "export_annotations",
    wrongExportReceipt: true,
  });
  assert.equal(badReceipt.failureKind, "task");
  assert.match(
    badReceipt.errors.join("\n"),
    /wrong Annotation Query export receipt/,
  );
});

for (const caseName of ["annotations", "position"]) {
  await test(`${caseName} answer accepts requested details and rejects a wrong source path`, async () => {
    const valid = await exercise(null, { caseName });
    assert.equal(valid.state, "passed", valid.errors.join("\n"));
    const wrong = await exercise(null, {
      caseName,
      changeAnnotation: (answer) => {
        answer.annotations[0].attachmentPath = "/wrong.pdf";
      },
    });
    assert.equal(wrong.failureKind, "task");
    assert.match(wrong.errors.join("\n"), /wrong source path/);
    const omitted = await exercise(null, {
      caseName,
      changeAnnotation: (answer, envelope) => {
        delete envelope.rows[0].values.attachment;
        answer.annotations[0].attachmentPath = null;
      },
    });
    assert.equal(omitted.failureKind, "task");
    assert.match(omitted.errors.join("\n"), /no source path/);
  });
}

for (const { field, value } of [
  { field: "tags", value: [] },
  { field: "hasExcerptImage", value: false },
  { field: "itemTitle", value: "Wrong title" },
]) {
  await test(`mixed answer rejects wrong requested ${field}`, async () => {
    const report = await exercise(1, {
      caseName: "mixed",
      changeAnnotation: (answer) => {
        answer.annotations[0][field] = value;
      },
    });
    assert.equal(report.failureKind, "task");
    assert.match(report.errors.join("\n"), new RegExp(`wrong ${field}`));
  });
}

for (const [field, value] of [
  ["type", "note"],
  ["pageLabel", "9"],
  ["text", "Wrong quote"],
  ["comment", "Wrong comment"],
]) {
  await test(`annotations answer rejects wrong requested ${field}`, async () => {
    const report = await exercise(null, {
      caseName: "annotations",
      changeAnnotation: (answer) => {
        answer.annotations[0][field] = value;
      },
    });
    assert.equal(report.failureKind, "task");
    assert.match(report.errors.join("\n"), new RegExp(`wrong ${field}`));
  });
}

await test("each research case passes with both agent paths", async () => {
  for (const caseName of Object.keys(oracle.cases).filter(
    (k) => oracle.cases[k].kind === "research",
  ))
    for (const agent of ["codex", "claude"]) {
      const report = await exercise(null, { caseName, agent });
      assert.equal(
        report.state,
        "passed",
        `${agent} ${caseName}: ${report.errors.join("\n")}`,
      );
    }
});

await test("batch runs every case sequentially and retains failure kinds and metrics", async () => {
  const { runBatch, parseOptions } = await import("./run.mjs");
  assert.equal(
    parseOptions([
      "all",
      "--agent",
      "claude",
      "--model",
      "claude-sonnet-5-5",
      "--effort",
      "high",
    ]).agent,
    "claude",
  );
  assert.equal(
    parseOptions(["include", "--model", "gpt-6.1-sol", "--effort", "high"])
      .agent,
    "codex",
  );
  assert.throws(() =>
    parseOptions([
      "all",
      "--agent",
      "other",
      "--model",
      "m",
      "--effort",
      "high",
    ]),
  );
  const runId = randomUUID();
  let active = 0;
  const order = [];
  try {
    const report = await runBatch(
      { agent: "claude", model: "test", effort: "high" },
      {
        runId,
        caseRunner: async (options) => {
          assert.equal(active++, 0);
          await new Promise((resolve) => setImmediate(resolve));
          active--;
          order.push(options.caseName);
          return {
            case: options.caseName,
            agent: "claude",
            model: "test",
            effort: "high",
            state: order.length === 2 ? "failed" : "passed",
            failureKind: order.length === 2 ? "task" : null,
            errors: [],
            metrics: {
              queryAttempts: 1,
              schemaAttempts: 1,
              guideAttempts: 1,
              imageAttempts: 0,
              contextualBytes: 20,
            },
            misreadings: [],
            files: { report: "/case/report.json" },
          };
        },
      },
    );
    assert.equal(order.length, 29);
    assert.equal(new Set(order).size, 29);
    assert.equal(report.state, "failed");
    assert.equal(report.failures.task, 1);
    const saved = JSON.parse(await readFile(report.files.report, "utf8"));
    assert.equal(saved.cases.length, 29);
    assert.match(
      await readFile(
        join(repo, ".scratch", "zotlit-query-evals", runId, "summary.md"),
        "utf8",
      ),
      /Context bytes/,
    );
  } finally {
    await rm(join(repo, ".scratch", "zotlit-query-evals", runId), {
      recursive: true,
      force: true,
    });
  }
});

await test("a nested Bash sandbox failure is an environment failure, with its command retained", async () => {
  const report = await exercise(null, {
    agent: "claude",
    sandboxFailure: true,
  });
  assert.equal(report.failureKind, "environment");
  assert.equal(report.misreadings.length, 1);
  assert.match(report.errors.join("\n"), /parent sandbox/);
});
await test("both agent paths reject observed evaluator reads even with correct answers", async () => {
  for (const agent of ["codex", "claude"]) {
    const report = await exercise(null, {
      agent,
      caseName: "chinese_title",
      observedEvaluatorRead: true,
    });
    assert.equal(report.failureKind, "task");
    assert.ok(report.errors.includes("agent read evaluator sources"));
  }
});

await test("shared marks can derive Library names from Indexed Keys and reject wrong names", async () => {
  const omitLibrary = (answer, envelope) => {
    envelope.request.fields = envelope.request.fields.filter(
      (field) => field !== "library",
    );
    for (const row of envelope.rows) delete row.values.library;
  };
  const valid = await exercise(null, {
    caseName: "shared_marks",
    changeAnnotation: omitLibrary,
  });
  assert.equal(valid.state, "passed", valid.errors.join("\n"));
  const wrong = await exercise(null, {
    caseName: "shared_marks",
    changeAnnotation(answer, envelope) {
      omitLibrary(answer, envelope);
      answer.annotations[1].library = "My Library";
    },
  });
  assert.equal(wrong.failureKind, "task");
  assert.match(wrong.errors.join("\n"), /wrong library/);
});

await test("Library selectors and display names identify the same Library in answers", async () => {
  const { checkAnswer } = await import("./run.mjs");
  const edge = await exercise(3);
  edge.answer.items.forEach((item) => {
    item.library = item.library === "My Library" ? "personal" : "group:118";
  });
  edge.answer.duplicateKeyGroups[0].libraries = ["personal", "group:118"];
  assert.deepEqual(checkAnswer("edge", edge.answer, {}), []);
  edge.answer.items[0].library = "group:999";
  assert.match(
    checkAnswer("edge", edge.answer, {}).join("\n"),
    /wrong Item details/,
  );
  const shared = await exercise(null, {
    caseName: "shared_marks",
    changeAnnotation(answer) {
      for (const annotation of answer.annotations)
        annotation.library =
          annotation.library === "My Library" ? "personal" : "group:118";
    },
  });
  assert.equal(shared.state, "passed", shared.errors.join("\n"));
});

await test("Collection discovery fails when an agent guesses the correct path", async () => {
  const report = await exercise(null, {
    caseName: "discover_collection",
    skipDiscovery: true,
  });
  assert.equal(report.failureKind, "task");
  assert.match(report.errors.join("\n"), /Discover the Collection path/);
});
