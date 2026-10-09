#!/usr/bin/env node
// Check a saved Item Query envelope against the committed evaluation oracle.
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const oracle = JSON.parse(
  await readFile(new URL("./oracle.json", import.meta.url), "utf8"),
);
const fields = {
  include: ["title", "date.year", "creators"],
  export: [
    "title",
    "date.year",
    "creators",
    'custom["review.status"]',
    "abstractNote",
  ],
  edge: ["title", "date.year", "creators"],
};

export function validate(
  caseName,
  envelope,
  { runRoot, vaultPath = join(runRoot, "zt-fixture-vault") },
) {
  const errors = [];
  const expected = oracle.cases[caseName];
  if (!expected) throw new Error(`unknown case: ${caseName}`);
  const need = (test, message) => {
    if (!test) errors.push(message);
  };
  need(envelope?.ok === true, "query response is not successful");
  need(
    envelope?.identity?.source?.databasePath ===
      join(runRoot, "zotero-data", "zotero.sqlite"),
    "wrong source database",
  );
  need(envelope?.identity?.vault?.path === vaultPath, "wrong evaluation vault");
  need(envelope?.request?.limit === null, "limit must be all");
  need(envelope?.truncated === false, "result is truncated");
  need(
    envelope?.returnedCount === expected.count,
    `expected ${expected.count} returned Items`,
  );
  for (const field of fields[caseName])
    need(
      envelope?.request?.fields?.includes(field),
      `missing projected field ${field}`,
    );
  need(
    envelope?.libraries?.some((library) => library.type === "personal"),
    "My Library was not queried",
  );
  need(
    envelope?.libraries?.some((library) => library.groupID === 118),
    "Lab Archive was not queried",
  );
  const rows = envelope?.rows;
  need(Array.isArray(rows), "full result rows are missing");
  if (!Array.isArray(rows)) return errors;
  need(rows.length === expected.count, `expected ${expected.count} rows`);
  const byKey = new Map();
  for (const row of rows) {
    if (byKey.has(row.indexedKey))
      errors.push(`duplicate Indexed Key ${row.indexedKey}`);
    byKey.set(row.indexedKey, row);
  }
  const expectedKeys = new Set(expected.rows.map((row) => row.indexedKey));
  for (const key of byKey.keys())
    need(expectedKeys.has(key), `unexpected Indexed Key ${key}`);
  let missingYear = 0;
  for (const item of expected.rows) {
    const row = byKey.get(item.indexedKey);
    if (!row) {
      errors.push(`missing Indexed Key ${item.indexedKey}`);
      continue;
    }
    const values = row.values ?? {};
    need(values.title === item.title, `wrong title for ${item.indexedKey}`);
    need(
      values["date.year"] === item.year,
      `wrong publication year for ${item.indexedKey}`,
    );
    if (values["date.year"] === null) missingYear++;
    const creators = values.creators;
    need(Array.isArray(creators), `missing creators for ${item.indexedKey}`);
    if (Array.isArray(creators)) {
      need(
        creators[0]?.fullName === item.firstCreator,
        `wrong first creator for ${item.indexedKey}`,
      );
      const firstAuthor =
        creators.find((creator) => creator.role === "author")?.fullName ?? null;
      need(
        firstAuthor === item.firstAuthor,
        `wrong first author for ${item.indexedKey}`,
      );
    }
    if (caseName === "export")
      need(
        values['custom["review.status"]'] === item.status,
        `wrong review status for ${item.indexedKey}`,
      );
    if (caseName === "export")
      need(
        typeof values.abstractNote === "string" &&
          Buffer.byteLength(values.abstractNote) > 10 * 1024,
        `missing long abstract for ${item.indexedKey}`,
      );
  }
  if (expected.missingYear !== undefined)
    need(
      missingYear === expected.missingYear,
      `expected ${expected.missingYear} missing publication years`,
    );
  return errors;
}

async function main() {
  const [caseName, resultArg, runRootArg] = process.argv.slice(2);
  if (!caseName || !resultArg || !runRootArg)
    throw new Error(
      "usage: node check.mjs <include|export|edge> <full-envelope.json> <absolute-run-root>",
    );
  const runRoot = resolve(runRootArg);
  const envelope = JSON.parse(await readFile(resultArg, "utf8"));
  const errors = validate(caseName, envelope, { runRoot });
  console.log(
    JSON.stringify(
      { case: caseName, pass: errors.length === 0, errors },
      null,
      2,
    ),
  );
  if (errors.length) process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 2;
  });
}
