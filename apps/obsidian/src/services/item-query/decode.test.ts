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

const decodeItemQuery = answered(decode.decodeItemQuery);
const decodeGuideArguments = answered(decode.decodeGuideArguments);
const decodeCancelArguments = answered(decode.decodeCancelArguments);
const decodeSchemaArguments = answered(decode.decodeSchemaArguments);

/** The diagnostic of an argument that the decoder rejects. */
const rejected = (parameter: string) => ({
  code: "invalid-argument",
  hint: expect.any(String),
  details: { parameter },
});

describe("decodeItemQuery without arguments", () => {
  it("gives the CLI defaults and leaves the Libraries to the Library Scope", () => {
    expect(decodeItemQuery({})).toStrictEqual({ libraries: null, limit: 100 });
  });

  it.each<CliData>([{}, { library: "personal", limit: "all" }])(
    "gives a plain JSON value without undefined keys for %j",
    (params) => {
      const query = decodeItemQuery(params);

      expect(JSON.parse(JSON.stringify(query))).toStrictEqual(query);
    },
  );

  it("gives a plain JSON value for every argument", () => {
    const query = decodeItemQuery({
      libraries: '["group:4815","personal"]',
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

describe("decodeItemQuery limit", () => {
  it("decodes a positive integer", () => {
    expect(decodeItemQuery({ limit: "3" })).toMatchObject({ limit: 3 });
  });

  it("decodes limit=all to null", () => {
    expect(decodeItemQuery({ limit: "all" })).toMatchObject({ limit: null });
  });

  it.each(["0", "-1", "1.5", "ten", "", "1e3", "99999999999999999999"])(
    "rejects limit=%j",
    (limit) => {
      expect(decodeItemQuery({ limit })).toMatchObject(rejected("limit"));
    },
  );
});

describe("decodeItemQuery library", () => {
  it.each([
    ["personal", { type: "personal" }],
    ["group:4815", { type: "group", groupID: 4815 }],
  ])("names the Library of library=%s", (library, selector) => {
    expect(decodeItemQuery({ library })).toMatchObject({
      libraries: {
        scope: { mode: "selected", libraries: [selector] },
        parameter: "library",
      },
    });
  });

  it.each(["group:", "group:abc", "group:0", "My Library", "1", "all"])(
    "rejects library=%j",
    (library) => {
      expect(decodeItemQuery({ library })).toMatchObject(rejected("library"));
    },
  );

  it("answers a malformed Library before a malformed option", () => {
    expect(decodeItemQuery({ library: "bad", limit: "0" })).toMatchObject(
      rejected("library"),
    );
    expect(decodeItemQuery({ libraries: "bad", limit: "0" })).toMatchObject(
      rejected("libraries"),
    );
  });
});

describe("decodeItemQuery libraries", () => {
  it("names the Libraries in the canonical order, whatever order the caller gives", () => {
    expect(
      decodeItemQuery({ libraries: '["group:4815","group:12","personal"]' }),
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
        parameter: "libraries",
      },
    });
  });

  it("names every Library for libraries=all", () => {
    expect(decodeItemQuery({ libraries: "all" })).toMatchObject({
      libraries: { scope: { mode: "all" }, parameter: "libraries" },
    });
  });

  it.each([
    ["no JSON", "personal"],
    ["no array", '"personal"'],
    ["an empty array", "[]"],
    ["a selector that is no text", "[1]"],
    ["a selector object", '[{"type":"personal"}]'],
    ["an unknown selector", '["My Library"]'],
    ["a group without a positive ID", '["group:0"]'],
    ["the word all inside the array", '["all"]'],
    ["a Library twice", '["personal","personal"]'],
    ["a group twice", '["group:4815","personal","group:4815"]'],
  ])("rejects libraries with %s", (_name, libraries) => {
    expect(decodeItemQuery({ libraries })).toMatchObject(rejected("libraries"));
  });

  it("keeps the inner issue of a malformed Library selector", () => {
    expect(
      decode.decodeItemQuery({ libraries: '["My Library"]' }),
    ).toMatchObject({
      kind: "invalid",
      parameter: "libraries",
      message:
        '\'My Library\' in libraries is not a Library: use "personal" or "group:<groupID>".',
      issue: {
        path: "libraries[0]",
        expected: expect.any(String),
        received: expect.any(String),
      },
    });
  });
});

describe("decodeItemQuery library and libraries together", () => {
  it("names the Libraries of libraries and ignores library", () => {
    expect(
      decodeItemQuery({ library: "personal", libraries: '["group:4815"]' }),
    ).toMatchObject({
      libraries: {
        scope: {
          mode: "selected",
          libraries: [{ type: "group", groupID: 4815 }],
        },
        parameter: "libraries",
      },
    });
  });

  it.each(["group:999", "My Library"])(
    "ignores library=%j beside libraries=all",
    (library) => {
      expect(decodeItemQuery({ library, libraries: "all" })).toMatchObject({
        libraries: { scope: { mode: "all" }, parameter: "libraries" },
      });
    },
  );

  it("ignores an empty library beside libraries=all", () => {
    expect(decodeItemQuery({ library: "", libraries: "all" })).toMatchObject({
      libraries: { scope: { mode: "all" }, parameter: "libraries" },
    });
  });

  it("answers the diagnostic of a malformed libraries beside a valid library", () => {
    expect(
      decodeItemQuery({ library: "personal", libraries: "[]" }),
    ).toMatchObject(rejected("libraries"));
  });
});

describe("decodeItemQuery fields, filter, and sort", () => {
  it("decodes the JSON arrays of fields and sort, and passes the filter through", () => {
    expect(
      decodeItemQuery({
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
    expect(decodeItemQuery({ fields: "[]" })).toMatchObject({ fields: [] });
  });

  it.each([
    {
      name: "an unknown direction",
      value: '[{"field":"title","direction":"ascending"}]',
      message:
        'Invalid type: Expected ("asc" | "desc") but received "ascending"',
      issue: {
        path: "sort[0].direction",
        expected: '("asc" | "desc")',
        received: '"ascending"',
      },
    },
    {
      name: "a missing direction",
      value: '[{"field":"title"}]',
      message: 'Invalid key: Expected "direction" but received undefined',
      issue: {
        path: "sort[0].direction",
        expected: '"direction"',
        received: "undefined",
      },
    },
    {
      name: "an object instead of an array",
      value: '{"field":"title","direction":"asc"}',
      message: "Invalid type: Expected Array but received Object",
      issue: { path: "sort", expected: "Array", received: "Object" },
    },
  ])("keeps the issue for sort with $name", ({ value, message, issue }) => {
    expect(decode.decodeItemQuery({ sort: value })).toMatchObject({
      kind: "invalid",
      parameter: "sort",
      message,
      issue,
    });
  });

  it.each([
    {
      name: "text that is not JSON",
      value: "title,date",
      message:
        "fields is not valid JSON: use a JSON array of Projection Path strings.",
      issue: {
        path: "fields",
        expected: "JSON",
        received: expect.any(String),
      },
    },
    {
      name: "a non-text array entry",
      value: '["title",5]',
      message: "Invalid type: Expected string but received 5",
      issue: { path: "fields[1]", expected: "string", received: "5" },
    },
  ])("distinguishes fields with $name", ({ value, message, issue }) => {
    expect(decode.decodeItemQuery({ fields: value })).toMatchObject({
      kind: "invalid",
      parameter: "fields",
      message,
      issue,
    });
  });

  it.each([
    ["fields", '["title"'],
    ["fields", '"title"'],
    ["fields", "[1]"],
    ["fields", '{"0":"title"}'],
    ["filter", ""],
    ["filter", "   "],
    ["sort", "not json"],
    ["sort", '[{"field":"title"}]'],
    ["sort", '[{"field":"title","direction":"up"}]'],
    ["sort", '{"field":"title","direction":"asc"}'],
  ])("rejects %s=%j", (parameter, value) => {
    expect(decodeItemQuery({ [parameter]: value })).toMatchObject(
      rejected(parameter),
    );
  });
});

describe("decodeItemQuery output", () => {
  it("decodes an absolute path", () => {
    expect(decodeItemQuery({ output: "/exports/items.json" })).toMatchObject({
      output: "/exports/items.json",
    });
  });

  it.each(["relative.json", "/exports/a\0b.json"])(
    "rejects output=%j",
    (output) => {
      expect(decodeItemQuery({ output })).toMatchObject(rejected("output"));
    },
  );
});

describe("decodeItemQuery parameters", () => {
  it("rejects an undeclared parameter", () => {
    expect(decodeItemQuery({ fields: "[]", colour: "red" })).toMatchObject(
      rejected("colour"),
    );
  });

  it("explains a shell-split filter from the received parameter order", () => {
    expect(
      decodeItemQuery({ filter: "itemType", "==": "true", '"book"': "true" }),
    ).toMatchObject({
      ...rejected("=="),
      message:
        "Unknown parameter '==': Obsidian received these parameters in order: filter, ==, \"book\".",
      hint: "Quote the whole value as one shell argument.",
    });
  });

  it("explains a vault parameter after the command name", () => {
    expect(decodeItemQuery({ vault: "Research" })).toMatchObject({
      ...rejected("vault"),
      message: expect.stringContaining("before the command name"),
    });
  });

  it.each(["filter", "limit"])(
    "rejects --%s and explains the key=value form",
    (parameter) => {
      const result = decodeItemQuery({ [`--${parameter}`]: "1" });

      expect(result).toMatchObject({
        ...rejected(`--${parameter}`),
        message: expect.stringContaining(`${parameter}=<value>`),
        hint: expect.stringContaining(`${parameter}=<value>`),
      });
    },
  );

  it("rejects a malformed switch beside a valid parameter", () => {
    expect(decodeItemQuery({ limit: "1", "--filter": "true" })).toMatchObject(
      rejected("--filter"),
    );
  });

  it.each(["--unknown", "--help", "--verbose"])(
    "rejects unsupported switch %s",
    (key) => {
      expect(decodeItemQuery({ [key]: "true" })).toMatchObject({
        ...rejected(key),
        hint: expect.stringContaining("name=value"),
      });
    },
  );

  it("decodes a query ID", () => {
    expect(decodeItemQuery({ id: "export-2024.v1_a" })).toMatchObject({
      id: "export-2024.v1_a",
    });
  });

  it.each(["", "two words", "a/b", "x".repeat(129)])(
    "rejects the query ID %j",
    (id) => {
      expect(decodeItemQuery({ id })).toMatchObject(rejected("id"));
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
  ])("rejects --%s and shows the accepted form", (decode, parameter, value) => {
    expect(decode({ [`--${parameter}`]: value })).toMatchObject({
      ...rejected(`--${parameter}`),
      message: expect.stringContaining(`${parameter}=<value>`),
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
