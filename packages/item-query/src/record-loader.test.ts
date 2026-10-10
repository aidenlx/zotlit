// The load plan of each pass: what a request reads from the source once, and
// what each pass loads for a chunk of scan rows. Each test opens the Record Loader
// of a planned request on the scenario database and observes the statements
// through `Run.events`.
import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";

import { HYDRATE_CHUNK_SIZE, readScanPage } from "@zotlit/db/item-query";
import {
  openScenarioDatabase,
  SCENARIO_LIBRARIES,
} from "@zotlit/db/test-scenario";
import type { ScenarioDatabase } from "@zotlit/db/test-scenario";

import { ItemQueryError } from "./error";
import { ITEM_LOADING } from "./hydration";
import { ITEMS } from "./query-items";
import { openQuerySources } from "./query-sources";
import { openRecordLoader } from "./record-loader";
import { planRequest } from "./request";
import type { ItemQueryRequest, TargetLibrary } from "./request";
import { runEffect } from "./test-helpers";
import type { RunEvent } from "./test-helpers";

const { personal, group } = SCENARIO_LIBRARIES;

/** The custom fields of the scenario source, in field ID order. */
const CUSTOM_FIELDS = ["review.status", "mood", "title", "publicationTitle"];

type Request = Omit<ItemQueryRequest, "libraries"> &
  Partial<Pick<ItemQueryRequest, "libraries">>;

/**
 * Open the Record Loader of a request and load the first scan page of the
 * personal Library through both passes.
 */
async function open(scenario: ScenarioDatabase, request: Request) {
  const { libraries = [personal], ...rest } = request;
  let seen = 0;
  const { exit, events } = await runEffect(
    Effect.gen(function* () {
      const plan = yield* planRequest(ITEMS, {
        fields: [],
        sort: [],
        ...rest,
        libraries,
      });
      const sources = yield* openQuerySources;
      const hydration = yield* openRecordLoader(ITEM_LOADING, plan, {
        libraries,
        sources,
      });
      const opened = seen;
      const page = yield* readScanPage({
        libraryID: personal.libraryID,
        afterKey: null,
        size: HYDRATE_CHUNK_SIZE,
      });
      const scanned = yield* hydration.scan.load(page, () => personal);
      const projected = yield* hydration.projection.load(page, () => personal);
      return { hydration, sources, opened, scanned, projected };
    }),
    {
      client: scenario.db,
      onEvent: () => {
        seen++;
      },
    },
  );
  if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause));
  const { opened, ...value } = exit.value;
  return {
    ...value,
    /** The statements that opening the Record Loader ran. */
    opening: readersOf(events.slice(0, opened)),
    /** The hydrate statements of both passes, in order. */
    hydrates: events
      .slice(opened)
      .flatMap((event) =>
        event.type === "statement" && event.statement.reader === "hydrate-chunk"
          ? [event.statement]
          : [],
      ),
  };
}

/** The readers of the statements, without the layout check of the copy. */
function readersOf(events: readonly RunEvent[]): string[] {
  return events.flatMap((event) =>
    event.type === "statement" && event.statement.reader !== "layout"
      ? [event.statement.reader]
      : [],
  );
}

/** The typed failure of opening the Record Loader of a request. */
async function failure(scenario: ScenarioDatabase, request: Request) {
  const { exit } = await runEffect(
    Effect.gen(function* () {
      const plan = yield* planRequest(ITEMS, {
        ...request,
        libraries: [personal],
      });
      return yield* openRecordLoader(ITEM_LOADING, plan, {
        libraries: [personal],
        sources: yield* openQuerySources,
      });
    }),
    { client: scenario.db },
  );
  if (!Exit.isFailure(exit)) throw new Error("the Record Loader opened.");
  const error = Cause.findErrorOption(exit.cause);
  if (error._tag === "None") throw new Error(String(exit.cause));
  return error.value;
}

describe("Record Loader", () => {
  it("reads no source and loads nothing for a filter on the scan row", async () => {
    using scenario = openScenarioDatabase();
    const { hydration, opening, hydrates, scanned } = await open(scenario, {
      filter: 'itemType == "book" && key != "ART2FULL"',
    });

    expect(hydration.scan.hydrates).toBe(false);
    expect(hydration.projection.hydrates).toBe(false);
    expect(opening).toEqual([]);
    expect(hydrates).toEqual([]);
    const report = scanned.find((item) => item.scan.key === "RPT2NDTE")!;
    expect(report.hydrated).toEqual({ fields: new Map(), custom: new Map() });
    expect(report.customFieldNames).toEqual([]);
  });

  it("loads only the relation the filter reads", async () => {
    using scenario = openScenarioDatabase();
    const { hydration, hydrates, scanned } = await open(scenario, {
      filter: 'tags.contains("to-read")',
    });

    expect(hydration.scan.hydrates).toBe(true);
    expect(hydration.projection.hydrates).toBe(false);
    // One statement: the Tags of the chunk.
    expect(hydrates).toHaveLength(1);
    const article = scanned.find((item) => item.scan.key === "ART2FULL")!;
    expect(article.hydrated.tags?.map((tag) => tag.name)).toContain("to-read");
    expect(article.hydrated.creators).toBeUndefined();
  });

  it("loads only the fields the filter reads, with the aliases of a base field", async () => {
    using scenario = openScenarioDatabase();
    const { hydration, hydrates, scanned } = await open(scenario, {
      filter: 'publisher == "Sage" && custom["review.status"] == null',
    });

    expect(hydration.scan.hydrates).toBe(true);
    expect(hydrates).toHaveLength(1);
    // The report stores `institution`, an alias of `publisher`.
    const report = scanned.find((item) => item.scan.key === "RPT2NDTE")!;
    expect([...report.hydrated.fields]).toEqual([
      ["publisher", "Lab Institute"],
    ]);
    const article = scanned.find((item) => item.scan.key === "ART2FULL")!;
    expect([...article.hydrated.custom]).toEqual([["review.status", "done"]]);
  });

  it("loads the fields of a branch that does not run for an Item", async () => {
    using scenario = openScenarioDatabase();
    const { hydration, hydrates, scanned } = await open(scenario, {
      filter: 'itemType == "report" && creators.isEmpty()',
    });

    expect(hydration.scan.hydrates).toBe(true);
    expect(hydrates).toHaveLength(1);
    const report = scanned.find((item) => item.scan.key === "RPT2NDTE")!;
    expect(report.hydrated.creators).toEqual([]);
  });

  it("loads the filter and sort fields in the scan pass and the projection fields in the projection pass", async () => {
    using scenario = openScenarioDatabase();
    const { hydration, hydrates, scanned, projected } = await open(scenario, {
      filter: 'tags.contains("to-read")',
      fields: ["DOI", "custom"],
      sort: [{ field: "title", direction: "asc" }],
    });

    expect(hydration.scan.hydrates).toBe(true);
    expect(hydration.projection.hydrates).toBe(true);
    // The scan pass: the field values, then the Tags. The projection pass: the
    // field values.
    expect(hydrates).toHaveLength(3);
    const scannedArticle = scanned.find(
      (item) => item.scan.key === "ART2FULL",
    )!;
    expect([...scannedArticle.hydrated.fields.keys()]).toEqual(["title"]);
    expect(scannedArticle.hydrated.tags?.map((tag) => tag.name)).toContain(
      "to-read",
    );
    const article = projected.find((item) => item.scan.key === "ART2FULL")!;
    expect(article.hydrated.custom.get("mood")).toBe("calm");
    expect(article.hydrated.fields.has("title")).toBe(false);
    expect(article.customFieldNames).toEqual(CUSTOM_FIELDS);
  });

  it("reads the field vocabulary once and the Collection paths of each Target Library for a pass that loads Collections", async () => {
    using scenario = openScenarioDatabase();
    const { hydration, opening, projected } = await open(scenario, {
      libraries: [personal, group],
      fields: ["collections"],
    });

    expect(hydration.scan.hydrates).toBe(false);
    expect(hydration.projection.hydrates).toBe(true);
    // One read of the field vocabulary runs two statements.
    expect(opening).toEqual([
      "field-vocabulary",
      "field-vocabulary",
      "collection-paths",
      "collection-paths",
    ]);
    const article = projected.find((item) => item.scan.key === "ART2FULL")!;
    expect(article.hydrated.collections).toEqual([["Thesis", "Methods"]]);
  });

  it("reads no Collection paths for a request that loads no Collections", async () => {
    using scenario = openScenarioDatabase();
    const { opening } = await open(scenario, {
      libraries: [personal, group],
      fields: ["title", "tags"],
    });

    expect(opening).toEqual(["field-vocabulary", "field-vocabulary"]);
  });

  it("gives each lowering the Collection paths of its own Library", async () => {
    using scenario = openScenarioDatabase();
    const { sources } = await open(scenario, {
      libraries: [personal, group],
      filter: 'collections.contains("Thesis/Methods")',
    });

    const pathsOf = (library: TargetLibrary) => [
      ...(sources.candidateContext(library).collectionPaths?.values() ?? []),
    ];
    expect(pathsOf(personal)).toContainEqual(["Thesis", "Methods"]);
    expect(pathsOf(group)).not.toContainEqual(["Thesis", "Methods"]);
    expect(sources.candidateContext(personal).vocabulary).not.toBeNull();
  });

  it.each([
    {
      request: { filter: 'custom["nope"] == 1' },
      location: { argument: "filter", span: { from: 0, to: 14 } },
      fault: {
        kind: "unknown",
        role: "custom-field",
        name: "nope",
        customFields: CUSTOM_FIELDS,
      },
    },
    {
      request: { filter: "nope == 1" },
      location: { argument: "filter", span: { from: 0, to: 4 } },
      fault: {
        kind: "unknown",
        role: "field",
        name: "nope",
        at: { from: 0, to: 4 },
      },
    },
    {
      request: { fields: ["title", 'custom["nope"]'] },
      location: { argument: "fields", index: 1 },
      fault: {
        kind: "unknown",
        role: "custom-field",
        name: "nope",
        customFields: CUSTOM_FIELDS,
      },
    },
  ])(
    "fails a custom field that the source does not define in $location.argument",
    async ({ request, location, fault }) => {
      using scenario = openScenarioDatabase();
      expect(await failure(scenario, request)).toMatchObject({
        code: "unknown-field",
        location,
        fault,
      });
    },
  );
});

// Failure modes: dotted names must be resolved as a whole against the source,
// known full names must fail with bracket access, and missing chains retain the
// original property fault instead of reporting the intermediate custom name.
it.each(["review.status", "custom.review.status"])(
  "corrects a source custom field written as %s",
  async (access) => {
    using scenario = openScenarioDatabase();
    const filter = `${access} == "include"`;
    const error = await failure(scenario, { filter });
    expect(error).toBeInstanceOf(ItemQueryError);
    if (!(error instanceof ItemQueryError))
      throw new Error("Expected query fault");
    expect(error.fault).toMatchObject({
      kind: "unknown",
      role: "custom-field",
      name: "review.status",
      at: { from: 0, to: access.length },
      customFields: CUSTOM_FIELDS,
      dotted: true,
    });
    const diagnostic = error.diagnostic;
    expect(diagnostic.suggestions[0]).toBe('custom["review.status"]');
    expect(diagnostic.report.at(-1)).toBe(diagnostic.hint);
  },
);

it("suggests source names for an explicit misspelling", async () => {
  using scenario = openScenarioDatabase();
  const filter = 'custom["reviewStatus"] == "include"';
  const error = await failure(scenario, { filter });
  if (!(error instanceof ItemQueryError))
    throw new Error("Expected query fault");
  expect(error.fault).toMatchObject({
    kind: "unknown",
    role: "custom-field",
    name: "reviewStatus",
    customFields: CUSTOM_FIELDS,
  });
  const diagnostic = error.diagnostic;
  expect(diagnostic.expected).toEqual(CUSTOM_FIELDS);
  expect(diagnostic.suggestions[0]).toBe("review.status");
});

it.each(["review.status.more", "custom.review.status.more"])(
  "keeps the original property fault when the full chain %s is absent",
  async (access) => {
    using scenario = openScenarioDatabase();
    const error = await failure(scenario, { filter: access });
    const from = access.indexOf("status");
    expect(error).toMatchObject({
      fault: {
        kind: "unknown",
        role: "property",
        name: "status",
        at: { from, to: from + 6 },
        receiver: { type: "string", at: { from: 0, to: from - 1 } },
      },
    });
  },
);

it("keeps valid custom string properties and explicit bracket access", async () => {
  using scenario = openScenarioDatabase();
  const { scanned } = await open(scenario, {
    filter:
      'mood.length > 0 && custom.mood.lower() == "calm" && custom["review.status"].length > 0',
  });
  const article = scanned.find((item) => item.scan.key === "ART2FULL")!;
  expect([...article.hydrated.custom]).toEqual([
    ["review.status", "done"],
    ["mood", "calm"],
  ]);
});

it("keeps an explicit custom-field property failure at validation", async () => {
  using scenario = openScenarioDatabase();
  const error = await failure(scenario, {
    filter: 'custom["review.status"].absent',
  });
  expect(error).toMatchObject({
    fault: {
      kind: "unknown",
      role: "property",
      name: "absent",
      at: { from: 24, to: 30 },
    },
  });
});

it("carries source facts for a bare unknown field", async () => {
  using scenario = openScenarioDatabase();
  const error = await failure(scenario, { filter: "mood2" });
  expect(error).toMatchObject({
    fault: {
      kind: "unknown",
      role: "field",
      name: "mood2",
      customFields: CUSTOM_FIELDS,
    },
  });
});

it("carries an empty source vocabulary", async () => {
  using scenario = openScenarioDatabase();
  scenario.sqlite.exec("update fieldsCombined set custom = 0");
  const error = await failure(scenario, { filter: 'custom["review.status"]' });
  expect(error).toMatchObject({
    fault: { kind: "unknown", role: "custom-field", customFields: [] },
  });
});

it.each(["review.status.phase", "mood.length.unit"])(
  "resolves the complete chain %s after its first property fault",
  async (name) => {
    using scenario = openScenarioDatabase();
    scenario.sqlite
      .prepare("update fieldsCombined set fieldName = ? where fieldName = ?")
      .run(name, "review.status");
    const error = await failure(scenario, { filter: name });
    expect(error).toMatchObject({
      fault: { kind: "unknown", role: "custom-field", name, dotted: true },
    });
  },
);

// Failure modes: a valid property suffix can hide a dotted source name; the
// correction must consume the full bare or custom-root chain.
it.each(["review.length", "custom.review.length"])(
  "corrects the complete source name %s when its prefix is absent",
  async (access) => {
    using scenario = openScenarioDatabase();
    scenario.sqlite.exec(
      "update fieldsCombined set fieldName = 'review.length' where fieldName = 'review.status'",
    );
    const filter = `${access} == 4`;
    const error = await failure(scenario, { filter });
    if (!(error instanceof ItemQueryError))
      throw new Error("Expected query fault");
    const diagnostic = error.diagnostic;
    expect(diagnostic.suggestions).toEqual(['custom["review.length"]']);
    expect(diagnostic.location?.span).toEqual({ from: 0, to: access.length });
    expect(diagnostic.report.at(-1)).toBe(diagnostic.hint);
    expect(diagnostic.found).toBe("review.length");
  },
);

// Failure modes: Query Group needs are omitted from the scan pass or leak into projection.
it("loads Query Group needs in the scan pass", async () => {
  using scenario = openScenarioDatabase();
  const { scanned, projected, hydrates } = await open(scenario, {
    group: "collections[]",
  });
  const scannedArticle = scanned.find((item) => item.scan.key === "ART2FULL")!;
  const projectedArticle = projected.find(
    (item) => item.scan.key === "ART2FULL",
  )!;
  expect(scannedArticle.hydrated.collections).toEqual([["Thesis", "Methods"]]);
  expect(projectedArticle.hydrated.collections).toBeUndefined();
  expect(hydrates).toHaveLength(1);
});
