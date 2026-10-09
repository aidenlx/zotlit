import type { CliData } from "obsidian";
import { describe, expect, it } from "vitest";

import type { CliRequest } from "@/lib/cli-params";

import * as decode from "./decode";

/** The decoded value, or the diagnostic the handler answers with. */
const answered =
  <T>(decoder: (params: CliData) => CliRequest<T>) =>
  (params: CliData) => {
    const request = decoder(params);
    return request.kind === "valid"
      ? request.value
      : decode.rejectionDiagnostic(request);
  };

const decodeQuery = answered(decode.decodeQuery);
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
  it("gives the CLI defaults and leaves the Libraries to the Library Scope", () => {
    expect(decodeQuery({})).toStrictEqual({
      from: "items",
      libraries: null,
      limit: 100,
    });
  });

  it.each<CliData>([{}, { library: "personal", limit: "all" }])(
    "gives a plain JSON value without undefined keys for %j",
    (params) => {
      const query = decodeQuery(params);

      expect(JSON.parse(JSON.stringify(query))).toStrictEqual(query);
    },
  );

  it("gives a plain JSON value for every argument", () => {
    const query = decodeQuery({
      library: '["group:4815","personal"]',
      filter: "true",
      fields: '["title"]',
      sort: '[{"field":"title","direction":"asc"}]',
      limit: "3",
      output: "/exports/items.json",
      id: "export-a",
    });

    expect(JSON.parse(JSON.stringify(query))).toStrictEqual(query);
  });
});

describe("decodeQuery limit", () => {
  it("decodes a positive integer", () => {
    expect(decodeQuery({ limit: "3" })).toMatchObject({ limit: 3 });
  });

  it("decodes limit=all to null", () => {
    expect(decodeQuery({ limit: "all" })).toMatchObject({ limit: null });
  });

  it.each([
    "0",
    "-1",
    "1.5",
    "ten",
    "",
    "1e3",
    "unlimited",
    "99999999999999999999",
  ])("rejects limit=%j", (limit) => {
    expect(decodeQuery({ limit })).toMatchObject(rejected("limit"));
  });
});

describe("decodeQuery library", () => {
  it.each([
    ["personal", { type: "personal" }],
    ["group:4815", { type: "group", groupID: 4815 }],
  ])("names the Library of library=%s", (library, selector) => {
    expect(decodeQuery({ library })).toMatchObject({
      libraries: {
        scope: { mode: "selected", libraries: [selector] },
        parameter: "library",
      },
    });
  });

  it.each(["group:", "group:abc", "group:0", "My Library", "1"])(
    "rejects library=%j",
    (library) => {
      expect(decodeQuery({ library })).toMatchObject(rejected("library"));
    },
  );

  it("answers a malformed Library before a malformed option", () => {
    expect(decodeQuery({ library: "bad", limit: "0" })).toMatchObject(
      rejected("library"),
    );
    expect(decodeQuery({ library: "bad", limit: "0" })).toMatchObject(
      rejected("library"),
    );
  });
});

describe("decodeQuery libraries", () => {
  it("names the Libraries in the canonical order, whatever order the caller gives", () => {
    expect(
      decodeQuery({ library: '["group:4815","group:12","personal"]' }),
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
  });

  it("names every Library for libraries=all", () => {
    expect(decodeQuery({ library: "all" })).toMatchObject({
      libraries: { scope: { mode: "all" }, parameter: "library" },
    });
  });

  it.each([
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
  ])("rejects libraries with %s", (_name, library) => {
    expect(decodeQuery({ library })).toMatchObject(rejected("library"));
  });

  it("keeps the inner issue of a malformed Library selector", () => {
    const request = decode.decodeQuery({ library: '["My Library"]' });
    expect(request).toMatchObject({
      kind: "invalid",
      parameter: "library",
      issue: {
        path: "library[0]",
        expected: expect.any(String),
        received: expect.any(String),
      },
    });
    if (request.kind !== "invalid") throw new Error("Expected rejection");
    expect(decode.rejectionDiagnostic(request)).toMatchObject({
      code: "invalid-argument",
      found: '"My Library"',
      location: { path: "library[0]" },
    });
  });
});

describe("removed libraries parameter", () => {
  it.each(["all", "[]", "", "personal"])(
    "rejects libraries=%j even beside library",
    (libraries) => {
      expect(decodeQuery({ library: "personal", libraries })).toMatchObject({
        ...rejected("libraries"),
        message: expect.stringContaining("Unknown parameter 'libraries'"),
        hint: expect.stringContaining("Use library="),
      });
    },
  );
});

describe("decodeQuery fields, filter, and sort", () => {
  it("decodes the JSON arrays of fields and sort, and passes the filter through", () => {
    expect(
      decodeQuery({
        fields: '["title","custom[\\"a.b\\"]"]',
        filter: 'tags.contains("to-read")',
        sort: '[{"field":"title","direction":"asc"}]',
      }),
    ).toMatchObject({
      fields: ["title", 'custom["a.b"]'],
      filter: 'tags.contains("to-read")',
      sort: [{ field: "title", direction: "asc" }],
    });
  });

  it("decodes fields=[] to identity-only rows", () => {
    expect(decodeQuery({ fields: "[]" })).toMatchObject({ fields: [] });
  });

  it.each([
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
  ])("keeps the issue for sort with $name", ({ value, issue }) => {
    expect(decodeQuery({ sort: value })).toMatchObject({
      location: { path: issue.path },
      found: issue.received === "Object" ? value : issue.received,
    });
    expect(decode.decodeQuery({ sort: value })).toMatchObject({
      kind: "invalid",
      parameter: "sort",
      issue,
    });
  });

  it.each([
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
  ])("distinguishes fields with $name", ({ value, issue }) => {
    expect(decodeQuery({ fields: value })).toMatchObject({
      location: { path: issue.path },
      found: issue.received === "Object" ? value : issue.received,
    });
    expect(decode.decodeQuery({ fields: value })).toMatchObject({
      kind: "invalid",
      parameter: "fields",
      issue,
    });
  });

  it.each([
    ["fields", '["title"'],
    ["fields", "[1]"],
    ["filter", ""],
    ["filter", "   "],
    ["sort", '[{"field":"title"}]'],
    ["sort", '[{"field":"title","direction":"up"}]'],
  ])("rejects %s=%j", (parameter, value) => {
    expect(decodeQuery({ [parameter]: value })).toMatchObject(
      rejected(parameter),
    );
  });
});

describe("decodeQuery output", () => {
  it("decodes an absolute path", () => {
    expect(decodeQuery({ output: "/exports/items.json" })).toMatchObject({
      output: "/exports/items.json",
    });
  });

  it.each(["relative.json", "/exports/a\0b.json"])(
    "rejects output=%j",
    (output) => {
      expect(decodeQuery({ output })).toMatchObject(rejected("output"));
    },
  );
});

describe("decodeQuery parameters", () => {
  it("rejects an undeclared parameter", () => {
    expect(decodeQuery({ fields: "[]", colour: "red" })).toMatchObject(
      rejected("colour"),
    );
  });

  it("keeps received parameter order for a shell-split filter", () => {
    const params = { filter: "itemType", "==": "true", '"book"': "true" };
    expect(decode.decodeQuery(params)).toMatchObject({
      kind: "invalid",
      parameter: "==",
      received: Object.entries(params),
      shellSplit: true,
    });
    expect(decodeQuery(params)).toMatchObject({
      ...rejected("=="),
      suggestions: ["filter='itemType == \"book\"'"],
    });
  });

  it("rejects a vault parameter after the command name", () => {
    expect(decodeQuery({ vault: "Research" })).toMatchObject(rejected("vault"));
  });

  it.each(["filter", "limit"])("rejects --%s", (parameter) => {
    expect(decodeQuery({ [`--${parameter}`]: "1" })).toMatchObject(
      rejected(`--${parameter}`),
    );
  });

  it("rejects a malformed switch beside a valid parameter", () => {
    expect(decodeQuery({ limit: "1", "--filter": "true" })).toMatchObject(
      rejected("--filter"),
    );
  });

  it.each(["--unknown", "--help", "--verbose"])(
    "rejects unsupported switch %s",
    (key) => {
      expect(decodeQuery({ [key]: "true" })).toMatchObject({
        ...rejected(key),
      });
    },
  );

  it("decodes a query ID", () => {
    expect(decodeQuery({ id: "export-2024.v1_a" })).toMatchObject({
      id: "export-2024.v1_a",
    });
  });

  it.each(["", "two words", "a/b", "x".repeat(129)])(
    "rejects the query ID %j",
    (id) => {
      expect(decodeQuery({ id })).toMatchObject(rejected("id"));
    },
  );
});

describe("decodeSchemaArguments", () => {
  it("accepts no parameter", () => {
    expect(decodeSchemaArguments({})).toStrictEqual({});
  });

  it.each<[CliData, string]>([
    [{ library: "personal" }, "library"],
    [{ vault: "Research" }, "vault"],
    [{ "--limit": "1" }, "--limit"],
  ])("rejects %j", (params, parameter) => {
    expect(decodeSchemaArguments(params)).toMatchObject(rejected(parameter));
  });
});

describe("decodeGuideArguments and decodeCancelArguments", () => {
  it.each([
    [decodeGuideArguments, "topic", "filter"],
    [decodeCancelArguments, "id", "export-a"],
  ])("rejects --%s", (decode, parameter, value) => {
    expect(decode({ [`--${parameter}`]: value })).toMatchObject({
      ...rejected(`--${parameter}`),
    });
  });

  it("decodes the guide topic, or null for the quickstart", () => {
    expect(decodeGuideArguments({ topic: "filter" })).toBe("filter");
    expect(decodeGuideArguments({})).toBeNull();
    expect(decodeGuideArguments({ topic: "nope" })).toMatchObject(
      rejected("topic"),
    );
  });

  it.each<CliData>([{}, { id: "two words" }])(
    "rejects the cancel arguments %j",
    (params) => {
      expect(decodeCancelArguments(params)).toMatchObject(rejected("id"));
    },
  );
});

it("renders decoder issue data and the recovery action in contract v3", () => {
  const rejection = decode.decodeQuery({
    sort: '[{"field":"title","direction":"ascending"}]',
  });
  if (rejection.kind !== "invalid") throw new Error("Expected rejection");
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
});

it("reconstructs the real empty-key shell split without inventing removed quotes", () => {
  const params = { filter: "itemType", "": "=", book: "true", limit: "5" };
  const rejection = decode.decodeQuery(params);
  expect(rejection).toMatchObject({
    kind: "invalid",
    parameter: "",
    received: Object.entries(params),
    shellSplit: true,
  });
  expect(decodeQuery(params)).toMatchObject({
    suggestions: ["filter='itemType == book'"],
  });
});

it("preserves received quote characters in a reconstructed shell argument", () => {
  const params = { filter: "title", "": "=", '"O\'Brien"': "true" };
  expect(decodeQuery(params)).toMatchObject({
    suggestions: ["filter='title == \"O'\"'\"'Brien\"'"],
  });
});

const decodeAnnotationQuery = answered((params) =>
  decode.decodeQuery({ ...params, from: "annotations" }),
);
// Failure modes: selectors still resolve Libraries, or their rejection omits recovery.
it.each([
  ["items", "item", "indexedKey"],
  ["items", "attachment", "indexedKey"],
  ["annotations", "item", "item.indexedKey"],
  ["annotations", "attachment", "attachment.indexedKey"],
])("rejects %s %s with filter selection guidance", (from, parameter, field) => {
  const diagnostic = decodeQuery({
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
});

it.each([
  [{ fields: '["text", 3]' }, "fields", "fields[1]"],
  [
    { sort: '[{"field":"pageIndex","direction":"ascending"}]' },
    "sort",
    "sort[0].direction",
  ],
] as const)(
  "preserves Annotation JSON issue locations for %j",
  (params, argument, path) => {
    expect(decodeAnnotationQuery(params)).toMatchObject({
      code: "invalid-argument",
      location: { argument, path },
      found: expect.any(String),
      expected: expect.any(Array),
    });
  },
);

it("preserves shell-split evidence for Annotation filters", () => {
  const request = decode.decodeQuery({
    from: "annotations",
    filter: "tags",
    "==": "true",
    '"figure"': "true",
  });
  expect(request).toMatchObject({ kind: "invalid", shellSplit: true });
  expect(
    decodeAnnotationQuery({ filter: "tags", "==": "true", '"figure"': "true" }),
  ).toMatchObject({
    code: "invalid-argument",
    suggestions: ["filter='tags == \"figure\"'"],
  });
});

it("keeps Target Libraries independent of an Annotation key filter", () => {
  expect(
    decodeAnnotationQuery({
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
});

it("decodes comma lists with quoted commas and the effective Query Dataset", () => {
  expect(
    decodeQuery({
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
});

it.each(["attachments", "unknown"])(
  "rejects unavailable Query Dataset %s with available datasets",
  (from) => {
    expect(decodeQuery({ from })).toMatchObject({
      ...rejected("from"),
      expected: ["items", "annotations"],
      report: expect.arrayContaining([
        expect.stringContaining("items, annotations"),
      ]),
    });
  },
);
it.each(["fields", "sort", "library"])(
  "points at an empty %s comma-list element",
  (parameter) => {
    for (const value of ["title,,date", "title,"]) {
      const result = decodeQuery({ [parameter]: value });
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
  },
);
it("accepts equivalent field and sort forms", () => {
  expect(decodeQuery({ fields: "title,date.year" })).toEqual(
    decodeQuery({ fields: '["title","date.year"]' }),
  );
  expect(decodeQuery({ sort: "-date,title" })).toEqual(
    decodeQuery({
      sort: '[{"field":"date","direction":"desc"},{"field":"title","direction":"asc"}]',
    }),
  );
  expect(decodeQuery({ sort: "+title" })).toEqual(
    decodeQuery({ sort: "title" }),
  );
});
it.each([
  'custom["a,b"],title',
  "custom['a,b'],title",
  '"a,b",title',
  "'a,b',title",
  'custom["a\\\"b,c"],title',
])("keeps quoted commas in %s", (fields) => {
  expect(decodeQuery({ fields })).toMatchObject({
    fields: [fields.slice(0, -6), "title"],
  });
});
it("narrows the schema to the requested Query Dataset", () => {
  expect(decodeSchemaArguments({ from: "annotations" })).toEqual({
    from: "annotations",
  });
});

it("decodes one group Projection Path and preserves custom-field punctuation", () => {
  expect(decodeQuery({ group: 'custom["review,status"]' })).toEqual({
    from: "items",
    libraries: null,
    limit: 100,
    group: 'custom["review,status"]',
  });
  expect(decodeQuery({ group: "" })).toMatchObject(rejected("group"));
});
