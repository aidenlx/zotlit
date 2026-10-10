import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import test from "node:test";

import { buildFixture, getFixtureLayout } from "@zotlit/scripts/fixture";

import { validate } from "./check.mjs";

const repo = resolve(import.meta.dirname, "../../..");
const requireQuery = createRequire(
  join(repo, "packages/item-query/package.json"),
);
const requirePlugin = createRequire(join(repo, "apps/obsidian/package.json"));
const { Effect } = await import(requireQuery.resolve("effect"));
const { createClient } = await import(
  requireQuery.resolve("@zotlit/db/client/node")
);
const { attachmentAbsPath } = await import(
  requireQuery.resolve("@zotlit/db/path")
);
const { ItemQueryDatabase } = await import(
  requireQuery.resolve("@zotlit/db/item-query")
);
const {
  listQueryValues,
  collectQuery,
  ITEMS,
  ATTACHMENTS,
  ANNOTATIONS,
  AttachmentFileResolver,
} = await import(requirePlugin.resolve("@zotlit/item-query"));
const oracle = JSON.parse(
  await readFile(new URL("./oracle.json", import.meta.url), "utf8"),
);

await test("every case oracle matches a real query over the seeded Fixture", async (t) => {
  const id = randomUUID(),
    base = join(repo, ".scratch", `query-corpus-base-${id}`),
    root = join(repo, ".scratch", `query-corpus-${id}`);
  let client;
  try {
    await buildFixture(getFixtureLayout(base));
    execFileSync(process.execPath, [
      join(import.meta.dirname, "prepare.mjs"),
      base,
      root,
    ]);
    client = createClient(join(root, "zotero-data", "zotero.sqlite"), {
      connection: { readOnly: true },
    });
    const cases = [
      ...Object.entries(oracle.cases),
      ...["annotations.length", "annotations[]"].map((field) => [
        "count_per_paper",
        {
          ...oracle.cases.count_per_paper,
          group: undefined,
          count: 2,
          fields: ["title", field],
          request: {
            from: "items",
            library: "personal",
            filter:
              'collections.within("Query thesis") && annotations.length > 0',
          },
        },
        `count_per_paper from Items with ${field}`,
      ]),
    ];
    for (const [name, spec, label = name] of cases)
      await t.test(label, async () => {
        const fields = spec.fields ?? spec.request.fields.split(",");
        const libraries = [
          ...(spec.request.library === "all" ||
          spec.request.library.includes("personal")
            ? [{ libraryID: 1, groupID: null }]
            : []),
          ...(spec.request.library === "all" ||
          spec.request.library.includes("group:118")
            ? [{ libraryID: 3, groupID: 118 }]
            : []),
        ];
        let filter = spec.request.filter;
        if (spec.discovery) {
          const listing = await Effect.runPromise(
            listQueryValues(libraries[0], {
              kind: "collections",
              match: "thesis",
              limit: null,
            }).pipe(Effect.provideService(ItemQueryDatabase, { client })),
          );
          assert.ok(listing.values.includes(spec.discovery.path));
          filter = `collections.within(${JSON.stringify(listing.values.find((path) => path === spec.discovery.path))})`;
        }
        const result = await Effect.runPromise(
          collectQuery(
            {
              items: ITEMS,
              attachments: ATTACHMENTS,
              annotations: ANNOTATIONS,
            }[spec.request.from],
            {
              libraries,
              filter,
              fields,
              ...(spec.request.sort
                ? {
                    sort: spec.request.sort.split(",").map((field) => ({
                      field: field.startsWith("-") ? field.slice(1) : field,
                      direction: field.startsWith("-") ? "desc" : "asc",
                    })),
                  }
                : {}),
              ...(spec.group ? { group: spec.group } : {}),
            },
          ).pipe(
            Effect.provideService(ItemQueryDatabase, { client }),
            Effect.provideService(AttachmentFileResolver, (attachment) =>
              Effect.sync(() => {
                const path = attachmentAbsPath(attachment, {
                  dataDir: join(root, "zotero-data"),
                  baseAttachmentPath: null,
                });
                return {
                  path: path ?? null,
                  exists: path ? existsSync(path) : false,
                };
              }),
            ),
          ),
        );
        const envelope = {
          ...result,
          ok: true,
          contractVersion: 3,
          command: "zotlit:query",
          identity: {
            source: {
              databasePath: join(root, "zotero-data", "zotero.sqlite"),
            },
            vault: { path: join(root, "zt-fixture-vault") },
          },
          libraries: libraries.map((l) =>
            l.groupID
              ? { type: "group", groupID: l.groupID }
              : { type: "personal" },
          ),
          request: {
            from: spec.request.from,
            filter: spec.request.filter,
            fields,
            group: spec.group,
            limit: null,
          },
        };
        assert.deepEqual(validate(name, envelope, { runRoot: root }), []);
        assert.equal(result.returnedCount, spec.count);
      });
  } finally {
    client?.$client.close();
    await rm(base, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});
