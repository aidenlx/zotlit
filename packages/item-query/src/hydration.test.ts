// The load plan of each pass: what a request reads from the source once, and
// what each pass loads for a chunk of scan rows. Each test opens the Hydration
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

import { diagnose } from "./diagnose";
import { ItemQueryError } from "./error";
import { openHydration } from "./hydration";
import type { LoadPlan } from "./hydration";
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
 * Open the Hydration of a request and load the first scan page of the
 * personal Library through both passes.
 */
async function open(scenario: ScenarioDatabase, request: Request) {
  const { libraries = [personal], ...rest } = request;
  let seen = 0;
  const { exit, events } = await runEffect(
    Effect.gen(function* () {
      const plan = yield* planRequest({
        fields: [],
        sort: [],
        ...rest,
        libraries,
      });
      const hydration = yield* openHydration(plan, libraries);
      const opened = seen;
      const page = yield* readScanPage({
        libraryID: personal.libraryID,
        afterKey: null,
        size: HYDRATE_CHUNK_SIZE,
      });
      const scanned = yield* hydration.scan.load(page);
      const projected = yield* hydration.projection.load(page);
      return { hydration, opened, scanned, projected };
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
    /** The statements that opening the Hydration ran. */
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

/** The typed failure of opening the Hydration of a request. */
async function failure(scenario: ScenarioDatabase, request: Request) {
  const { exit } = await runEffect(
    Effect.gen(function* () {
      const plan = yield* planRequest({ ...request, libraries: [personal] });
      return yield* openHydration(plan, [personal]);
    }),
    { client: scenario.db },
  );
  if (!Exit.isFailure(exit)) throw new Error("the Hydration opened.");
  const error = Cause.findErrorOption(exit.cause);
  if (error._tag === "None") throw new Error(String(exit.cause));
  return error.value;
}

function fieldNames(scenario: ScenarioDatabase, fieldIDs: unknown): string[] {
  const nameOf = scenario.sqlite.prepare(
    "select fieldName from fieldsCombined where fieldID = ?",
  );
  return (JSON.parse(fieldIDs as string) as number[])
    .map((id) => (nameOf.get(id) as { fieldName: string }).fieldName)
    .toSorted();
}

const loads = (plan: Partial<LoadPlan["fields"]> & Partial<LoadPlan>) => ({
  fields: { builtIn: plan.builtIn ?? [], custom: plan.custom ?? [] },
  relations: plan.relations ?? [],
});

describe("Hydration", () => {
  it("reads no source and loads nothing for a filter on the scan row", async () => {
    using scenario = openScenarioDatabase();
    const { hydration, opening, hydrates, scanned } = await open(scenario, {
      filter: 'itemType == "book" && key != "ART2FULL"',
    });

    expect(hydration.scan.plan).toBeNull();
    expect(hydration.projection.plan).toBeNull();
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

    expect(hydration.scan.plan).toEqual(loads({ relations: ["tags"] }));
    expect(hydration.projection.plan).toBeNull();
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

    expect(hydration.scan.plan).toEqual(
      loads({ builtIn: ["publisher"], custom: ["review.status"] }),
    );
    expect(hydrates).toHaveLength(1);
    const names = fieldNames(scenario, hydrates[0]!.params["fieldIDs"]);
    expect(names).toContain("publisher");
    expect(names).toContain("institution");
    expect(names).toContain("review.status");
    expect(names).not.toContain("title");
    expect(names).not.toContain("mood");
    // The report stores `institution`, an alias of `publisher`.
    const report = scanned.find((item) => item.scan.key === "RPT2NDTE")!;
    expect(report.hydrated.fields.get("publisher")).toBe("Lab Institute");
  });

  it("loads the fields of a branch that does not run for an Item", async () => {
    using scenario = openScenarioDatabase();
    const { hydration, hydrates, scanned } = await open(scenario, {
      filter: 'itemType == "report" && creators.isEmpty()',
    });

    expect(hydration.scan.plan).toEqual(loads({ relations: ["creators"] }));
    expect(hydrates).toHaveLength(1);
    const report = scanned.find((item) => item.scan.key === "RPT2NDTE")!;
    expect(report.hydrated.creators).toEqual([]);
  });

  it("loads the filter and sort fields in the scan pass and the projection fields in the projection pass", async () => {
    using scenario = openScenarioDatabase();
    const { hydration, hydrates, projected } = await open(scenario, {
      filter: 'tags.contains("to-read")',
      fields: ["DOI", "custom"],
      sort: [{ field: "title", direction: "asc" }],
    });

    expect(hydration.scan.plan).toEqual(
      loads({ builtIn: ["title"], relations: ["tags"] }),
    );
    // `custom` loads every custom field of the source.
    expect(hydration.projection.plan).toEqual(
      loads({ builtIn: ["DOI"], custom: CUSTOM_FIELDS }),
    );
    // The scan pass: the field values, then the Tags. The projection pass: the
    // field values.
    expect(hydrates).toHaveLength(3);
    const scanFields = fieldNames(scenario, hydrates[0]!.params["fieldIDs"]);
    expect(scanFields).toContain("title");
    expect(scanFields).not.toContain("DOI");
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

    expect(hydration.scan.plan).toBeNull();
    expect(hydration.projection.plan).toEqual(
      loads({ relations: ["collections"] }),
    );
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
    const { hydration } = await open(scenario, {
      libraries: [personal, group],
      filter: 'collections.contains("Thesis/Methods")',
    });

    const pathsOf = (library: TargetLibrary) => [
      ...(hydration.candidateSources(library).collectionPaths?.values() ?? []),
    ];
    expect(pathsOf(personal)).toContainEqual(["Thesis", "Methods"]);
    expect(pathsOf(group)).not.toContainEqual(["Thesis", "Methods"]);
    expect(hydration.candidateSources(personal).vocabulary).not.toBeNull();
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
    const diagnostic = diagnose(error.fault, filter, error.location);
    expect(diagnostic.suggestions[0]).toBe('custom["review.status"]');
    expect(diagnostic.hint).toBe('Try: custom["review.status"] == "include"');
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
  const diagnostic = diagnose(error.fault, filter, error.location);
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
  const { hydration } = await open(scenario, {
    filter:
      'mood.length > 0 && custom.mood.lower() == "calm" && custom["review.status"].length > 0',
  });
  expect(hydration.scan.plan).toEqual(
    loads({ custom: ["mood", "review.status"] }),
  );
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
