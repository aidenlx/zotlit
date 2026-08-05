import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";

import { runCli, type CliIo } from "./cli.js";
import { addLocale, createFixtureProject } from "./test-fixtures.js";

const packageRoot = resolve(import.meta.dirname, "..");
const cliMainPath = resolve(packageRoot, "dist", "cli-main.mjs");
const execFileAsync = promisify(execFile);

describe("runCli", () => {
  test("compiles once with project, output, and excluded-prefix options", async () => {
    const projectPath = await createFixtureProject(
      { plugin_message: "Plugin", docs_message: "Docs" },
      { prefix: "obsidian-i18n-cli-" },
    );
    const root = dirname(projectPath);
    const { io, stdout } = createIo(root);

    await runCli(
      [
        "compile",
        "--project",
        "project.inlang",
        "--output",
        "generated",
        "--exclude-prefix",
        "docs_",
      ],
      io,
    );

    expect(stdout()).toBe("Generated 1 Message wrappers\n");
    const facade = await readFile(
      join(root, "generated", "messages.ts"),
      "utf8",
    );
    expect(facade).toContain("plugin_message");
    expect(facade).not.toContain("docs_message");
  });

  test("routes target-locale prefixes into the generated wrappers", async () => {
    const projectPath = await createFixtureProject(
      { notice_pack_offer: "A pack is available.", plugin_message: "Plugin" },
      { prefix: "obsidian-i18n-cli-" },
    );
    const root = dirname(projectPath);
    const { io } = createIo(root);

    await runCli(
      [
        "compile",
        "--project",
        "project.inlang",
        "--output",
        "generated",
        "--target-locale-prefix",
        "notice_pack_",
      ],
      io,
    );

    const facade = await readFile(
      join(root, "generated", "messages.ts"),
      "utf8",
    );
    expect(facade).toContain('translateTarget("notice_pack_offer")');
    expect(facade).toContain('translate("plugin_message")');
  });

  test("rejects on an unknown option without compiling", async () => {
    const { io } = createIo(process.cwd());

    await expect(runCli(["compile", "--unknown", "value"], io)).rejects.toThrow(
      "Unknown option: --unknown",
    );
  });

  test("prints compiler reports to stderr without failing compilation", async () => {
    const projectPath = await createFixtureProject(
      { plugin_message: "Plugin", docs_message: "Docs" },
      { prefix: "obsidian-i18n-cli-" },
    );
    const root = dirname(projectPath);
    await addLocale(projectPath, "zh-CN", { docs_message: "文档" });
    const { io, stderr } = createIo(root);

    await runCli(
      ["compile", "--project", "project.inlang", "--output", "generated"],
      io,
    );

    expect(stderr()).toContain(
      "1 untranslated message(s) fall back to the base locale: plugin_message",
    );
  });
});

test("the built bin compiles once and exits 0", async () => {
  const projectPath = await createFixtureProject(
    { plugin_message: "Plugin" },
    { prefix: "obsidian-i18n-cli-main-" },
  );
  const root = dirname(projectPath);

  const { stdout } = await execFileAsync(
    process.execPath,
    [
      cliMainPath,
      "compile",
      "--project",
      "project.inlang",
      "--output",
      "generated",
    ],
    { cwd: root },
  );

  expect(stdout).toBe("Generated 1 Message wrappers\n");
});

function createIo(cwd: string): {
  io: CliIo;
  stdout: () => string;
  stderr: () => string;
} {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  return {
    io: {
      cwd,
      stdout: {
        write: (chunk: string | Uint8Array): boolean => {
          stdoutChunks.push(String(chunk));
          return true;
        },
      },
      stderr: {
        write: (chunk: string | Uint8Array): boolean => {
          stderrChunks.push(String(chunk));
          return true;
        },
      },
    },
    stdout: () => stdoutChunks.join(""),
    stderr: () => stderrChunks.join(""),
  };
}
