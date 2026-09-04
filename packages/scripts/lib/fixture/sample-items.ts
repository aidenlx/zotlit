// Reproducible Sample Item generation from the committed Fixture selection.

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createClient } from "@zotlit/db/client/node";
import { exportItemSnapshot } from "@zotlit/workbench/snapshot";
import type {
  SnapshotLibrarySelector,
  SnapshotVaultTargets,
} from "@zotlit/workbench/snapshot";

import { buildFixture } from "./build.ts";
import { getFixtureLayout } from "./layout.ts";

export interface GenerateSampleItemsOptions {
  readonly databasePath: string;
  readonly manifestPath: string;
  readonly outputDir: string;
}

export interface GeneratedSampleItem {
  readonly id: string;
  readonly path: string;
}

interface SampleSelection {
  readonly id: string;
  readonly label: string;
  readonly source: string;
  readonly library: SnapshotLibrarySelector;
  readonly key: string;
  readonly vaultTargets?: SnapshotVaultTargets;
}

export async function generateSampleItems(
  options: GenerateSampleItemsOptions,
): Promise<GeneratedSampleItem[]> {
  const selections = JSON.parse(
    await readFile(options.manifestPath, "utf8"),
  ) as SampleSelection[];
  await mkdir(options.outputDir, { recursive: true });

  using resources = new DisposableStack();
  const client = resources.adopt(
    createClient(options.databasePath, {
      connection: { readOnly: true },
    }),
    (value) => value.$client.close(),
  );

  const generated: GeneratedSampleItem[] = [];
  for (const selection of selections) {
    const snapshot = exportItemSnapshot(
      client,
      { library: selection.library, key: selection.key },
      {
        provenance: {
          kind: "sample",
          id: selection.id,
          source: selection.source,
        },
        vaultTargets: selection.vaultTargets,
      },
    );
    const path = join(options.outputDir, `${selection.id}.json`);
    await writeFile(path, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    generated.push({ id: selection.id, path });
  }
  return generated;
}

export async function regenerateFixtureSampleItems(
  workspaceRoot: string,
): Promise<GeneratedSampleItem[]> {
  const scratch = join(workspaceRoot, "tmp");
  await mkdir(scratch, { recursive: true });
  const fixtureRoot = await mkdtemp(join(scratch, "sample-items-"));
  await using resources = new AsyncDisposableStack();
  resources.defer(() => rm(fixtureRoot, { recursive: true, force: true }));

  const layout = getFixtureLayout(fixtureRoot);
  await buildFixture(layout);
  const sampleDir = join(workspaceRoot, "packages/workbench/src/samples");
  return await generateSampleItems({
    databasePath: layout.databasePath,
    manifestPath: join(sampleDir, "selection.json"),
    outputDir: sampleDir,
  });
}
