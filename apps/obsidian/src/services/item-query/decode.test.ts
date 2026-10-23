import type { CliData } from "obsidian";
import { describe, expect } from "vitest";

import type { CliRejection } from "@/lib/cli-params";
import { Effect, Schema } from "@/lib/effect";
import { it } from "@/lib/effect-vitest";

import * as decode from "./decode";
import { DecodedQuery } from "./query-codec";

/** The decoded value, or the diagnostic the handler answers with. */
const answered =
  <T>(decoder: (params: CliData) => Effect.Effect<T, CliRejection>) =>
  (params: CliData) =>
    decoder(params).pipe(
      Effect.catchTag("CliRejection", (rejection) =>
        Effect.succeed(decode.rejectionDiagnostic(rejection)),
      ),
    );

const decodeQuery = answered(decode.decodeQuery);

/** `query` as the worker reads it: encoded to plain JSON, then decoded. */
const acrossSeam = (query: DecodedQuery): DecodedQuery =>
  Schema.decodeUnknownSync(DecodedQuery)(
    JSON.parse(JSON.stringify(Schema.encodeSync(DecodedQuery)(query))),
  );
const decodeGuideArguments = answered(decode.decodeGuideArguments);
const decodeCancelArguments = answered(decode.decodeCancelArguments);
const decodeSchemaArguments = answered((params) =>
  decode.decodeSchemaArguments(params),
);

/** The diagnostic of an argument that the decoder rejects. */
const rejected = (parameter: string) => ({
  code: "invalid-argument",
  hint: expect.any(String),
  details: { parameter },
});

describe("decodeQuery without arguments", () => {
  it.effect(
    "gives the CLI defaults and leaves the Libraries to the Library Scope",
    () =>
      Effect.gen(function* () {
        expect(yield* decodeQuery({})).toStrictEqual({
          from: "items",
          libraries: null,
          limit: 100,
        });
      }),
  );

  it.effect.each<CliData>([{}, { library: "personal", limit: "all" }])(
    "crosses the worker seam unchanged for %j",
    (params) =>
      Effect.gen(function* () {
        const query = yield* decode.decodeQuery(params);

        expect(acrossSeam(query)).toStrictEqual(query);
      }),
  );

  it.effect("crosses the worker seam unchanged with every argument", () =>
    Effect.gen(function* () {
      const query = yield* decode.decodeQuery({
        library: '["group:4815","personal"]',
        filter: "true",
        fields: '["title"]',
        sort: '[{"field":"title","direction":"asc"}]',
        limit: "3",
        output: "/exports/items.json",
        id: "export-a",
        formulas: '{"__proto__":"date.year"}',
      });

      expect(acrossSeam(query)).toStrictEqual(query);
      expect(Object.getPrototypeOf(acrossSeam(query).formulas)).toBeNull();
    }),
  );
});

describe("decodeQuery limit", () => {
  it.effect("decodes a positive integer", () =>
    Effect.gen(function* () {
      expect(yield* decodeQuery({ limit: "3" })).toMatchObject({ limit: 3 });
    }),
  );

  it.effect("decodes limit=all to null", () =>
    Effect.gen(function* () {
      expect(yield* decodeQuery({ limit: "all" })).toMatchObject({
        limit: null,
      });
    }),
  );

  it.effect.each([
    "0",
    "-1",
    "1.5",
    "ten",
    "",
    "1e3",
    "unlimited",
    "99999999999999999999",
  ])("rejects limit=%j", (limit) =>
    Effect.gen(function* () {
      expect(yield* decodeQuery({ limit })).toMatchObject(rejected("limit"));
    }),
  );
});

describe("decodeQuery library", () => {
  it.effect.each([
    ["personal", { type: "personal" }],
    ["group:4815", { type: "group", groupID: 4815 }],
  ] as const)("names the Library of library=%s", ([library, selector]) =>
    Effect.gen(function* () {
      expect(yield* decodeQuery({ library })).toMatchObject({
        libraries: {
          scope: { mode: "selected", libraries: [selector] },
          parameter: "library",
        },
      });
    }),
  );

  it.effect.each(["group:", "group:abc", "group:0", "My Library", "1"])(
    "rejects library=%j",
    (library) =>
      Effect.gen(function* () {
        expect(yield* decodeQuery({ library })).toMatchObject(
          rejected("library"),
        );
      }),
  );

  it.effect("answers a malformed Library before a malformed option", () =>
    Effect.gen(function* () {
      expect(yield* decodeQuery({ library: "bad", limit: "0" })).toMatchObject(
        rejected("library"),
      );
    }),
  );
});

describe("decodeQuery libraries", () => {
  it.effect(
    "names the Libraries in the canonical order, whatever order the caller gives",
    () =>
      Effect.gen(function* () {
        expect(
          yield* decodeQuery({
            library: '["group:4815","group:12","personal"]',
          }),
        ).toMatchObject({
          libraries: {
            scope: {
              mode: "selected",
              libraries: [
                { type: "personal" },
                { type: "group", groupID: 12 },
                { type: "group", groupID: 4815 },
              ],
            },
            parameter: "library",
          },
        });
      }),
  );

  it.effect("names every Library for libraries=all", () =>
    Effect.gen(function* () {
      expect(yield* decodeQuery({ library: "all" })).toMatchObject({
        libraries: { scope: { mode: "all" }, parameter: "library" },
      });
    }),
  );

  it.effect.each([
    ["unknown selector", "no Library"],
    ["no array", '"personal"'],
    ["an empty array", "[]"],
    ["a selector that is no text", "[1]"],
    ["a selector object", '[{"type":"personal"}]'],
    ["an unknown selector", '["My Library"]'],
    ["a group without a positive ID", '["group:0"]'],
    ["the word all inside the array", '["all"]'],
    ["a Library twice", '["personal","personal"]'],
    ["a group twice", '["group:4815","personal","group:4815"]'],
  ] as const)("rejects libraries with %s", ([_name, library]) =>
    Effect.gen(function* () {
      expect(yield* decodeQuery({ library })).toMatchObject(
        rejected("library"),
      );
    }),
  );

  it.effect("keeps the inner issue of a malformed Library selector", () =>
    Effect.gen(function* () {
      const request = yield* Effect.flip(
        decode.decodeQuery({ library: '["My Library"]' }),
      );
      expect(request).toMatchObject({
        parameter: "library",
        issue: {
          path: "library[0]",
          expected: expect.any(String),
          received: expect.any(String),
        },
      });
      expect(decode.rejectionDiagnostic(request)).toMatchObject({
        code: "invalid-argument",
        found: '"My Library"',
        location: { path: "library[0]" },
      });
    }),
  );
});

describe("removed libraries parameter", () => {
  it.effect.each(["all", "[]", "", "personal"])(
    "rejects libraries=%j even beside library",
    (libraries) =>
      Effect.gen(function* () {
        expect(
          yield* decodeQuery({ library: "personal", libraries }),
        ).toMatchObject({
          ...rejected("libraries"),
          message: expect.stringContaining("Unknown parameter 'libraries'"),
          hint: expect.stringContaining("Use library="),
        });
      }),
  );
});

describe("decodeQuery fields, filter, and sort", () => {
  it.effect(
    "decodes the JSON arrays of fields and sort, and passes the filter through",
    () =>
      Effect.gen(function* () {
        expect(
          yield* decodeQuery({
            fields: '["title","custom[\\"a.b\\"]"]',
            filter: 'tags.contains("to-read")',
            sort: '[{"field":"title","direction":"asc"}]',
          }),
        ).toMatchObject({
          fields: ["title", 'custom["a.b"]'],
          filter: 'tags.contains("to-read")',
          sort: [{ field: "title", direction: "asc" }],
        });
      }),
  );

  it.effect("decodes fields=[] to identity-only rows", () =>
    Effect.gen(function* () {
      expect(yield* decodeQuery({ fields: "[]" })).toMatchObject({
        fields: [],
      });
    }),
  );

  it.effect.each([
    {
      name: "an unknown direction",
      value: '[{"field":"title","direction":"ascending"}]',
      issue: {
        path: "sort[0].direction",
        expected: '("asc" | "desc")',
        received: '"ascending"',
      },
    },
    {
      name: "a missing direction",
      value: '[{"field":"title"}]',
      issue: {
        path: "sort[0].direction",
        expected: '"direction"',
        received: "undefined",
      },
    },
  ])("keeps the issue for sort with $name", ({ value, issue }) =>
    Effect.gen(function* () {
      expect(yield* decodeQuery({ sort: value })).toMatchObject({
        location: { path: issue.path },
        found: issue.received === "Object" ? value : issue.received,
      });
      expect(
        yield* Effect.flip(decode.decodeQuery({ sort: value })),
      ).toMatchObject({
        parameter: "sort",
        issue,
      });
    }),
  );

  it.effect.each([
    {
      name: "malformed JSON array",
      value: '["title",',
      issue: {
        path: "fields",
        expected: "JSON",
        received: expect.any(String),
      },
    },
    {
      name: "a non-text array entry",
      value: '["title",5]',
      issue: { path: "fields[1]", expected: "string", received: "5" },
    },
  ])("distinguishes fields with $name", ({ value, issue }) =>
    Effect.gen(function* () {
      expect(yield* decodeQuery({ fields: value })).toMatchObject({
        location: { path: issue.path },
        found: issue.received === "Object" ? value : issue.received,
      });
      expect(
        yield* Effect.flip(decode.decodeQuery({ fields: value })),
      ).toMatchObject({
        parameter: "fields",
        issue,
      });
    }),
  );

  it.effect.each([
    ["fields", '["title"'],
    ["fields", "[1]"],
    ["filter", ""],
    ["filter", "   "],
    ["sort", '[{"field":"title"}]'],
    ["sort", '[{"field":"title","direction":"up"}]'],
  ] as const)("rejects %s=%j", ([parameter, value]) =>
    Effect.gen(function* () {
      expect(yield* decodeQuery({ [parameter]: value })).toMatchObject(
        rejected(parameter),
      );
    }),
  );
});

describe("decodeQuery formulas", () => {
  it.effect("decodes a JSON object of Formula names and expressions", () =>
    Effect.gen(function* () {
      expect(
        yield* decodeQuery({
          formulas: '{"year":"date.year","short":"title.slice(0, 20)"}',
          fields: "title,formula.year",
        }),
      ).toMatchObject({
        formulas: { year: "date.year", short: "title.slice(0, 20)" },
        fields: ["title", "formula.year"],
      });
    }),
  );

  it.effect(
    "keeps a Formula whose name is also an object member, such as __proto__",
    () =>
      Effect.gen(function* () {
        const decoded = yield* decodeQuery({
          formulas: '{"__proto__":"date.year","constructor":"title"}',
        });
        expect(decoded).toHaveProperty("formulas");
        const { formulas } = decoded as { formulas: object };
        expect(Object.entries(formulas)).toEqual([
          ["__proto__", "date.year"],
          ["constructor", "title"],
        ]);
      }),
  );

  it.effect("omits formulas when the argument is absent", () =>
    Effect.gen(function* () {
      expect(yield* decodeQuery({})).not.toHaveProperty("formulas");
    }),
  );

  it.effect.each([
    ["a comma list", "year=date.year"],
    ["malformed JSON", '{"year":'],
    ["a JSON array", '["date.year"]'],
    ["an expression that is not text", '{"year":2020}'],
  ] as const)("rejects %s", ([, formulas]) =>
    Effect.gen(function* () {
      expect(yield* decodeQuery({ formulas })).toMatchObject(
        rejected("formulas"),
      );
    }),
  );
});

describe("decodeQuery Query Context", () => {
  it.effect("binds this.item and this.attachment by Indexed Key", () =>
    Effect.gen(function* () {
      expect(
        yield* decodeQuery({
          "this-item": "ART2FULLg4815",
          "this-attachment": "PDF2LIVE",
        }),
      ).toMatchObject({
        context: { item: "ART2FULLg4815", attachment: "PDF2LIVE" },
      });
    }),
  );

  it.effect("omits the Query Context when no binding is given", () =>
    Effect.gen(function* () {
      expect(yield* decodeQuery({})).not.toHaveProperty("context");
    }),
  );

  it.effect.each(["this-item", "this-attachment"])(
    "rejects a %s that is not an Indexed Key",
    (parameter) =>
      Effect.gen(function* () {
        expect(yield* decodeQuery({ [parameter]: "not a key" })).toMatchObject(
          rejected(parameter),
        );
      }),
  );
});

describe("decodeQuery output", () => {
  it.effect("decodes an absolute path", () =>
    Effect.gen(function* () {
      expect(
        yield* decodeQuery({ output: "/exports/items.json" }),
      ).toMatchObject({
        output: "/exports/items.json",
      });
    }),
  );

  it.effect.each(["relative.json", "/exports/a\0b.json"])(
    "rejects output=%j",
    (output) =>
      Effect.gen(function* () {
        expect(yield* decodeQuery({ output })).toMatchObject(
          rejected("output"),
        );
      }),
  );
});

describe("decodeQuery parameters", () => {
  it.effect("rejects an undeclared parameter", () =>
    Effect.gen(function* () {
      expect(yield* decodeQuery({ fields: "[]", colour: "red" })).toMatchObject(
        rejected("colour"),
      );
    }),
  );

  it.effect("keeps received parameter order for a shell-split filter", () =>
    Effect.gen(function* () {
      const params = { filter: "itemType", "==": "true", '"book"': "true" };
      expect(yield* Effect.flip(decode.decodeQuery(params))).toMatchObject({
        parameter: "==",
        received: Object.entries(params),
        shellSplit: true,
      });
      expect(yield* decodeQuery(params)).toMatchObject({
        ...rejected("=="),
        suggestions: ["filter='itemType == \"book\"'"],
      });
    }),
  );

  it.effect("rejects a vault parameter after the command name", () =>
    Effect.gen(function* () {
      expect(yield* decodeQuery({ vault: "Research" })).toMatchObject(
        rejected("vault"),
      );
    }),
  );

  it.effect.each(["filter", "limit"])("rejects --%s", (parameter) =>
    Effect.gen(function* () {
      expect(yield* decodeQuery({ [`--${parameter}`]: "1" })).toMatchObject(
        rejected(`--${parameter}`),
      );
    }),
  );

  it.effect("rejects a malformed switch beside a valid parameter", () =>
    Effect.gen(function* () {
      expect(
        yield* decodeQuery({ limit: "1", "--filter": "true" }),
      ).toMatchObject(rejected("--filter"));
    }),
  );

  it.effect.each(["--unknown", "--help", "--verbose"])(
    "rejects unsupported switch %s",
    (key) =>
      Effect.gen(function* () {
        expect(yield* decodeQuery({ [key]: "true" })).toMatchObject({
          ...rejected(key),
        });
      }),
  );

  it.effect("decodes a query ID", () =>
    Effect.gen(function* () {
      expect(yield* decodeQuery({ id: "export-2024.v1_a" })).toMatchObject({
        id: "export-2024.v1_a",
      });
    }),
  );

  it.effect.each(["", "two words", "a/b", "x".repeat(129)])(
    "rejects the query ID %j",
    (id) =>
      Effect.gen(function* () {
        expect(yield* decodeQuery({ id })).toMatchObject(rejected("id"));
      }),
  );
});

describe("decodeSchemaArguments", () => {
  it.effect("accepts no parameter", () =>
    Effect.gen(function* () {
      expect(yield* decodeSchemaArguments({})).toStrictEqual({});
    }),
  );

  it.effect.each<[CliData, string]>([
    [{ library: "personal" }, "library"],
    [{ vault: "Research" }, "vault"],
    [{ "--limit": "1" }, "--limit"],
  ])("rejects %j", ([params, parameter]) =>
    Effect.gen(function* () {
      expect(yield* decodeSchemaArguments(params)).toMatchObject(
        rejected(parameter),
      );
    }),
  );
});

describe("decodeGuideArguments and decodeCancelArguments", () => {
  it.effect.each([
    [decodeGuideArguments, "topic", "filter"],
    [decodeCancelArguments, "id", "export-a"],
  ] as const)("rejects --%s", ([decode, parameter, value]) =>
    Effect.gen(function* () {
      expect(yield* decode({ [`--${parameter}`]: value })).toMatchObject({
        ...rejected(`--${parameter}`),
      });
    }),
  );

  it.effect("decodes the guide topic, or null for the quickstart", () =>
    Effect.gen(function* () {
      expect(yield* decodeGuideArguments({ topic: "filter" })).toBe("filter");
      expect(yield* decodeGuideArguments({})).toBeNull();
      expect(yield* decodeGuideArguments({ topic: "nope" })).toMatchObject(
        rejected("topic"),
      );
    }),
  );

  it.effect.each<CliData>([{}, { id: "two words" }])(
    "rejects the cancel arguments %j",
    (params) =>
      Effect.gen(function* () {
        expect(yield* decodeCancelArguments(params)).toMatchObject(
          rejected("id"),
        );
      }),
  );
});

it.effect(
  "renders decoder issue data and the recovery action in contract v3",
  () =>
    Effect.gen(function* () {
      const rejection = yield* Effect.flip(
        decode.decodeQuery({
          sort: '[{"field":"title","direction":"ascending"}]',
        }),
      );
      const diagnostic = decode.rejectionDiagnostic(rejection);
      expect(diagnostic).toMatchObject({
        severity: "error",
        location: { path: "sort[0].direction" },
        found: '"ascending"',
        expected: ["asc", "desc"],
        suggestions: ['sort=\'[{"field":"title","direction":"asc"}]\''],
      });
      expect(diagnostic.report[0]).toBe(diagnostic.message);
      expect(diagnostic.report.at(-1)).toBe(diagnostic.hint);
    }),
);

it.effect(
  "reconstructs the real empty-key shell split without inventing removed quotes",
  () =>
    Effect.gen(function* () {
      const params = { filter: "itemType", "": "=", book: "true", limit: "5" };
      const rejection = yield* Effect.flip(decode.decodeQuery(params));
      expect(rejection).toMatchObject({
        parameter: "",
        received: Object.entries(params),
        shellSplit: true,
      });
      expect(yield* decodeQuery(params)).toMatchObject({
        suggestions: ["filter='itemType == book'"],
      });
    }),
);

it.effect(
  "preserves received quote characters in a reconstructed shell argument",
  () =>
    Effect.gen(function* () {
      const params = { filter: "title", "": "=", '"O\'Brien"': "true" };
      expect(yield* decodeQuery(params)).toMatchObject({
        suggestions: ["filter='title == \"O'\"'\"'Brien\"'"],
      });
    }),
);

const decodeAnnotationQuery = answered((params) =>
  decode.decodeQuery({ ...params, from: "annotations" }),
);
// Failure modes: selectors still resolve Libraries, or their rejection omits recovery.
it.effect.each([
  ["items", "item", "indexedKey"],
  ["items", "attachment", "indexedKey"],
  ["attachments", "item", "item.indexedKey"],
  ["attachments", "attachment", "indexedKey"],
  ["annotations", "item", "item.indexedKey"],
  ["annotations", "attachment", "attachment.indexedKey"],
] as const)(
  "rejects %s %s with filter selection guidance",
  ([from, parameter, field]) =>
    Effect.gen(function* () {
      const diagnostic = yield* decodeQuery({
        from,
        [parameter]: "ART2FULL",
        library: "personal",
      });
      expect(diagnostic).toMatchObject({
        code: "invalid-argument",
        message: expect.stringContaining("Unknown parameter"),
        location: { argument: parameter },
        hint: `Use filter='${field} == "<key>"' to select by Indexed Key.`,
      });
    }),
);

it.effect.each([
  [{ fields: '["text", 3]' }, "fields", "fields[1]"],
  [
    { sort: '[{"field":"pageIndex","direction":"ascending"}]' },
    "sort",
    "sort[0].direction",
  ],
] as const)(
  "preserves Annotation JSON issue locations for %j",
  ([params, argument, path]) =>
    Effect.gen(function* () {
      expect(yield* decodeAnnotationQuery(params)).toMatchObject({
        code: "invalid-argument",
        location: { argument, path },
        found: expect.any(String),
        expected: expect.any(Array),
      });
    }),
);

it.effect("preserves shell-split evidence for Annotation filters", () =>
  Effect.gen(function* () {
    const request = yield* Effect.flip(
      decode.decodeQuery({
        from: "annotations",
        filter: "tags",
        "==": "true",
        '"figure"': "true",
      }),
    );
    expect(request).toMatchObject({ shellSplit: true });
    expect(
      yield* decodeAnnotationQuery({
        filter: "tags",
        "==": "true",
        '"figure"': "true",
      }),
    ).toMatchObject({
      code: "invalid-argument",
      suggestions: ["filter='tags == \"figure\"'"],
    });
  }),
);

it.effect(
  "keeps Target Libraries independent of an Annotation key filter",
  () =>
    Effect.gen(function* () {
      expect(
        yield* decodeAnnotationQuery({
          filter: 'item.indexedKey == "ART2FULLg4815"',
          library: "personal",
        }),
      ).toMatchObject({
        filter: 'item.indexedKey == "ART2FULLg4815"',
        libraries: {
          parameter: "library",
          scope: { mode: "selected", libraries: [{ type: "personal" }] },
        },
      });
    }),
);

it.effect(
  "decodes comma lists with quoted commas and the effective Query Dataset",
  () =>
    Effect.gen(function* () {
      expect(
        yield* decodeQuery({
          from: "annotations",
          fields: "text,item.custom[\"a,b\"],item.custom['c,d']",
          sort: "-item.date,+item.title",
          library: "personal,group:118",
        }),
      ).toMatchObject({
        from: "annotations",
        fields: ["text", 'item.custom["a,b"]', "item.custom['c,d']"],
        sort: [
          { field: "item.date", direction: "desc" },
          { field: "item.title", direction: "asc" },
        ],
        libraries: {
          parameter: "library",
          scope: {
            mode: "selected",
            libraries: [{ type: "personal" }, { type: "group", groupID: 118 }],
          },
        },
      });
    }),
);

it.effect.each(["unknown"])(
  "rejects unavailable Query Dataset %s with available datasets",
  (from) =>
    Effect.gen(function* () {
      expect(yield* decodeQuery({ from })).toMatchObject({
        ...rejected("from"),
        expected: ["items", "attachments", "annotations"],
        report: expect.arrayContaining([
          expect.stringContaining("items, attachments, annotations"),
        ]),
      });
    }),
);
it.effect.each(["fields", "sort", "library"])(
  "points at an empty %s comma-list element",
  (parameter) =>
    Effect.gen(function* () {
      for (const value of ["title,,date", "title,"]) {
        const result = yield* decodeQuery({ [parameter]: value });
        expect(result).toMatchObject({
          ...rejected(parameter),
          location: {
            argument: parameter,
            path: `${parameter}[1]`,
            index: 1,
            span: { from: 6, to: 6 },
          },
        });
      }
    }),
);
it.effect("accepts equivalent field and sort forms", () =>
  Effect.gen(function* () {
    expect(yield* decodeQuery({ fields: "title,date.year" })).toEqual(
      yield* decodeQuery({ fields: '["title","date.year"]' }),
    );
    expect(yield* decodeQuery({ sort: "-date,title" })).toEqual(
      yield* decodeQuery({
        sort: '[{"field":"date","direction":"desc"},{"field":"title","direction":"asc"}]',
      }),
    );
    expect(yield* decodeQuery({ sort: "+title" })).toEqual(
      yield* decodeQuery({ sort: "title" }),
    );
  }),
);
it.effect.each([
  'custom["a,b"],title',
  "custom['a,b'],title",
  '"a,b",title',
  "'a,b',title",
  'custom["a\\\"b,c"],title',
])("keeps quoted commas in %s", (fields) =>
  Effect.gen(function* () {
    expect(yield* decodeQuery({ fields })).toMatchObject({
      fields: [fields.slice(0, -6), "title"],
    });
  }),
);
it.effect("narrows the schema to the requested Query Dataset", () =>
  Effect.gen(function* () {
    expect(yield* decodeSchemaArguments({ from: "annotations" })).toEqual({
      from: "annotations",
    });
  }),
);

it.effect(
  "decodes one group Projection Path and preserves custom-field punctuation",
  () =>
    Effect.gen(function* () {
      expect(yield* decodeQuery({ group: 'custom["review,status"]' })).toEqual({
        from: "items",
        libraries: null,
        limit: 100,
        group: 'custom["review,status"]',
      });
      expect(yield* decodeQuery({ group: "" })).toMatchObject(
        rejected("group"),
      );
    }),
);

it.effect.each(["tags[].name", "collections[]", "attachments[].tags[]"])(
  "decodes the element group path %s as written",
  (group) =>
    Effect.gen(function* () {
      expect(yield* decodeQuery({ group })).toMatchObject({ group });
    }),
);

it.effect("accepts Attachment queries and narrowed Attachment schemas", () =>
  Effect.gen(function* () {
    expect(
      yield* decodeQuery({ from: "attachments", fields: "title,path" }),
    ).toMatchObject({ from: "attachments", fields: ["title", "path"] });
    expect(yield* decodeSchemaArguments({ from: "attachments" })).toEqual({
      from: "attachments",
    });
  }),
);

it.effect.each(["items", "attachments", "annotations"])(
  "accepts key Projection Paths and sorting for %s",
  (from) =>
    Effect.gen(function* () {
      expect(
        yield* decodeQuery({
          from,
          fields: "indexedKey,key",
          sort: "indexedKey",
        }),
      ).toMatchObject({
        from,
        fields: ["indexedKey", "key"],
        sort: [{ field: "indexedKey", direction: "asc" }],
      });
    }),
);
