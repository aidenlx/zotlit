import { it } from "@effect/vitest";
import { Cause, Effect, Exit, Schema } from "effect";
import { describe, expect } from "vitest";

import {
  cliDefault,
  cliIndexedKey,
  cliLiterals,
  cliJson,
  cliMap,
  cliMaybeEmpty,
  cliNotApplicable,
  cliOneOf,
  cliParams,
  cliRule,
  cliSwitch,
  cliText,
  cliValue,
  cliVariants,
  decodeCliParams,
} from "./cli-params";
import type { CliParamName } from "./cli-params";

const pick = cliParams({
  key: Schema.optionalKey(
    Schema.String.check(
      Schema.isPattern(/^[A-Z]+$/, { message: "key is upper." }),
    ),
  ),
  count: cliDefault(
    Schema.String.check(
      Schema.makeFilter(
        (text: string) => /^\d+$/.test(text) || `count '${text}' is no number.`,
      ),
    ).pipe(cliMap(Number)),
    "1",
  ),
  full: cliSwitch("Use the full flag."),
}).check(
  cliRule(
    "full",
    (input: { key?: string; full?: true }) =>
      !(input.key !== undefined && input.full),
    "Use key or full, not both.",
  ),
);

const decode = (params: Record<string, string>) =>
  decodeCliParams(params, pick, { command: "pick" });
const reject = (params: Record<string, string>) => Effect.flip(decode(params));

describe("decodeCliParams", () => {
  it.effect("decodes the declared parameters through the schema", () =>
    Effect.gen(function* () {
      expect(yield* decode({ key: "AB", count: "3" })).toStrictEqual({
        key: "AB",
        count: 3,
      });
      expect(yield* decode({})).toStrictEqual({ count: 1 });
    }),
  );

  it.effect.each(["true", ""])("decodes the switch given as %j", (full) =>
    Effect.gen(function* () {
      expect(yield* decode({ full })).toMatchObject({ full: true });
    }),
  );

  it.effect(
    "answers the first schema issue in field order, with its message",
    () =>
      Effect.gen(function* () {
        expect(yield* reject({ count: "x", key: "ab" })).toMatchObject({
          parameter: "key",
          message: "key is upper.",
          issue: { path: "key", received: '"ab"' },
        });
        expect(yield* reject({ count: "x" })).toMatchObject({
          parameter: "count",
          message: "count 'x' is no number.",
          issue: {
            path: "count",
            expected: "count 'x' is no number.",
            received: '"x"',
          },
        });
      }),
  );

  it.effect(
    "keeps the path, expected form, and received value of the first schema issue",
    () =>
      Effect.gen(function* () {
        const nested = cliParams({
          options: cliJson(
            "options is not valid JSON.",
            Schema.Struct({
              direction: cliLiterals(["asc", "desc"], "Use asc or desc."),
            }),
          ),
        });

        expect(
          yield* Effect.flip(
            decodeCliParams({ options: '{"direction":"ascending"}' }, nested, {
              command: "nested",
            }),
          ),
        ).toMatchObject({
          parameter: "options",
          message: "Use asc or desc.",
          issue: {
            path: "options.direction",
            keys: ["direction"],
            received: '"ascending"',
            allowed: ["asc", "desc"],
          },
        });
        expect(
          yield* Effect.flip(
            decodeCliParams({ options: "{" }, nested, { command: "nested" }),
          ),
        ).toMatchObject({
          parameter: "options",
          message: "options is not valid JSON.",
          issue: { path: "options", expected: "JSON", received: '"{"' },
        });
      }),
  );

  it.effect("answers a rule between parameters at the parameter it names", () =>
    Effect.gen(function* () {
      expect(yield* reject({ key: "AB", full: "true" })).toMatchObject({
        parameter: "full",
        message: "Use key or full, not both.",
        issue: {
          path: "full",
          expected: "Use key or full, not both.",
          received: "Object",
        },
      });
    }),
  );

  it.effect("rejects an empty value, and a switch with a value", () =>
    Effect.gen(function* () {
      expect(yield* reject({ count: "" })).toMatchObject({
        parameter: "count",
        message: "count requires a value.",
      });
      expect(yield* reject({ full: "no" })).toMatchObject({
        parameter: "full",
        message: "Use the full flag.",
      });
    }),
  );

  it.effect("rejects an undeclared parameter before any value", () =>
    Effect.gen(function* () {
      const rejection = yield* reject({ count: "", colour: "red" });
      expect(rejection).toMatchObject({
        parameter: "colour",
        message:
          "Unknown parameter 'colour' for pick. Accepted parameters: key, count, full.",
      });
      expect(rejection.issue).toBeUndefined();
    }),
  );

  it.effect.each(["==", '"value"', "[value]"])(
    "explains an unknown %s parameter as a shell-split value",
    (split) =>
      Effect.gen(function* () {
        expect(
          yield* reject({ key: "AB", [split]: "true", count: "3" }),
        ).toMatchObject({
          parameter: split,
          message: `Unknown parameter '${split}': Obsidian received these parameters in order: key, ${split}, count.`,
          hint: "Quote the whole value as one shell argument.",
        });
      }),
  );

  it.effect(
    "answers the misplaced message of a parameter of another command",
    () =>
      Effect.gen(function* () {
        expect(
          yield* Effect.flip(
            decodeCliParams({ root: "item" }, pick, {
              command: "pick",
              misplaced: { root: "root belongs to pick-root." },
            }),
          ),
        ).toMatchObject({
          parameter: "root",
          message: "root belongs to pick-root.",
        });
      }),
  );

  it.effect("explains a vault after the command name", () =>
    Effect.gen(function* () {
      expect(yield* reject({ vault: "Research" })).toMatchObject({
        parameter: "vault",
        message: expect.stringContaining("before the command name"),
      });
    }),
  );

  it.effect.each([
    ["--key", "key=<value>"],
    ["--full", "full"],
  ])("rejects %s and gives the accepted form", ([token, form]) =>
    Effect.gen(function* () {
      expect(yield* reject({ [token!]: "true" })).toMatchObject({
        parameter: token,
        message: `Parameter '${token}' is not valid: use ${form}.`,
        hint: `Run the command with ${form}, without --.`,
      });
    }),
  );

  it.effect("rejects an unsupported -- token", () =>
    Effect.gen(function* () {
      expect(yield* reject({ "--verbose": "true" })).toMatchObject({
        parameter: "--verbose",
        hint: expect.stringContaining("name=value"),
      });
    }),
  );

  it.effect("rejects any parameter of a command that takes none", () =>
    Effect.gen(function* () {
      const none = cliParams({});
      const decodeNone = (params: Record<string, string>) =>
        decodeCliParams(params, none, { command: "none" });
      expect(yield* Effect.flip(decodeNone({ a: "1" }))).toMatchObject({
        parameter: "a",
        message: "Unknown parameter 'a': none takes no parameters.",
      });
      expect(yield* Effect.flip(decodeNone({ "--a": "true" }))).toMatchObject({
        hint: "Remove '--a'; none takes no parameters.",
      });
      expect(yield* decodeNone({})).toStrictEqual({});
    }),
  );

  it.effect("dies on a schema issue that names no parameter", () =>
    Effect.gen(function* () {
      const unnamed = cliParams({
        a: Schema.optionalKey(Schema.String),
      }).check(Schema.makeFilter(() => "never"));
      const exit = yield* Effect.exit(
        decodeCliParams({ a: "1" }, unnamed, { command: "bad" }),
      );
      expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toMatchObject({
        message: expect.stringContaining("without a parameter"),
      });
    }),
  );
});

describe("cliParams", () => {
  const required = cliParams(
    {
      id: Schema.String,
      name: Schema.String,
      note: Schema.optionalKey(Schema.String),
    },
    { id: "id names the query to cancel." },
  );
  const decodeRequired = (params: Record<string, string>) =>
    Effect.flip(decodeCliParams(params, required, { command: "cancel" }));

  it.effect(
    "answers the message of a required parameter the caller omits",
    () =>
      Effect.gen(function* () {
        expect(yield* decodeRequired({ name: "a" })).toMatchObject({
          parameter: "id",
          message: "id names the query to cancel.",
        });
        expect(yield* decodeRequired({ id: "a" })).toMatchObject({
          parameter: "name",
          message: "name is required.",
        });
      }),
  );
});

describe("cliValue", () => {
  const keyed = cliParams({ key: Schema.optionalKey(cliValue("key")) });

  it.effect("answers a bare parameter as one that needs a value", () =>
    Effect.gen(function* () {
      expect(
        yield* Effect.flip(
          decodeCliParams({ key: "true" }, keyed, { command: "keyed" }),
        ),
      ).toMatchObject({ parameter: "key", message: "key requires a value." });
      expect(
        yield* decodeCliParams({ key: "ABCD2345" }, keyed, {
          command: "keyed",
        }),
      ).toStrictEqual({ key: "ABCD2345" });
    }),
  );
});

describe("cliMaybeEmpty and cliText", () => {
  const texts = cliParams({
    existing: cliMaybeEmpty(),
    note: Schema.optionalKey(cliText("note must contain text.")),
  });
  const decodeTexts = (params: Record<string, string>) =>
    decodeCliParams(params, texts, { command: "texts" });

  it.effect("decodes an empty value where the parameter takes one", () =>
    Effect.gen(function* () {
      expect(yield* decodeTexts({ existing: "" })).toStrictEqual({
        existing: "",
      });
    }),
  );

  it.effect("rejects blank text with the parameter's message", () =>
    Effect.gen(function* () {
      expect(yield* Effect.flip(decodeTexts({ note: "  " }))).toMatchObject({
        parameter: "note",
        message: "note must contain text.",
      });
    }),
  );
});

describe("cliVariants", () => {
  const NOT_PARTIAL = "root applies to template=partial:<name> only.";
  const render = cliVariants(
    ({ template }) => (template?.startsWith("partial:") ? "partial" : "slot"),
    {
      slot: cliParams({
        template: cliLiterals(["note"], "template must be 'note'."),
        root: cliNotApplicable(NOT_PARTIAL),
      }).pipe(cliMap(({ template }) => ({ template }))),
      partial: cliParams({
        template: Schema.String,
        root: cliDefault(cliLiterals(["item"], "root must be 'item'."), "item"),
      }).pipe(cliMap(({ template, root }) => ({ template, root }))),
    },
  );
  const decodeRender = (params: Record<string, string>) =>
    decodeCliParams(params, render, { command: "render" });

  it.effect("accepts the parameters of every variant", () =>
    Effect.gen(function* () {
      const names = { template: true, root: true } satisfies Record<
        CliParamName<typeof render>,
        true
      >;
      expect(yield* Effect.flip(decodeRender({ colour: "red" }))).toMatchObject(
        {
          message: `Unknown parameter 'colour' for render. Accepted parameters: ${Object.keys(names).join(", ")}.`,
        },
      );
    }),
  );

  it.effect("decodes each variant into its branch of the request", () =>
    Effect.gen(function* () {
      expect(yield* decodeRender({ template: "note" })).toStrictEqual({
        template: "note",
      });
      expect(yield* decodeRender({ template: "partial:a" })).toStrictEqual({
        template: "partial:a",
        root: "item",
      });
    }),
  );

  it.effect(
    "answers a parameter of another variant once the variant's own are valid",
    () =>
      Effect.gen(function* () {
        expect(
          yield* Effect.flip(decodeRender({ template: "note", root: "nope" })),
        ).toMatchObject({
          parameter: "root",
          message: NOT_PARTIAL,
          issue: { path: "root", expected: "never", received: '"nope"' },
        });
        expect(
          yield* Effect.flip(decodeRender({ template: "bogus", root: "item" })),
        ).toMatchObject({
          parameter: "template",
          message: "template must be 'note'.",
        });
      }),
  );

  it.effect("rejects a parameter that only another variant declares", () =>
    Effect.gen(function* () {
      const pickOne = cliVariants(
        ({ key }) => (key === undefined ? "all" : "one"),
        {
          all: cliParams({ full: cliSwitch("x") }),
          one: cliParams({ key: Schema.String }),
        },
      );
      expect(
        yield* Effect.flip(
          decodeCliParams({ key: "A", full: "true" }, pickOne, {
            command: "pick",
          }),
        ),
      ).toMatchObject({
        parameter: "full",
        message: "full does not apply with the other parameters given.",
        issue: { path: "full", expected: "never", received: '"true"' },
      });
    }),
  );

  it.effect("checks a parameter's value in the variant it applies to", () =>
    Effect.gen(function* () {
      expect(
        yield* Effect.flip(
          decodeRender({ template: "partial:a", root: "nope" }),
        ),
      ).toMatchObject({ parameter: "root", message: "root must be 'item'." });
    }),
  );
});

describe("cliOneOf", () => {
  const select = cliParams({
    note: Schema.optionalKey(Schema.String),
    profile: Schema.optionalKey(Schema.String),
    document: Schema.optionalKey(Schema.String),
  }).check(
    cliOneOf(["note", "profile", "document"], {
      many: "Select one target.",
      none: "Select a target.",
    }),
  );
  const decodeSelect = (params: Record<string, string>) =>
    decodeCliParams(params, select, { command: "inspect" });

  it.effect("names the second selector given", () =>
    Effect.gen(function* () {
      expect(
        yield* Effect.flip(decodeSelect({ note: "a", profile: "b" })),
      ).toMatchObject({
        parameter: "profile",
        message: "Select one target.",
        issue: {
          path: "profile",
          expected: "Select one target.",
          received: "Object",
        },
      });
      expect(
        yield* Effect.flip(decodeSelect({ profile: "b", document: "c" })),
      ).toMatchObject({ parameter: "document" });
    }),
  );

  it.effect("names the first selector when the caller gives none", () =>
    Effect.gen(function* () {
      expect(yield* Effect.flip(decodeSelect({}))).toMatchObject({
        parameter: "note",
        message: "Select a target.",
      });
    }),
  );

  it.effect("accepts one selector", () =>
    Effect.gen(function* () {
      expect(yield* decodeSelect({ document: "c" })).toStrictEqual({
        document: "c",
      });
    }),
  );
});

describe("cliNotApplicable", () => {
  it.effect(
    "leaves the form of the parameter to the variant it applies to",
    () =>
      Effect.gen(function* () {
        const check = cliVariants(
          ({ attempt }) => (attempt === undefined ? "run" : "lookup"),
          {
            run: cliParams({ existing: cliMaybeEmpty(), full: cliSwitch("x") }),
            lookup: cliParams({
              attempt: Schema.String,
              existing: cliNotApplicable("lookup only."),
              full: cliNotApplicable("lookup only."),
            }),
          },
        );
        const decodeCheck = (params: Record<string, string>) =>
          decodeCliParams(params, check, { command: "check" });

        expect(yield* decodeCheck({ existing: "" })).toStrictEqual({
          existing: "",
        });
        expect(
          yield* Effect.flip(decodeCheck({ "--full": "true" })),
        ).toMatchObject({
          message: "Parameter '--full' is not valid: use full.",
        });
      }),
  );

  const render = cliParams({
    template: cliLiterals(["note"], "template must be 'note'."),
    root: cliNotApplicable("root applies to partials only."),
    key: Schema.String,
  });
  const decodeRender = (params: Record<string, string>) =>
    decodeCliParams(params, render, { command: "render" });

  it.effect("answers in the order of the fields", () =>
    Effect.gen(function* () {
      expect(
        yield* Effect.flip(decodeRender({ template: "bogus", root: "item" })),
      ).toMatchObject({ parameter: "template" });
      expect(
        yield* Effect.flip(decodeRender({ template: "note", root: "item" })),
      ).toMatchObject({
        parameter: "root",
        message: "root applies to partials only.",
        issue: { path: "root", expected: "never", received: '"item"' },
      });
    }),
  );

  it.effect("accepts the request without the parameter", () =>
    Effect.gen(function* () {
      expect(yield* decodeRender({ template: "note", key: "K" })).toStrictEqual(
        { template: "note", key: "K" },
      );
    }),
  );

  it.effect("takes an Indexed Key and rejects group ID 0", () =>
    Effect.gen(function* () {
      const keyed = cliParams({
        key: Schema.String.check(
          cliIndexedKey((text) => `${text} is not an Indexed Key.`),
        ),
      });
      const decode = (key: string) =>
        decodeCliParams({ key }, keyed, { command: "keyed" });

      expect(yield* decode("ABCD2345g4815")).toEqual({ key: "ABCD2345g4815" });
      expect(yield* Effect.flip(decode("ABCD2345g0"))).toMatchObject({
        parameter: "key",
        message: "ABCD2345g0 is not an Indexed Key.",
      });
    }),
  );
});
