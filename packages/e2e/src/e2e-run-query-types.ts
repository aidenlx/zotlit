import { expect } from "vitest";

import type { LIBRARIES } from "@zotlit/scripts/fixture";
import { ITEMS } from "@zotlit/scripts/fixture";

function itemsByModified(
  libraries: readonly (typeof LIBRARIES)[number][],
): string[] {
  return libraries
    .flatMap((library) =>
      ITEMS.filter((item) => item.libraryID === library.libraryID).map(
        (item) => ({
          dateModified: item.dateModified,
          indexedKey:
            library.groupID === null
              ? item.key
              : `${item.key}g${library.groupID}`,
        }),
      ),
    )
    .toSorted(
      (a, b) =>
        b.dateModified.localeCompare(a.dateModified) ||
        (a.indexedKey < b.indexedKey
          ? -1
          : a.indexedKey > b.indexedKey
            ? 1
            : 0),
    )
    .map((item) => item.indexedKey);
}

function byItem(rows: NonNullable<ItemQueryReport["rows"]>): {
  cards: string[];
  headings: string[];
} {
  const groups = Map.groupBy(rows, (row) => row.itemIndexedKey);
  const title = (key: string | undefined) =>
    String(groups.get(key)![0]!.values["item.title"]);
  const order = [...groups.keys()].toSorted(
    (a, b) =>
      title(a).localeCompare(title(b), "en") ||
      String(a).localeCompare(String(b), "en"),
  );
  return {
    cards: order.flatMap((key) =>
      groups.get(key)!.map((row) => row.indexedKey),
    ),
    headings: order.map(title),
  };
}

interface ItemQueryReport {
  contractVersion: number;
  command: string;
  ok: boolean;
  identity?: { source: { id: string | null; databasePath: string } };
  libraries?: (
    | { type: "personal" }
    | { type: "group"; groupID: number; name: string }
  )[];
  request?: {
    from: "items" | "attachments" | "annotations";
    library: string[];
    fields: string[];
    limit: number | null;
  };
  returnedCount?: number;
  totalCount?: number;
  groups?: {
    value: string | number | boolean | null;
    count: number;
    rows: { indexedKey: string; values: Record<string, unknown> }[];
  }[];
  truncated?: boolean;
  rows?: {
    indexedKey: string;
    itemIndexedKey?: string;
    values: Record<string, unknown>;
  }[];
  diagnostic?: ItemQueryDiagnostic;
  warnings?: ItemQueryDiagnostic[];
}

/** Asserts one `zotlit:query` diagnostic of a syntax or name probe. */
function expectQueryDiagnostic(
  diagnostic: ItemQueryDiagnostic | undefined,
  probe: {
    code: string;
    severity: ItemQueryDiagnostic["severity"];
    at: string;
    suggestion: string;
  },
): void {
  expect(diagnostic).toMatchObject({
    code: probe.code,
    severity: probe.severity,
    excerpt: { at: probe.at },
  });
  expect(diagnostic!.suggestions[0]).toBe(probe.suggestion);
  expect(diagnostic!.message).not.toBe("");
  expect(diagnostic!.hint).not.toBe("");
  expect(diagnostic!.report[0]).toBe(diagnostic!.message);
  expect(diagnostic!.report.at(-1)).toBe(diagnostic!.hint);
}

interface ItemQueryDiagnostic {
  code: string;
  message: string;
  hint: string;
  report: string[];
  suggestions: string[];
  severity: "error" | "warning";
  excerpt?: { before: string; at: string; after: string };
  location?: { argument: string; span?: { from: number; to: number } };
}

/** The `zotlit:query-schema` reply shape this suite reads (see
 *  apps/obsidian/src/services/item-query/contract.ts and answer.ts). */
interface ItemQuerySchemaReport {
  contractVersion: number;
  command: string;
  ok: boolean;
  schema?: { url: string; fileName: string };
  customFields?: { name: string; path: string; bareName: boolean }[];
  defaults?: object;
}

/** The `zotlit:library-scope` reply shape this suite reads (see
 *  apps/obsidian/src/services/library-scope/cli.ts). */
interface LibraryScopeReport {
  contractVersion: number;
  ok: boolean;
  mode?: "all" | "selected";
  invalid?: boolean;
  available?: { selector: unknown; libraryID: number; name: string | null }[];
  unavailable?: unknown[];
}

export { itemsByModified, byItem, expectQueryDiagnostic };
export type {
  ItemQueryReport,
  ItemQueryDiagnostic,
  ItemQuerySchemaReport,
  LibraryScopeReport,
};
