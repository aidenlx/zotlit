// #1705: the reviewer's 50,000-event probe, through the real NoteIndex.
// Run on an idle host: pnpm --filter @zotlit/obsidian bench src/services/note-index/obsidian-events.bench.ts
// Three warm-ups, nine measured bursts; acquisition and assertions are untimed.
import { mkdir, writeFile } from "node:fs/promises";
import { cpus } from "node:os";
import { join } from "node:path";
import { expect } from "vitest";

import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import { Effect } from "@/lib/effect";
import { it } from "@/lib/effect-vitest";

import { cache, createNoteHost, noteIndexOf } from "./__fixtures__";

it.live("measures metadata event dispatch (#1705)", () =>
  Effect.gen(function* () {
    const host = createNoteHost(
      { "paper.md": cache({ itemKey: "ABCD2345" }), "paper.txt": cache({}) },
      { enabledAtRuntime: true },
    );
    const index = yield* noteIndexOf(host.app);
    const file = host.vault.files.get("paper.md")!;
    const txt = host.vault.files.get("paper.txt")!;
    const a = cache({ itemKey: "ABCD2345" });
    const b = cache({ itemKey: "ZZZ99999" });
    const cases: { type: string; medianMs: number; samples: number[] }[] = [];
    for (const type of ["changed", "unchanged", "ignored"]) {
      const samples: number[] = [];
      for (let run = -3; run < 9; run++) {
        const start = performance.now();
        for (let i = 0; i < 50_000; i++)
          host.metadataCache.change(
            type === "ignored" ? txt : file,
            type === "changed" && i % 2 ? b : a,
          );
        yield* index.whenSettled();
        if (run >= 0) samples.push(performance.now() - start);
        expect(yield* index.getIndexedItemKeys()).toEqual([
          type === "changed" ? "ZZZ99999" : "ABCD2345",
        ]);
      }
      cases.push({
        type,
        medianMs: samples.toSorted((a, b) => a - b)[4]!,
        samples,
      });
    }
    yield* Effect.promise(async () => {
      const root = await getWorkspaceRoot(import.meta.dirname);
      const output = join(root, ".scratch/note-index-events-bench");
      await mkdir(output, { recursive: true });
      await writeFile(
        join(output, "results.json"),
        JSON.stringify(
          {
            host: { cpu: cpus()[0]?.model, node: process.version },
            events: 50_000,
            warmups: 3,
            runs: 9,
            cases,
          },
          null,
          2,
        ),
      );
    });
    // oxlint-disable-next-line effecttsgo/global-console -- report the benchmark's measured medians.
    console.table(cases.map(({ type, medianMs }) => ({ type, medianMs })));
  }).pipe(Effect.scoped),
);
