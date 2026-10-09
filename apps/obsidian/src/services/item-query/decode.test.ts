import type { CliData } from "obsidian";
import { describe, expect, it } from "vitest";

import {
  decodeItemQuery,
  decodeAnnotationQuery,
  decodeSchemaArguments,
  rejectParameters,
} from "./decode";

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

  it("explains a vault parameter after the command name", () => {
    expect(decodeItemQuery({ vault: "Research" })).toMatchObject({
      ...rejected("vault"),
      message: expect.stringContaining("before the command name"),
    });
  });

  it("allows Obsidian's --copy switch", () => {
    expect(decodeItemQuery({ "--copy": "true", limit: "1" })).toMatchObject({
      limit: 1,
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
  it("accepts no parameter, and Obsidian's own -- tokens", () => {
    expect(decodeSchemaArguments({})).toBeNull();
    expect(decodeSchemaArguments({ "--copy": "true" })).toBeNull();
  });

  it.each<[CliData, string]>([
    [{ library: "personal" }, "library"],
    [{ vault: "Research" }, "vault"],
    [{ "--limit": "1" }, "--limit"],
  ])("rejects %j", (params, parameter) => {
    expect(decodeSchemaArguments(params)).toMatchObject(rejected(parameter));
  });
});

describe("rejectParameters for guide and cancel", () => {
  it.each([
    ["topic", "filter"],
    ["id", "export-a"],
  ])("rejects --%s and shows the accepted form", (parameter, value) => {
    expect(
      rejectParameters({ [`--${parameter}`]: value }, [parameter]),
    ).toMatchObject({
      ...rejected(`--${parameter}`),
      message: expect.stringContaining(`${parameter}=<value>`),
    });
  });
});

describe("decodeAnnotationQuery", () => {
  it("infers Libraries from Item keys and keeps the worker request JSON-only", () => {
    const decoded = decodeAnnotationQuery({
      item: '["ART2FULLg4815","ART2FULL"]',
      fields: "[]",
    });
    expect(decoded).toEqual({
      kind: "annotations",
      item: ["ART2FULLg4815", "ART2FULL"],
      libraries: {
        scope: {
          mode: "selected",
          libraries: [{ type: "personal" }, { type: "group", groupID: 4815 }],
        },
        parameter: "item",
      },
      fields: [],
      limit: 100,
    });
    expect(JSON.parse(JSON.stringify(decoded))).toEqual(decoded);
  });
  it.each<CliData>([
    { item: "ART2FULL", library: "personal" },
    { item: "ART2FULL", libraries: "all" },
    { item: "invalid" },
    { attachment: "[]" },
  ])("rejects a malformed key or key/Library conflict: %j", (params) => {
    expect(decodeAnnotationQuery(params)).toMatchObject({
      code: "invalid-argument",
    });
  });
});
