import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";

import { startCliWrapper } from "./cli-wrapper.mjs";
import { measureEvents } from "./events.mjs";
import { runProcess } from "./run.mjs";

for (const agent of ["codex", "claude"]) {
  await test(`${agent}: a nested shell script records real CLI calls outside the agent folder`, async () => {
    const root = resolve(".scratch", `cli-wrapper-${randomUUID()}`);
    const agentRoot = join(root, "agent");
    await mkdir(agentRoot, { recursive: true });
    const cliTool = join(root, "fake-cli.mjs");
    const callLog = join(root, "cli-calls.jsonl");
    let wrapper;
    try {
      await writeFile(
        cliTool,
        `const bytes = Buffer.from("深度学习\\n"); process.stdout.write(bytes.subarray(0, 2)); setTimeout(() => { process.stdout.write(bytes.subarray(2)); process.stderr.write("diagnostic\\n"); process.exitCode = process.argv.includes("fail") ? 7 : 0; }, 10);`,
      );
      wrapper = await startCliWrapper({
        agentRoot,
        callLog,
        vaultId: "private-vault",
        invoke: (argv, signal) =>
          runProcess(process.execPath, [cliTool, ...argv], { signal }),
      });
      await writeFile(
        join(agentRoot, "nested.sh"),
        '#!/bin/sh\nexec ./obsidian "$@"\n',
        { mode: 0o700 },
      );
      const commands = [
        ["zotlit:query", "from=items", 'filter=title == "A B"'],
        ["zotlit:query", "from=attachments", "fail"],
        ["zotlit:query", "from=annotations"],
        ["zotlit:query-schema"],
        ["zotlit:query-guide"],
        ["zotlit:annotation-image"],
      ];
      const events = [];
      for (const [index, args] of commands.entries()) {
        const result = await runProcess(
          "./nested.sh",
          ["vault=private-vault", ...args],
          { cwd: agentRoot },
        );
        assert.equal(result.code, args.includes("fail") ? 7 : 0);
        assert.equal(result.stdout, "深度学习\n");
        assert.equal(result.stderr, "diagnostic\n");
        const command = `./nested.sh vault=private-vault ${args.join(" ")}`;
        if (agent === "codex")
          events.push({
            type: "item.completed",
            item: {
              id: String(index),
              type: "command_execution",
              command,
              aggregated_output: result.stdout,
              exit_code: result.code,
            },
          });
        else
          events.push(
            {
              type: "assistant",
              message: {
                content: [
                  {
                    type: "tool_use",
                    id: String(index),
                    name: "Bash",
                    input: { command },
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
                    tool_use_id: String(index),
                    content: result.stdout,
                    is_error: result.code !== 0,
                  },
                ],
              },
            },
          );
      }
      const calls = (await readFile(callLog, "utf8"))
        .trim()
        .split("\n")
        .map(JSON.parse);
      assert.equal(calls.length, 6);
      for (const [index, call] of calls.entries()) {
        assert.deepEqual(call.argv, [
          "vault=private-vault",
          ...commands[index],
        ]);
        assert.equal(call.stdoutBytes, 13);
        assert.equal(call.exitCode, index === 1 ? 7 : 0);
        assert.ok(
          Number.isFinite(
            Temporal.Instant.from(call.timestamp).epochMilliseconds,
          ),
        );
      }
      assert.partialDeepStrictEqual(
        measureEvents(events.map(JSON.stringify).join("\n"), agent, calls),
        {
          queryAttempts: 3,
          queryExitZero: 2,
          itemQueryAttempts: 1,
          attachmentQueryAttempts: 1,
          annotationQueryAttempts: 1,
          schemaAttempts: 1,
          guideAttempts: 1,
          imageAttempts: 1,
          imageExitZero: 1,
          cliStdoutBytes: 78,
        },
      );
      await Promise.all(
        [1, 2].map(() =>
          runProcess(
            "./nested.sh",
            ["vault=private-vault", "zotlit:query-guide"],
            { cwd: agentRoot },
          ),
        ),
      );
      const concurrent = (await readFile(callLog, "utf8"))
        .trim()
        .split("\n")
        .map(JSON.parse);
      assert.equal(concurrent.length, 8);
      const denied = await runProcess(
        "./obsidian",
        ["vault=another", "zotlit:query"],
        { cwd: agentRoot },
      );
      assert.equal(denied.code, 1);
      assert.match(denied.stderr, /vault/);
    } finally {
      await wrapper?.close();
      await rm(root, { recursive: true, force: true });
    }
  });
}

await test("closing the wrapper cancels an active CLI call and retains its receipt", async () => {
  const root = resolve(".scratch", `cli-wrapper-${randomUUID()}`);
  const agentRoot = join(root, "agent");
  await mkdir(agentRoot, { recursive: true });
  const callLog = join(root, "cli-calls.jsonl");
  const started = Promise.withResolvers();
  let wrapper;
  try {
    wrapper = await startCliWrapper({
      agentRoot,
      callLog,
      vaultId: "private-vault",
      invoke: (_argv, signal) =>
        new Promise((resolve) => {
          signal.addEventListener(
            "abort",
            () =>
              resolve({
                code: null,
                stdout: "",
                stderr: "cancelled",
                aborted: true,
              }),
            { once: true },
          );
          started.resolve();
        }),
    });
    const call = runProcess(
      "./obsidian",
      ["vault=private-vault", "zotlit:query"],
      { cwd: agentRoot },
    );
    await started.promise;
    await wrapper.close();
    assert.equal((await call).code, 1);
    const receipt = JSON.parse((await readFile(callLog, "utf8")).trim());
    assert.equal(receipt.exitCode, null);
    await assert.rejects(stat(wrapper.socketPath));
  } finally {
    await wrapper?.close();
    await rm(root, { recursive: true, force: true });
  }
});
