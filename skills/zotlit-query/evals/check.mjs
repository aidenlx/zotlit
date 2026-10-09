#!/usr/bin/env node
// Check a saved ZotLit Query envelope against the committed evaluation oracle.
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const oracle = JSON.parse(
  await readFile(new URL("./oracle.json", import.meta.url), "utf8"),
);
const itemFields = {
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

function sourcePath(values) {
  return values?.attachment?.path ?? values?.["attachment.path"] ?? null;
}

function sourceExists(values) {
  return values?.attachment?.exists ?? values?.["attachment.exists"] ?? false;
}

function commonChecks(envelope, expected, { runRoot, vaultPath }) {
  const errors = [];
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
    `expected ${expected.count} returned rows`,
  );
  return { errors, need };
}

function validateAnnotations(caseName, envelope, { expected, ...context }) {
  const { errors, need } = commonChecks(envelope, expected, context);
  need(
    envelope?.libraries?.some((library) => library.type === "personal"),
    "My Library was not queried",
  );
  const rows = envelope?.rows;
  need(Array.isArray(rows), "full result rows are missing");
  if (!Array.isArray(rows)) return errors;
  need(rows.length === expected.count, `expected ${expected.count} rows`);
  need(
    JSON.stringify(rows.map((row) => row.indexedKey)) ===
      JSON.stringify(expected.keys),
    "Annotation Rows have wrong keys or reading order",
  );
  for (const row of rows) {
    need(
      row.itemIndexedKey === "RUGIER24",
      `${row.indexedKey} has wrong parent Item`,
    );
    need(
      row.attachmentIndexedKey === "RGRPDF24",
      `${row.indexedKey} has wrong parent Attachment`,
    );
  }
  if (caseName === "annotations") {
    for (const row of rows) {
      need(
        typeof row.values?.type === "string",
        `${row.indexedKey} has no type`,
      );
      need(
        typeof row.values?.pageLabel === "string",
        `${row.indexedKey} has no page label`,
      );
      need(
        sourceExists(row.values) === true &&
          sourcePath(row.values)?.endsWith("attachments/rougier-2014.pdf"),
        `${row.indexedKey} has no readable source path`,
      );
    }
  }
  if (caseName === "mixed" || caseName === "image") {
    const row = rows[0];
    need(row?.values?.type === expected.type, "wrong Annotation type");
    need(
      JSON.stringify(row?.values?.tags) === JSON.stringify(expected.tags),
      "wrong Annotation Tags",
    );
    need(
      row?.values?.hasExcerptImage === expected.hasExcerptImage,
      "wrong Excerpt Image applicability",
    );
    need(
      row?.values?.["item.title"] === expected.itemTitle,
      "wrong parent Item title",
    );
    if (caseName === "mixed")
      for (const fragment of ["type", "tags", "item.citationKey"])
        need(
          envelope?.request?.filter?.includes(fragment),
          `mixed filter does not contain ${fragment}`,
        );
  }
  if (caseName === "position") {
    const row = rows[0];
    need(
      envelope?.request?.fields?.includes("position"),
      "position was not requested",
    );
    need(row?.values?.text === expected.text, "wrong quoted text");
    need(
      JSON.stringify(row?.values?.position) ===
        JSON.stringify(expected.position),
      "wrong requested position",
    );
    need(
      sourceExists(row?.values) === true &&
        sourcePath(row?.values)?.endsWith("attachments/rougier-2014.pdf"),
      "position row has no readable source path",
    );
  }
  return errors;
}

function validateItems(caseName, envelope, { expected, ...context }) {
  const { errors, need } = commonChecks(envelope, expected, context);
  for (const field of itemFields[caseName])
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

export function validate(
  caseName,
  envelope,
  { runRoot, vaultPath = join(runRoot, "zt-fixture-vault") },
) {
  const expected = oracle.cases[caseName];
  if (!expected) throw new Error(`unknown case: ${caseName}`);
  const context = { expected, runRoot, vaultPath };
  return Object.hasOwn(itemFields, caseName)
    ? validateItems(caseName, envelope, context)
    : validateAnnotations(caseName, envelope, context);
}

async function main() {
  const [caseName, resultArg, runRootArg] = process.argv.slice(2);
  if (!caseName || !resultArg || !runRootArg)
    throw new Error(
      "usage: node check.mjs <case> <full-envelope.json> <absolute-run-root>",
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
