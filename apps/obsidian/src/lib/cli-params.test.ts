import * as v from "valibot";
import { describe, expect, it } from "vitest";

import {
  cliMaybeEmpty,
  cliNotApplicable,
  cliOneOf,
  cliParams,
  cliSwitch,
  cliText,
  cliValue,
  cliVariants,
  decodeCliParams,
} from "./cli-params";
import type { CliParamName } from "./cli-params";

const pick = v.pipe(
  v.strictObject({
    key: v.optional(v.pipe(v.string(), v.regex(/^[A-Z]+$/, "key is upper."))),
    count: v.optional(
      v.pipe(
        v.string(),
        v.regex(/^\d+$/, (issue) => `count '${issue.input}' is no number.`),
        v.transform(Number),
      ),
      "1",
    ),
    full: cliSwitch("Use the full flag."),
  }),
  v.forward(
    v.partialCheck(
      [["key"], ["full"]],
      (input) => !(input.key !== undefined && input.full),
      "Use key or full, not both.",
    ),
    ["full"],
  ),
);

const decode = (params: Record<string, string>) =>
  decodeCliParams(params, pick, { command: "pick" });

describe("decodeCliParams", () => {
  it("decodes the declared parameters through the schema", () => {
    expect(decode({ key: "AB", count: "3" })).toStrictEqual({
      kind: "valid",
      value: { key: "AB", count: 3 },
    });
    expect(decode({})).toStrictEqual({
      kind: "valid",
      value: { count: 1 },
    });
  });

  it.each(["true", ""])("decodes the switch given as %j", (full) => {
    expect(decode({ full })).toMatchObject({ value: { full: true } });
  });

  it("answers the first schema issue in entry order, with its message", () => {
    expect(decode({ count: "x", key: "ab" })).toMatchObject({
      kind: "invalid",
      parameter: "key",
      message: "key is upper.",
      issue: {
        path: "key",
        expected: "/^[A-Z]+$/",
        received: '"ab"',
      },
    });
    expect(decode({ count: "x" })).toMatchObject({
      kind: "invalid",
      parameter: "count",
      message: "count 'x' is no number.",
      issue: {
        path: "count",
        expected: "/^\\d+$/",
        received: '"x"',
      },
    });
  });

  it("keeps the path, expected form, and received value of the first schema issue", () => {
    const nested = cliParams({
      options: v.pipe(
        v.string(),
        v.parseJson(),
        v.object({ direction: v.picklist(["asc", "desc"]) }),
      ),
    });

    expect(
      decodeCliParams({ options: '{"direction":"ascending"}' }, nested, {
        command: "nested",
      }),
    ).toMatchObject({
      kind: "invalid",
      parameter: "options",
      issue: {
        path: "options.direction",
        expected: '("asc" | "desc")',
        received: '"ascending"',
      },
    });
  });

  it("answers a rule between parameters at the parameter it forwards to", () => {
    expect(decode({ key: "AB", full: "true" })).toMatchObject({
      kind: "invalid",
      parameter: "full",
      message: "Use key or full, not both.",
      issue: {
        path: "full",
        expected: "Use key or full, not both.",
        received: "Object",
      },
    });
  });

  it("rejects an empty value, and a switch with a value", () => {
    expect(decode({ count: "" })).toMatchObject({
      parameter: "count",
      message: "count requires a value.",
    });
    expect(decode({ full: "no" })).toMatchObject({
      parameter: "full",
      message: "Use the full flag.",
    });
  });

  it("rejects an undeclared parameter before any value", () => {
    expect(decode({ count: "", colour: "red" })).toStrictEqual({
      kind: "invalid",
      parameter: "colour",
      message:
        "Unknown parameter 'colour' for pick. Accepted parameters: key, count, full.",
    });
  });

  it.each(["==", '"value"', "[value]"])(
    "explains an unknown %s parameter as a shell-split value",
    (split) => {
      expect(decode({ key: "AB", [split]: "true", count: "3" })).toMatchObject({
        kind: "invalid",
        parameter: split,
        message: `Unknown parameter '${split}': Obsidian received these parameters in order: key, ${split}, count.`,
        hint: "Quote the whole value as one shell argument.",
      });
    },
  );

  it("answers the misplaced message of a parameter of another command", () => {
    expect(
      decodeCliParams({ root: "item" }, pick, {
        command: "pick",
        misplaced: { root: "root belongs to pick-root." },
      }),
    ).toMatchObject({
      parameter: "root",
      message: "root belongs to pick-root.",
    });
  });

  it("explains a vault after the command name", () => {
    expect(decode({ vault: "Research" })).toMatchObject({
      parameter: "vault",
      message: expect.stringContaining("before the command name"),
    });
  });

  it.each([
    ["--key", "key=<value>"],
    ["--full", "full"],
  ])("rejects %s and gives the accepted form", (token, form) => {
    expect(decode({ [token]: "true" })).toStrictEqual({
      kind: "invalid",
      parameter: token,
      message: `Parameter '${token}' is not valid: use ${form}.`,
      hint: `Run the command with ${form}, without --.`,
    });
  });

  it("rejects an unsupported -- token", () => {
    expect(decode({ "--verbose": "true" })).toMatchObject({
      parameter: "--verbose",
      hint: expect.stringContaining("name=value"),
    });
  });

  it("rejects any parameter of a command that takes none", () => {
    const none = v.strictObject({});
    expect(
      decodeCliParams({ a: "1" }, none, { command: "none" }),
    ).toMatchObject({
      parameter: "a",
      message: "Unknown parameter 'a': none takes no parameters.",
    });
    expect(
      decodeCliParams({ "--a": "true" }, none, { command: "none" }),
    ).toMatchObject({ hint: "Remove '--a'; none takes no parameters." });
    expect(decodeCliParams({}, none, { command: "none" })).toStrictEqual({
      kind: "valid",
      value: {},
    });
  });

  it("fails loudly on a schema issue that names no parameter", () => {
    const unforwarded = v.pipe(
      v.strictObject({ a: v.optional(v.string()) }),
      v.check(() => false, "never"),
    );
    expect(() =>
      decodeCliParams({ a: "1" }, unforwarded, { command: "bad" }),
    ).toThrow(/without a parameter/);
  });
});

describe("cliParams", () => {
  const required = cliParams(
    { id: v.string(), name: v.string(), note: v.optional(v.string()) },
    { id: "id names the query to cancel." },
  );

  it("answers the message of a required parameter the caller omits", () => {
    expect(
      decodeCliParams({ name: "a" }, required, { command: "cancel" }),
    ).toMatchObject({
      parameter: "id",
      message: "id names the query to cancel.",
    });
    expect(
      decodeCliParams({ id: "a" }, required, { command: "cancel" }),
    ).toMatchObject({ parameter: "name", message: "name is required." });
  });
});

describe("cliValue", () => {
  const keyed = cliParams({ key: v.optional(cliValue("key")) });

  it("answers a bare parameter as one that needs a value", () => {
    expect(
      decodeCliParams({ key: "true" }, keyed, { command: "keyed" }),
    ).toMatchObject({ parameter: "key", message: "key requires a value." });
    expect(
      decodeCliParams({ key: "ABCD2345" }, keyed, { command: "keyed" }),
    ).toMatchObject({ value: { key: "ABCD2345" } });
  });
});

describe("cliMaybeEmpty and cliText", () => {
  const texts = cliParams({
    existing: cliMaybeEmpty(),
    note: v.optional(cliText("note must contain text.")),
  });

  it("decodes an empty value where the parameter takes one", () => {
    expect(
      decodeCliParams({ existing: "" }, texts, { command: "texts" }),
    ).toStrictEqual({ kind: "valid", value: { existing: "" } });
  });

  it("rejects blank text with the parameter's message", () => {
    expect(
      decodeCliParams({ note: "  " }, texts, { command: "texts" }),
    ).toMatchObject({ parameter: "note", message: "note must contain text." });
  });
});

describe("cliVariants", () => {
  const NOT_PARTIAL = "root applies to template=partial:<name> only.";
  const render = cliVariants(
    ({ template }) => (template?.startsWith("partial:") ? "partial" : "slot"),
    {
      slot: v.pipe(
        cliParams({
          template: v.picklist(["note"], "template must be 'note'."),
          root: cliNotApplicable(NOT_PARTIAL),
        }),
        v.transform(({ template }) => ({ template })),
      ),
      partial: v.pipe(
        cliParams({
          template: v.string(),
          root: v.optional(
            v.picklist(["item"], "root must be 'item'."),
            "item",
          ),
        }),
        v.transform(({ template, root }) => ({ template, root })),
      ),
    },
  );
  const decode = (params: Record<string, string>) =>
    decodeCliParams(params, render, { command: "render" });

  it("accepts the parameters of every variant", () => {
    const names = { template: true, root: true } satisfies Record<
      CliParamName<typeof render>,
      true
    >;
    expect(decode({ colour: "red" })).toMatchObject({
      message: `Unknown parameter 'colour' for render. Accepted parameters: ${Object.keys(names).join(", ")}.`,
    });
  });

  it("decodes each variant into its branch of the request", () => {
    expect(decode({ template: "note" })).toStrictEqual({
      kind: "valid",
      value: { template: "note" },
    });
    expect(decode({ template: "partial:a" })).toStrictEqual({
      kind: "valid",
      value: { template: "partial:a", root: "item" },
    });
  });

  it("answers a parameter of another variant once the variant's own are valid", () => {
    expect(decode({ template: "note", root: "nope" })).toMatchObject({
      kind: "invalid",
      parameter: "root",
      message: NOT_PARTIAL,
      issue: { path: "root", expected: "never", received: '"nope"' },
    });
    expect(decode({ template: "bogus", root: "item" })).toMatchObject({
      parameter: "template",
      message: "template must be 'note'.",
    });
  });

  it("checks a parameter's value in the variant it applies to", () => {
    expect(decode({ template: "partial:a", root: "nope" })).toMatchObject({
      parameter: "root",
      message: "root must be 'item'.",
    });
  });
});

describe("cliOneOf", () => {
  const select = v.pipe(
    cliParams({
      note: v.optional(v.string()),
      profile: v.optional(v.string()),
      document: v.optional(v.string()),
    }),
    cliOneOf(["note", "profile", "document"], {
      many: "Select one target.",
      none: "Select a target.",
    }),
  );
  const decode = (params: Record<string, string>) =>
    decodeCliParams(params, select, { command: "inspect" });

  it("names the second selector given", () => {
    expect(decode({ note: "a", profile: "b" })).toMatchObject({
      kind: "invalid",
      parameter: "profile",
      message: "Select one target.",
      issue: {
        path: "profile",
        expected: "Select one target.",
        received: "Object",
      },
    });
    expect(decode({ profile: "b", document: "c" })).toMatchObject({
      parameter: "document",
    });
  });

  it("names the first selector when the caller gives none", () => {
    expect(decode({})).toMatchObject({
      parameter: "note",
      message: "Select a target.",
    });
  });

  it("accepts one selector", () => {
    expect(decode({ document: "c" })).toStrictEqual({
      kind: "valid",
      value: { document: "c" },
    });
  });
});

describe("cliNotApplicable", () => {
  it("leaves the form of the parameter to the variant it applies to", () => {
    const check = cliVariants(
      ({ attempt }) => (attempt === undefined ? "run" : "lookup"),
      {
        run: cliParams({ existing: cliMaybeEmpty(), full: cliSwitch("x") }),
        lookup: cliParams({
          attempt: v.string(),
          existing: cliNotApplicable("lookup only."),
          full: cliNotApplicable("lookup only."),
        }),
      },
    );
    const decode = (params: Record<string, string>) =>
      decodeCliParams(params, check, { command: "check" });

    expect(decode({ existing: "" })).toStrictEqual({
      kind: "valid",
      value: { existing: "" },
    });
    expect(decode({ "--full": "true" })).toMatchObject({
      message: "Parameter '--full' is not valid: use full.",
    });
  });

  const render = cliParams({
    template: v.picklist(["note"], "template must be 'note'."),
    root: cliNotApplicable("root applies to partials only."),
    key: v.string(),
  });
  const decode = (params: Record<string, string>) =>
    decodeCliParams(params, render, { command: "render" });

  it("answers in the order of the entries", () => {
    expect(decode({ template: "bogus", root: "item" })).toMatchObject({
      parameter: "template",
    });
    expect(decode({ template: "note", root: "item" })).toMatchObject({
      kind: "invalid",
      parameter: "root",
      message: "root applies to partials only.",
      issue: { path: "root", expected: "never", received: '"item"' },
    });
  });

  it("accepts the request without the parameter", () => {
    expect(decode({ template: "note", key: "K" })).toStrictEqual({
      kind: "valid",
      value: { template: "note", key: "K" },
    });
  });
});
