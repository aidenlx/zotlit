import assert from "node:assert/strict";
import test from "node:test";

import { measureEvents } from "./events.mjs";

const command = "node obsidian-cli.ts vault=test zotlit:query from=attachments";
const failure = JSON.stringify({
  ok: false,
  diagnostic: {
    code: "unknown-field",
    report: ["Unknown field pdf.", "Use contentType."],
  },
});
const success = JSON.stringify({ ok: true, warnings: [] });
const codex = (id, command, output) => ({
  type: "item.completed",
  item: {
    id,
    type: "command_execution",
    command,
    aggregated_output: output,
    exit_code: 0,
  },
});
const claude = (id, command, output) => [
  {
    type: "assistant",
    message: {
      content: [{ type: "tool_use", id, name: "Bash", input: { command } }],
    },
  },
  {
    type: "user",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: id,
          content: output,
          is_error: false,
        },
      ],
    },
  },
];
const jsonl = (events) => events.map((e) => JSON.stringify(e)).join("\n");
await test("both event formats measure outputs and recovered Diagnostic Reports", () => {
  const a = measureEvents(
    jsonl([codex("1", command, failure), codex("2", command, success)]),
    "codex",
  );
  const b = measureEvents(
    jsonl([...claude("1", command, failure), ...claude("2", command, success)]),
    "claude",
  );
  assert.deepEqual(a, b);
  assert.equal(a.attachmentQueryAttempts, 2);
  assert.equal(a.contextualBytes, Buffer.byteLength(failure + success));
  assert.equal(a.misreadings.length, 2);
  assert.deepEqual(a.misreadings[0].diagnostic.report, [
    "Unknown field pdf.",
    "Use contentType.",
  ]);
  assert.equal(a.misreadings[0].recovered, true);
  assert.equal(a.misreadings[1].retry, true);
});
await test("Claude file reads and duplicate results cannot hide evaluator access", () => {
  const events = [
    {
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "r",
            name: "Read",
            input: { file_path: "/repo/skills/zotlit-query/evals/oracle.json" },
          },
        ],
      },
    },
    {
      type: "user",
      message: {
        content: [{ type: "tool_result", tool_use_id: "r", content: "secret" }],
      },
    },
  ];
  const metrics = measureEvents(jsonl([...events, events[1]]), "claude");
  assert.equal(metrics.calls, 1);
  assert.equal(metrics.contextualBytes, 6);
  assert.equal(metrics.forbiddenReads.length, 1);
});
await test("warning and plain text failures remain visible without a later recovery", () => {
  const metrics = measureEvents(
    jsonl([
      codex(
        "w",
        command,
        JSON.stringify({
          ok: true,
          warnings: [
            {
              code: "key-outside-library",
              report: ["Choose the Target Library."],
            },
          ],
        }),
      ),
      codex("f", command, "Error: bad argument"),
    ]),
  );
  assert.equal(metrics.misreadings.length, 2);
  assert.equal(metrics.misreadings[0].recovered, false);
  assert.equal(metrics.misreadings[1].output, "Error: bad argument");
});

await test("recorded Claude Code 2.1.296 stream includes Bash and a structured answer", async () => {
  const { readFile } = await import("node:fs/promises");
  const sample = await readFile(
    new URL("./claude-sample.jsonl", import.meta.url),
    "utf8",
  );
  const metrics = measureEvents(sample, "claude");
  assert.equal(metrics.calls, 1);
  assert.equal(metrics.contextualBytes, Buffer.byteLength("sample-output"));
});

await test("a redirected response read later retains the command that produced the Diagnostic Report", () => {
  const events = [
    codex("q", `${command} > response.json`, ""),
    codex("read", "cat response.json", failure),
    codex("fix", command, success),
  ];
  const metrics = measureEvents(jsonl(events));
  assert.equal(metrics.queryAttempts, 2);
  assert.equal(metrics.misreadings[0].command, `${command} > response.json`);
  assert.equal(metrics.misreadings[0].recovered, true);
});

await test("failed file commands remain in the case report and exact retries recover", () => {
  const failed = codex("f", "jq .rows answer.json", "file missing");
  failed.item.exit_code = 1;
  const metrics = measureEvents(
    jsonl([failed, codex("r", "jq .rows answer.json", "[]")]),
  );
  assert.equal(metrics.misreadings.length, 2);
  assert.equal(metrics.misreadings[0].output, "file missing");
  assert.equal(metrics.misreadings[0].recovered, true);
});
