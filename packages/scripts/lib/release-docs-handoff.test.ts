import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { runReleaseWithDocsHandoff } from "./release-docs-handoff.ts";
import type { ReleaseDocsHandoffAdapter } from "./release-docs-handoff.ts";

import { getWorkspaceRoot } from "#package-roots";

class ControlledHandoff implements ReleaseDocsHandoffAdapter {
  readonly prompts: { message: string; initialValue: boolean }[] = [];
  readonly commands: string[] = [];

  constructor(readonly answer: boolean) {}

  confirm(prompt: { message: string; initialValue: boolean }): boolean {
    this.prompts.push(prompt);
    return this.answer;
  }

  handoff(command: string): void {
    this.commands.push(command);
  }
}

describe("release docs-availability handoff", () => {
  it.each(["2.1.0", "2.1.1"])(
    "hands stable Obsidian %s to the separate scanner",
    async (version) => {
      const adapter = new ControlledHandoff(true);

      await runReleaseWithDocsHandoff({
        targets: [{ app: "obsidian", version }],
        adapter,
        continueRelease: () => {
          throw new Error("release continuation must not run");
        },
      });

      expect(adapter.prompts).toEqual([
        {
          message:
            "Scan documentation availability before this stable release?",
          initialValue: true,
        },
      ]);
      expect(adapter.commands).toEqual([`pnpm docs:availability ${version}`]);
    },
  );

  it("continues a stable release when the maintainer declines the scan", async () => {
    const adapter = new ControlledHandoff(false);

    let continued = false;
    await runReleaseWithDocsHandoff({
      targets: [{ app: "obsidian", version: "2.1.0" }],
      adapter,
      continueRelease: () => {
        continued = true;
      },
    });

    expect(continued).toBe(true);
    expect(adapter.commands).toEqual([]);
  });

  it.each([
    { targets: [{ app: "obsidian" as const, version: "2.1.0-beta.2" }] },
    { targets: [{ app: "zotero" as const, version: "2.1.0" }] },
  ])(
    "continues without a prompt for unrelated targets",
    async ({ targets }) => {
      const adapter = new ControlledHandoff(true);

      let continued = false;
      await runReleaseWithDocsHandoff({
        targets,
        adapter,
        continueRelease: () => {
          continued = true;
        },
      });

      expect(continued).toBe(true);
      expect(adapter.prompts).toEqual([]);
      expect(adapter.commands).toEqual([]);
    },
  );

  it("leaves release files unchanged after a positive handoff", async () => {
    await using cleanup = new AsyncDisposableStack();
    const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);
    const scratch = join(workspaceRoot, "tmp");
    await mkdir(scratch, { recursive: true });
    const root = await mkdtemp(join(scratch, "release-handoff-test-"));
    cleanup.defer(() => rm(root, { recursive: true, force: true }));
    const packageJsonPath = join(root, "package.json");
    const original = '{"version":"2.0.0"}\n';
    await writeFile(packageJsonPath, original);

    await runReleaseWithDocsHandoff({
      targets: [{ app: "obsidian", version: "2.1.0" }],
      adapter: new ControlledHandoff(true),
      continueRelease: () =>
        writeFile(packageJsonPath, '{"version":"2.1.0"}\n'),
    });

    expect(await readFile(packageJsonPath, "utf-8")).toBe(original);
  });
});
