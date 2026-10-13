// Shared envelope and row checks; each case family adds its own evidence checks.
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { librarySelector } from "./libraries.mjs";

// Normalize row placement; each case checks completeness and limits separately.
export function resultRows(envelope) {
  if (Array.isArray(envelope?.rows)) return envelope.rows;
  if (Array.isArray(envelope?.groups))
    return envelope.groups.flatMap((group) => group.rows ?? []);
  return undefined;
}

export function commonChecks(envelope, expected, { runRoot, vaultPath }) {
  const errors = [];
  const need = (test, message) => {
    if (!test) errors.push(message);
  };
  need(envelope?.ok === true, "query response is not successful");
  need(
    envelope?.contractVersion === 3 && envelope?.command === "zotlit:query",
    "wrong Query contract",
  );
  need(envelope?.request?.from === expected.from, "wrong Query Dataset");
  need(Array.isArray(envelope?.warnings), "Query Warnings are missing");
  need(
    envelope?.identity?.source?.databasePath ===
      join(runRoot, "zotero-data", "zotero.sqlite"),
    "wrong source database",
  );
  need(envelope?.identity?.vault?.path === vaultPath, "wrong evaluation vault");
  if (expected.groups) {
    const returned = (envelope.groups ?? []).reduce(
      (count, group) => count + (group.rows?.length ?? 0),
      0,
    );
    need(envelope.returnedCount === returned, "wrong returnedCount");
    // Element groups overlap, so truncation is a cut group, not fewer rows
    // than records.
    need(
      envelope.truncated ===
        (envelope.groups ?? []).some(
          (group) => (group.rows?.length ?? 0) < group.count,
        ),
      "wrong grouped truncation",
    );
    const limit = envelope.request?.limit;
    need(
      limit === null || (Number.isInteger(limit) && limit > 0),
      "invalid group limit",
    );
  } else {
    need(envelope?.request?.limit === null, "limit must be all");
    need(envelope?.truncated === false, "result is truncated");
    need(
      envelope?.returnedCount === expected.count,
      `expected ${expected.count} returned rows`,
    );
  }
  return { errors, need };
}

export function checkRows(actual, expected) {
  const errors = [];
  if (!Array.isArray(actual)) return ["rows are missing"];
  const rows = new Map(actual.map((r) => [r.indexedKey, r]));
  if (rows.size !== actual.length || actual.length !== expected.length)
    errors.push("wrong rows or duplicate identities");
  for (const row of expected) {
    const found = rows.get(row.indexedKey);
    if (!found) {
      errors.push(`missing ${row.indexedKey}`);
      continue;
    }
    for (const [field, value] of Object.entries(row.values))
      if (
        !isDeepStrictEqual(
          field === "library"
            ? librarySelector(found.values?.[field])
            : found.values?.[field],
          value,
        )
      )
        errors.push(`wrong ${field} for ${row.indexedKey}`);
  }
  return errors;
}
