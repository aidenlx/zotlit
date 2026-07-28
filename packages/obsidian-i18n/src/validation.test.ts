// Direct seam tests for validateLanguagePack against the bounded runtime contract.

import { describe, expect, test } from "vitest";

import {
  isSupportedLanguagePackFormatter,
  LANGUAGE_PACK_LIMITS,
  LANGUAGE_PACK_SCHEMA_VERSION,
  LanguagePackSchemaVersionError,
  validateLanguagePack,
} from "./validation.js";

describe("validateLanguagePack", () => {
  test("accepts a pack matching the schema version, locale, and node shapes", () => {
    const pack = languagePack();

    expect(
      validateLanguagePack(JSON.stringify(pack), { expectedLocale: "zh-CN" }),
    ).toEqual(pack);
  });

  test("rejects a pack whose schema version this build cannot read", () => {
    expect(() =>
      validateLanguagePack(JSON.stringify(languagePack({ schemaVersion: 2 })), {
        expectedLocale: "zh-CN",
      }),
    ).toThrow(`schemaVersion must be ${LANGUAGE_PACK_SCHEMA_VERSION}`);
  });

  test.each([
    ["newer", 2, true],
    ["older", 0, false],
    ["non-numeric", "1", false],
  ])(
    "flags a %s schema version as updateNeeded=%s",
    (_name, schemaVersion, updateNeeded) => {
      const reject = (): unknown =>
        validateLanguagePack(JSON.stringify(languagePack({ schemaVersion })), {
          expectedLocale: "zh-CN",
        });

      expect(reject).toThrow(LanguagePackSchemaVersionError);
      expect(reject).toThrow(
        expect.objectContaining({ updateNeeded }) as Error,
      );
    },
  );

  test("rejects a pack whose locale does not equal the expected locale", () => {
    expect(() =>
      validateLanguagePack(JSON.stringify(languagePack({ locale: "fr" })), {
        expectedLocale: "zh-CN",
      }),
    ).toThrow('$.locale must equal "zh-CN"');
  });

  test.each([
    [
      "an unsupported top-level key",
      languagePack({ extra: true }),
      "$.extra is unsupported",
    ],
    [
      "a missing required top-level key",
      (() => {
        const pack = languagePack() as Record<string, unknown>;
        delete pack.locale;
        return pack;
      })(),
      "$.locale is required",
    ],
    [
      "a message missing its variants",
      languagePack({ messages: { bad: { declarations: [] } } }),
      "$.messages.bad.variants is required",
    ],
    [
      "a message with no variants",
      languagePack({
        messages: { bad: { declarations: [], variants: [] } },
      }),
      "must contain at least one variant",
    ],
    [
      "a declaration with an unsupported type",
      languagePack({
        messages: {
          bad: {
            declarations: [{ type: "mystery", name: "value" }],
            variants: [{ matches: [], pattern: [] }],
          },
        },
      }),
      '$.messages.bad.declarations[0].type must be "input" or "local"',
    ],
    [
      "a match with an unsupported type",
      languagePack({
        messages: {
          bad: {
            declarations: [],
            variants: [
              {
                matches: [{ type: "mystery", key: "value" }],
                pattern: [],
              },
            ],
          },
        },
      }),
      '$.messages.bad.variants[0].matches[0].type must be "literal" or "catchall"',
    ],
    [
      "an expression with an unsupported type",
      languagePack({
        messages: {
          bad: {
            declarations: [],
            variants: [
              { matches: [], pattern: [{ type: "mystery", value: "x" }] },
            ],
          },
        },
      }),
      "$.messages.bad.variants[0].pattern[0].type is unsupported",
    ],
  ])("rejects %s", (_name, pack, detail) => {
    expect(() =>
      validateLanguagePack(JSON.stringify(pack), { expectedLocale: "zh-CN" }),
    ).toThrow(detail);
  });

  test.each(["plural", "number", "datetime"] as const)(
    "accepts the %s formatter through the contract allowlist",
    (name) => {
      expect(isSupportedLanguagePackFormatter(name)).toBe(true);
      expect(() =>
        validateLanguagePack(
          JSON.stringify(
            languagePack({
              messages: {
                formatted: structuredMessage(formatterExpression(name)),
              },
            }),
          ),
          { expectedLocale: "zh-CN" },
        ),
      ).not.toThrow();
    },
  );

  test("rejects a formatter outside the contract allowlist", () => {
    expect(isSupportedLanguagePackFormatter("execute")).toBe(false);
    expect(() =>
      validateLanguagePack(
        JSON.stringify(
          languagePack({
            messages: {
              unsafe: structuredMessage(formatterExpression("execute")),
            },
          }),
        ),
        { expectedLocale: "zh-CN" },
      ),
    ).toThrow('unsupported formatter "execute"');
  });

  test("rejects a pack exceeding the byte-size limit", () => {
    const pack = languagePack({
      messages: Object.fromEntries(
        Array.from({ length: 30 }, (_, index) => [
          `message_${index}`,
          "文".repeat(9_000),
        ]),
      ),
    });

    expect(() =>
      validateLanguagePack(JSON.stringify(pack), { expectedLocale: "zh-CN" }),
    ).toThrow(`exceeds ${LANGUAGE_PACK_LIMITS.bytes} bytes`);
  });

  test("rejects a pack exceeding the message-count limit", () => {
    const pack = languagePack({
      messages: Object.fromEntries(
        Array.from(
          { length: LANGUAGE_PACK_LIMITS.messages + 1 },
          (_, index) => [`message_${index}`, ""],
        ),
      ),
    });

    expect(() =>
      validateLanguagePack(JSON.stringify(pack), { expectedLocale: "zh-CN" }),
    ).toThrow(`exceeds ${LANGUAGE_PACK_LIMITS.messages} messages`);
  });

  test("rejects a message text exceeding the text-length limit", () => {
    const pack = languagePack({
      messages: { long: "x".repeat(LANGUAGE_PACK_LIMITS.textLength + 1) },
    });

    expect(() =>
      validateLanguagePack(JSON.stringify(pack), { expectedLocale: "zh-CN" }),
    ).toThrow(`exceeds ${LANGUAGE_PACK_LIMITS.textLength} characters`);
  });

  test("rejects a message exceeding the nesting-depth limit", () => {
    const pack = languagePack({
      messages: { deep: structuredMessage(nestedFormatter(12)) },
    });

    expect(() =>
      validateLanguagePack(JSON.stringify(pack), { expectedLocale: "zh-CN" }),
    ).toThrow(`exceeds nesting depth ${LANGUAGE_PACK_LIMITS.depth}`);
  });

  test("rejects a pack exceeding the byte-size limit before it is parsed as JSON", () => {
    const oversized = "x".repeat(LANGUAGE_PACK_LIMITS.bytes + 1);

    expect(() =>
      validateLanguagePack(oversized, { expectedLocale: "zh-CN" }),
    ).toThrow(`exceeds ${LANGUAGE_PACK_LIMITS.bytes} bytes`);
  });

  test("rejects a pack that is not valid JSON", () => {
    expect(() =>
      validateLanguagePack("not json", { expectedLocale: "zh-CN" }),
    ).toThrow("pack must be valid JSON");
  });
});

function languagePack(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    locale: "zh-CN",
    messages: { greeting: "你好" },
    ...overrides,
  };
}

function structuredMessage(expression: unknown): Record<string, unknown> {
  return {
    declarations: [{ type: "input", name: "value" }],
    variants: [{ matches: [], pattern: [expression] }],
  };
}

function formatterExpression(name: string): Record<string, unknown> {
  return {
    type: "formatter",
    name,
    argument: { type: "variable", name: "value" },
    options: {},
  };
}

function nestedFormatter(depth: number): Record<string, unknown> {
  return depth === 0
    ? { type: "variable", name: "value" }
    : {
        type: "formatter",
        name: "number",
        argument: nestedFormatter(depth - 1),
        options: {},
      };
}
