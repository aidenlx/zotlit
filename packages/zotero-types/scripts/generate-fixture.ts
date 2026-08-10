// Merges Zotero's pinned native-item and CSL-JSON corpora into one fixture.
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

// oxlint-disable-next-line no-restricted-imports
import schema from "../zotero-schema/schema.json" with { type: "json" };

/** Zotero release the native items and the expected CSL-JSON come from. */
const ZOTERO_VERSION = "9.0.3";

/** Zotero application commit that owns the native `allTypesAndFields` corpus. */
const APPLICATION_COMMIT = "451d96a8240bbb607a220f949673d6bc704bb58d";

/** Zotero utilities commit that owns `itemToCSLJSON()` and its golden output. */
const UTILITIES_COMMIT = "1dd38e27edf81e9d9c4161c957b7efb7f5681ac3";

/** Schema version the pinned corpus and `zotero-schema/` must agree on. */
const SCHEMA_VERSION = 42;

/** Calendar day of the last reviewed fixture upgrade. */
const MODIFIED = "2026-08-04";

/** Zotero child item types, which carry no reference metadata of their own. */
const CHILD_ITEM_TYPES: ReadonlySet<string> = new Set([
  "note",
  "attachment",
  "annotation",
]);

interface PinnedSource {
  /** Immutable commit URL, so a re-run reads the same bytes. */
  readonly url: string;
  /** SHA-256 of the downloaded bytes, verified before parsing. */
  readonly sha256: string;
  /** Upstream commit the URL pins. */
  readonly commit: string;
}

const SOURCES = {
  item: {
    url: `https://raw.githubusercontent.com/zotero/zotero/${APPLICATION_COMMIT}/test/tests/data/allTypesAndFields.js`,
    sha256: "e8c27ab62cf912b77b12abe7ea0457cfd3964c44dae38fb9e19c563f2ca53550",
    commit: APPLICATION_COMMIT,
  },
  csl: {
    url: `https://raw.githubusercontent.com/zotero/utilities/${UTILITIES_COMMIT}/test/data/citeProcJSExport.json`,
    sha256: "d34d157b074531816cde5382168e4d27d9ea2bf4b12a70f8355c4c75eb6fc1b3",
    commit: UTILITIES_COMMIT,
  },
} satisfies Readonly<Record<string, PinnedSource>>;

type UpstreamCorpus = Readonly<
  Record<string, Readonly<Record<string, unknown>>>
>;

const packageRoot = resolve(import.meta.dirname, "..");
const outputDir = join(packageRoot, "fixtures");
const outputFile = join(outputDir, "item-to-csl.json");

if (schema.version !== SCHEMA_VERSION) {
  throw new Error(
    `Pinned schema version ${SCHEMA_VERSION} does not match zotero-schema/schema.json version ${schema.version}. ` +
      "Upgrade the fixture and its pins in one reviewed change.",
  );
}

const [items, csl] = await Promise.all([
  fetchPinned(SOURCES.item),
  fetchPinned(SOURCES.csl),
]);

const cases = mergeCases(items, csl);

await mkdir(outputDir, { recursive: true });
await writeFile(
  outputFile,
  `${JSON.stringify(
    {
      zoteroVersion: ZOTERO_VERSION,
      schemaVersion: SCHEMA_VERSION,
      modified: MODIFIED,
      sources: SOURCES,
      cases,
    },
    null,
    2,
  )}\n`,
);

/** Download one pinned source and parse it once its digest matches. */
async function fetchPinned(source: PinnedSource): Promise<UpstreamCorpus> {
  const response = await fetch(source.url);
  if (!response.ok) {
    throw new Error(
      `Download of ${source.url} failed: ${response.status} ${response.statusText}`,
    );
  }
  const body = Buffer.from(await response.arrayBuffer());
  const digest = createHash("sha256").update(body).digest("hex");
  if (digest !== source.sha256) {
    throw new Error(
      `Digest mismatch for ${source.url}: pinned ${source.sha256}, downloaded ${digest}.`,
    );
  }
  return JSON.parse(body.toString("utf8")) as UpstreamCorpus;
}

/**
 * Pair each native item with its Zotero CSL-JSON counterpart, both kept in
 * their upstream shape. Every case key is one Zotero item type.
 */
function mergeCases(
  items: UpstreamCorpus,
  csl: UpstreamCorpus,
): Record<string, { item: unknown; csl: unknown }> {
  const itemKeys = Object.keys(items);
  const cslKeys = Object.keys(csl);

  assertSameSet(
    { label: "native corpus", keys: itemKeys },
    { label: "CSL corpus", keys: cslKeys },
  );
  assertSameSet(
    { label: "fixture", keys: itemKeys },
    {
      label: `schema ${SCHEMA_VERSION} regular item types`,
      keys: schema.itemTypes
        .map(({ itemType }) => itemType)
        .filter((itemType) => !CHILD_ITEM_TYPES.has(itemType)),
    },
  );

  const cases: Record<string, { item: unknown; csl: unknown }> = {};
  for (const key of [...itemKeys].sort()) {
    const item = items[key]!;
    if (item.itemType !== key) {
      throw new Error(
        `Native case "${key}" declares itemType ${JSON.stringify(item.itemType)}.`,
      );
    }
    cases[key] = { item, csl: csl[key]! };
  }
  return cases;
}

interface LabelledKeys {
  readonly label: string;
  readonly keys: readonly string[];
}

function assertSameSet(left: LabelledKeys, right: LabelledKeys): void {
  const leftSet = new Set(left.keys);
  const rightSet = new Set(right.keys);
  const absentFromLeft = right.keys.filter((key) => !leftSet.has(key));
  const absentFromRight = left.keys.filter((key) => !rightSet.has(key));
  if (absentFromLeft.length === 0 && absentFromRight.length === 0) return;
  throw new Error(
    `The ${left.label} and the ${right.label} disagree. ` +
      `Absent from the ${left.label}: [${absentFromLeft.join(", ")}]. ` +
      `Absent from the ${right.label}: [${absentFromRight.join(", ")}].`,
  );
}
