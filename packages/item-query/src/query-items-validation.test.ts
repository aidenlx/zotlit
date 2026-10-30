// Request and Filter Expression validation that fails before any database read.
import { Cause, Exit } from "effect";
import { describe, expect, it } from "vitest";

import { SCENARIO_LIBRARIES } from "@zotlit/db/test-scenario";

import { ANNOTATIONS, collectQuery, ITEMS, ItemQueryError } from ".";
import type {
  ItemQueryErrorCode,
  ItemQueryRequest,
  QueryDataset,
  SortSpec,
} from ".";
import { runEffect } from "./test-helpers";

const { personal, group } = SCENARIO_LIBRARIES;

/** The typed failure of a run without a database: it reads nothing. */
async function failure(
  request: ItemQueryRequest,
  dataset: QueryDataset<ItemQueryRequest> = ITEMS,
) {
  const { exit, events } = await runEffect(collectQuery(dataset, request));
  if (!Exit.isFailure(exit)) throw new Error("the query did not fail.");
  const error = Cause.findErrorOption(exit.cause);
  if (error._tag === "None") throw new Error(String(exit.cause));
  expect(events.filter((event) => event.type === "statement")).toEqual([]);
  return error.value;
}

describe("collectQuery(ITEMS) with a filter", () => {
  it.each(["", "   ", "\n"])("fails the empty filter %j", async (filter) => {
    const error = await failure({ libraries: [personal], filter });

    expect(error).toMatchObject({
      _tag: "ItemQueryError",
      code: "invalid-filter",
      location: { argument: "filter" },
    });
  });

  describe("validation", () => {
    it.each([
      ["title.startsWith(1)", "wrong-argument-type", [17, 18]],
      ["title.startsWith()", "wrong-argument-count", [0, 18]],
      ['noSuchFunction(title) == "a"', "unknown-function", [0, 14]],
      ['tags.startsWith("a")', "unknown-function", [5, 15]],
      ['title == "a', "invalid-filter", [11, 11]],
      ["title.lenght > 3", "unknown-property", [6, 12]],
      ['custom == "a"', "unfilterable-field", [0, 6]],
      ["dateAdded > date(2020)", "wrong-argument-type", [17, 21]],
      // A branch that never runs.
      ["false && title.startsWith(1)", "wrong-argument-type", [26, 27]],
      ["true || noSuchFunction()", "unknown-function", [8, 22]],
      ["if(true, true, title.lower(1))", "wrong-argument-count", [15, 29]],
    ])(
      "fails %j with %s before it reads the database",
      async (filter, code, [from, to]) => {
        const error = await failure({ libraries: [personal], filter });

        expect(error).toBeInstanceOf(ItemQueryError);
        expect(error).toMatchObject({
          code,
          location: { argument: "filter", span: { from, to } },
        });
        expect(error.message).not.toBe("");
        expect((error as ItemQueryError).hint).not.toBe("");
      },
    );
  });
});

/** The invalid request entries of each Query Dataset. */
interface ValidationCase {
  readonly dataset: QueryDataset<ItemQueryRequest>;
  /** A valid Projection Path and a valid sort entry of the dataset. */
  readonly field: string;
  readonly sort: SortSpec;
  /** Invalid Projection Paths and the code of each. */
  readonly paths: readonly (readonly [string, ItemQueryErrorCode])[];
  /** Invalid Sortable Fields and the code of each. */
  readonly sortFields: readonly (readonly [string, ItemQueryErrorCode])[];
}

const DATASETS: readonly ValidationCase[] = [
  {
    dataset: ITEMS,
    field: "dateAdded",
    sort: { field: "publicationTitle", direction: "desc" },
    paths: [
      ["date.", "invalid-path"],
      ["custom[review]", "invalid-path"],
      ['custom["unterminated]', "invalid-path"],
      ["title]", "invalid-path"],
      ["", "invalid-path"],
      ["[0]", "unknown-field"],
      ["mood", "unknown-field"],
      ["Title", "unknown-field"],
      ["date.century", "unknown-path"],
      ["title.length", "unknown-path"],
      ["date[0]", "unknown-path"],
      ["custom[0]", "unknown-path"],
      ["creators[ ]", "invalid-path"],
      ["title[]", "unknown-path"],
      // Array access does not vectorize.
      ["creators.fullName", "unknown-path"],
      ["tags.name", "unknown-path"],
      ["creators[0].name", "unknown-path"],
      ["collections[0].name", "unknown-path"],
      ["attachments[].unknownField", "unknown-path"],
    ],
    sortFields: [
      ["noSuchField", "unknown-field"],
      ["Title", "unknown-field"],
      ["", "unknown-field"],
      ["custom", "unsortable-field"],
      ['custom["mood"]', "unsortable-field"],
      ["date.year", "unsortable-field"],
      ["creators[].fullName", "unsortable-field"],
    ],
  },
  {
    dataset: ANNOTATIONS,
    field: "type",
    sort: { field: "type", direction: "desc" },
    paths: [
      ["text.", "invalid-path"],
      ['item.custom["unterminated]', "invalid-path"],
      ["item.title]", "invalid-path"],
      ["", "invalid-path"],
      ["[0]", "unknown-field"],
      ["missing", "unknown-field"],
      ["Text", "unknown-field"],
      ["item.noSuchField", "unknown-field"],
      ["attachment.missing", "unknown-path"],
      ["item.date.century", "unknown-path"],
      ["tags.name", "unknown-path"],
      ["item.creators.fullName", "unknown-path"],
      ["item.title[]", "unknown-path"],
    ],
    sortFields: [
      ["noSuchField", "unknown-field"],
      ["Type", "unknown-field"],
      ["", "unknown-field"],
      ["text", "unsortable-field"],
      ["attachment.path", "unsortable-field"],
      ["item.date.year", "unsortable-field"],
      ["item.creators[].fullName", "unsortable-field"],
    ],
  },
];

describe.each(DATASETS)(
  "$dataset.family request",
  ({ dataset, field, sort, paths, sortFields }) => {
    const request = (rest: Omit<ItemQueryRequest, "libraries"> = {}) => ({
      libraries: [personal],
      ...rest,
    });

    async function requestFailure(query: ItemQueryRequest) {
      const error = await failure(query, dataset);
      expect(error).toBeInstanceOf(ItemQueryError);
      expect(error).toMatchObject({ dataset });
      return error as ItemQueryError;
    }

    it("rejects library sorting with a Diagnostic Report that lists Sortable Fields", async () => {
      const error = await requestFailure(
        request({ sort: [{ field: "library", direction: "asc" }] }),
      );
      expect(error.code).toBe("unsortable-field");
      expect(error.diagnostic.expected).toEqual(dataset.sortableFields);
      expect(error.diagnostic.report.join("\n")).toContain(
        "Sortable Fields include",
      );
    });

    describe("failures", () => {
      it.each([...paths])(
        "fails the path %j with %s before it reads the database",
        async (path, code) => {
          const error = await requestFailure(
            request({ fields: [field, path] }),
          );

          expect(error).toMatchObject({
            code,
            location: { argument: "fields", index: 1 },
          });
          // The report marks the whole entry the caller sent.
          expect(error.diagnostic.excerpt?.at).toBe(path);
        },
      );

      it.each([...sortFields])(
        "fails the sort field %j with %s before it reads the database",
        async (field, code) => {
          const error = await requestFailure(
            request({ sort: [sort, { field, direction: "asc" }] }),
          );

          expect(error).toMatchObject({
            code,
            location: { argument: "sort", index: 1 },
          });
        },
      );

      it.each([0, -1, 1.5, Number.NaN])(
        "fails the limit %s before it reads the database",
        async (limit) => {
          const error = await requestFailure(request({ limit }));

          expect(error).toMatchObject({
            code: "invalid-limit",
            location: { argument: "limit" },
          });
        },
      );

      it("fails a request that names one Library twice", async () => {
        const error = await requestFailure({
          libraries: [personal, group, { ...personal }],
          limit: 1,
        });

        expect(error).toMatchObject({
          code: "duplicate-library",
          location: { argument: "libraries", index: 2 },
        });
      });
    });
  },
);

describe("grouped Item Query", () => {
  it.each(["tags", "creators", "tags[]", "creators[0]", "date", "custom"])(
    "rejects a non-scalar group Projection Path: %s",
    async (group) => {
      const error = await failure({ libraries: [personal], group });
      expect(error).toBeInstanceOf(ItemQueryError);
      if (!(error instanceof ItemQueryError)) throw error;
      expect(error.diagnostic).toMatchObject({
        code: "invalid-group",
        location: { argument: "group" },
      });
      expect(error.diagnostic.report.join("\n")).toContain("scalar");
    },
  );

  it("rejects [] on a scalar group path as an invalid Projection Path", async () => {
    const error = await failure({ libraries: [personal], group: "title[]" });
    expect(error).toMatchObject({
      code: "unknown-path",
      location: { argument: "group" },
      diagnostic: { suggestions: ["group='title'"] },
    });
  });
});
