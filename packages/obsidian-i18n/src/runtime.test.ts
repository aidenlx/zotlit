import { beforeEach, describe, expect, expectTypeOf, test } from "vitest";

import { createLanguagePackRuntime, noopLogger } from "./index.js";
import type {
  DatetimeInput,
  LanguagePack,
  LanguagePackRuntime,
  TargetLocaleMessages,
} from "./index.js";

/** The floor every Message Input accepts, absent a narrowing base-locale usage. */
type Input = string | number;

/**
 * Mirrors what the compiler emits for a `datetime` input. No catalog message
 * uses one yet, so declaring it here is what keeps the emitted import
 * specifier and member types honest.
 */
type DateInput = DatetimeInput;

const BASE_PACK = fakePack("en", {
  hello: "world",
  annot_view_filter_count: {
    declarations: [
      { type: "input", name: "shown" },
      { type: "input", name: "total" },
    ],
    variants: [
      {
        matches: [],
        pattern: [
          { type: "variable", name: "shown" },
          { type: "text", value: " of " },
          { type: "variable", name: "total" },
        ],
      },
    ],
  },
  creator_summary: {
    declarations: [
      { type: "input", name: "count" },
      { type: "input", name: "first" },
      { type: "input", name: "second" },
    ],
    variants: [
      {
        matches: [{ type: "literal", key: "count", value: "1" }],
        pattern: [{ type: "variable", name: "first" }],
      },
      {
        matches: [{ type: "literal", key: "count", value: "2" }],
        pattern: [
          { type: "text", value: "⁨" },
          { type: "variable", name: "first" },
          { type: "text", value: "⁩ and ⁨" },
          { type: "variable", name: "second" },
          { type: "text", value: "⁩" },
        ],
      },
      {
        matches: [{ type: "catchall", key: "count" }],
        pattern: [
          { type: "variable", name: "first" },
          { type: "text", value: " et al." },
        ],
      },
    ],
  },
});

let runtime: LanguagePackRuntime;
let m: {
  hello(): string;
  annot_view_filter_count(inputs: { shown: Input; total: Input }): string;
  creator_summary(inputs: {
    count: number;
    first: Input;
    second: Input;
  }): string;
};

describe("Language Pack runtime", () => {
  beforeEach(() => {
    runtime = createLanguagePackRuntime(BASE_PACK);
    m = {
      hello: () => runtime.translate("hello"),
      annot_view_filter_count: (inputs) =>
        runtime.translate("annot_view_filter_count", inputs),
      creator_summary: (inputs) => runtime.translate("creator_summary", inputs),
    };
  });

  test("generated wrappers render the bundled base pack", () => {
    expect(m.hello()).toBe("world");
    expect(m.annot_view_filter_count({ shown: 3, total: 8 })).toBe("3 of 8");
    expect(m.creator_summary({ count: 2, first: "Ada", second: "Grace" })).toBe(
      "⁨Ada⁩ and ⁨Grace⁩",
    );
  });

  test("active packs evaluate declarations and variants in source order", () => {
    runtime.install(
      fakePack("fr", {
        creator_summary: {
          declarations: [
            { type: "input", name: "count" },
            {
              type: "local",
              name: "copy",
              value: { type: "variable", name: "first" },
            },
            { type: "input", name: "first" },
            {
              type: "local",
              name: "label",
              value: { type: "variable", name: "copy" },
            },
            { type: "input", name: "second" },
          ],
          variants: [
            {
              matches: [{ type: "literal", key: "count", value: "2" }],
              pattern: [
                { type: "text", value: "premier: " },
                { type: "variable", name: "label" },
              ],
            },
            {
              matches: [{ type: "literal", key: "count", value: "2" }],
              pattern: [{ type: "text", value: "deuxième" }],
            },
            {
              matches: [{ type: "catchall", key: "count" }],
              pattern: [{ type: "variable", name: "second" }],
            },
          ],
        },
      }),
    );

    expect(m.creator_summary({ count: 2, first: "Ada", second: "Grace" })).toBe(
      "premier: Ada",
    );
    // A string selector still matches the numeric literal, though the base
    // locale's usage types `count` as a number for call sites.
    expect(
      runtime.translate("creator_summary", {
        count: "2",
        first: "Ada",
        second: "Grace",
      }),
    ).toBe("premier: Ada");
    expect(m.creator_summary({ count: 3, first: "Ada", second: "Grace" })).toBe(
      "Grace",
    );
  });

  test("an unsafe-integer literal match never matches the numeric input, consistently with a plain string", () => {
    runtime.install(
      fakePack("fr", {
        creator_summary: {
          declarations: [
            { type: "input", name: "count" },
            { type: "input", name: "first" },
          ],
          variants: [
            {
              matches: [
                {
                  type: "literal",
                  key: "count",
                  value: "9007199254740993",
                },
              ],
              pattern: [{ type: "text", value: "unsafe" }],
            },
            {
              matches: [{ type: "catchall", key: "count" }],
              pattern: [{ type: "variable", name: "first" }],
            },
          ],
        },
      }),
    );

    // 9007199254740993 is not a safe integer, so the numeric input never
    // equals the literal text and the catch-all renders instead.
    expect(
      runtime.translate("creator_summary", {
        count: Number("9007199254740993"),
        first: "Ada",
        second: "Grace",
      }),
    ).toBe("Ada");
  });

  test("a sole catch-all variant renders unconditionally", () => {
    runtime.install(
      fakePack("en", {
        creator_summary: {
          declarations: [
            { type: "input", name: "count" },
            { type: "input", name: "first" },
          ],
          variants: [
            {
              matches: [{ type: "catchall", key: "count" }],
              pattern: [{ type: "variable", name: "first" }],
            },
          ],
        },
      }),
    );

    expect(
      m.creator_summary({ count: 99, first: "Ada", second: "Grace" }),
    ).toBe("Ada");
  });

  test("a sole variant with a non-matching literal match falls back to the base pack", () => {
    runtime.install(
      fakePack("fr", {
        hello: {
          declarations: [{ type: "input", name: "count" }],
          variants: [
            {
              matches: [{ type: "literal", key: "count", value: "1" }],
              pattern: [{ type: "text", value: "bonjour" }],
            },
          ],
        },
      }),
    );

    expect(m.hello()).toBe("world");
  });

  test("falls back per message from the active pack to the base pack to the bundle ID", () => {
    runtime.install(fakePack("fr", { hello: "monde" }));

    expect(m.hello()).toBe("monde");
    expect(m.annot_view_filter_count({ shown: 3, total: 8 })).toBe("3 of 8");
    expect(runtime.translate("missing_message")).toBe("missing_message");
  });

  test("keeps active locale state isolated between runtime instances", () => {
    const first = createLanguagePackRuntime(BASE_PACK);
    const second = createLanguagePackRuntime(BASE_PACK);
    first.install(fakePack("fr", { hello: "monde" }));

    expect(first.translate("hello")).toBe("monde");
    expect(second.translate("hello")).toBe("world");
  });

  test("falls back against a configured non-English base locale", () => {
    const chineseBase = createLanguagePackRuntime(
      fakePack("zh-CN", { hello: "世界" }),
    );
    chineseBase.install(fakePack("fr", {}));

    expect(chineseBase.translate("hello")).toBe("世界");
  });

  test("falls back to the base pack when an active message cannot render", () => {
    runtime.install(
      fakePack("fr", {
        hello: {
          declarations: [],
          variants: [],
        },
      }),
    );

    expect(m.hello()).toBe("world");
  });

  test("falls back to the bundle ID when the base message cannot render", () => {
    expect(
      runtime.translate("creator_summary", {
        count: 3,
        first: {
          toString: () => {
            throw new Error("unrenderable");
          },
        },
        second: "Grace",
      }),
    ).toBe("creator_summary");
  });

  test("types each input from base-locale usage", () => {
    expectTypeOf<typeof m.creator_summary>()
      .parameter(0)
      .toEqualTypeOf<{ count: number; first: Input; second: Input }>();
    expectTypeOf<typeof m.annot_view_filter_count>()
      .parameter(0)
      .toEqualTypeOf<{ shown: Input; total: Input }>();
    expectTypeOf<typeof m.hello>().parameters.toEqualTypeOf<[]>();
    // A `datetime` input widens the floor rather than replacing it.
    expectTypeOf<Input>().toExtend<DateInput>();
  });

  test("formats plurals, numbers, and datetimes with the pack locale", () => {
    runtime.install(
      fakePack("en", {
        creator_summary: {
          declarations: [
            { type: "input", name: "count" },
            { type: "input", name: "first" },
            { type: "input", name: "second" },
          ],
          variants: [
            {
              matches: [],
              pattern: [
                {
                  type: "formatter",
                  name: "plural",
                  argument: { type: "variable", name: "count" },
                  options: {
                    type: { type: "literal", value: "ordinal" },
                  },
                },
                { type: "text", value: "|" },
                {
                  type: "formatter",
                  name: "number",
                  argument: { type: "variable", name: "second" },
                  options: {
                    minimumFractionDigits: { type: "literal", value: "2" },
                  },
                },
                { type: "text", value: "|" },
                {
                  type: "formatter",
                  name: "datetime",
                  argument: { type: "variable", name: "first" },
                  options: {
                    dateStyle: { type: "literal", value: "medium" },
                    timeZone: { type: "literal", value: "UTC" },
                  },
                },
              ],
            },
          ],
        },
      }),
    );

    expect(
      m.creator_summary({
        count: 2,
        first: "2020-01-02T00:00:00.000Z",
        second: 1234.5,
      }),
    ).toBe("two|1,234.50|Jan 2, 2020");
    expect(
      m.creator_summary({
        count: 2,
        first: "2020-01-02",
        second: 1234.5,
      }),
    ).toBe("two|1,234.50|Jan 2, 2020");
    expect(m.creator_summary({ count: 2, first: 0, second: 1234.5 })).toBe(
      "two|1,234.50|Jan 1, 1970",
    );
    // A locale narrowing an input to `:number` still renders the string the
    // caller passed, which is why non-base narrowing never reaches the facade.
    expect(m.creator_summary({ count: 2, first: 0, second: "1234.5" })).toBe(
      "two|1,234.50|Jan 1, 1970",
    );
    expect(
      m.creator_summary({
        count: 2,
        first: "2020-01-02T00:00:00+00:00",
        second: 1234.5,
      }),
    ).toBe("two|1,234.50|Jan 2, 2020");
  });
});

describe("Target-Locale Messages", () => {
  const TARGET_SUBSETS = {
    "zh-CN": {
      notice_install: "语言包可用。",
      annot_view_filter_count: {
        declarations: [
          { type: "input", name: "shown" },
          { type: "input", name: "total" },
        ],
        variants: [
          {
            matches: [],
            pattern: [
              { type: "variable", name: "shown" },
              { type: "text", value: " / " },
              { type: "variable", name: "total" },
            ],
          },
        ],
      },
    },
  } as const satisfies TargetLocaleMessages;
  const BASE_WITH_NOTICE = fakePack("en", {
    ...BASE_PACK.messages,
    notice_install: "A language pack is available.",
  });

  let targeted: LanguagePackRuntime;

  beforeEach(() => {
    targeted = createLanguagePackRuntime(BASE_WITH_NOTICE, {
      targetLocaleMessages: TARGET_SUBSETS,
    });
  });

  test("renders base-locale text until a target locale is set", () => {
    expect(targeted.translateTarget("notice_install")).toBe(
      "A language pack is available.",
    );
  });

  test("renders the bundled subset once the target locale is set, with no pack installed", () => {
    targeted.setTargetLocale("zh-CN");

    expect(targeted.translateTarget("notice_install")).toBe("语言包可用。");
    expect(
      targeted.translateTarget("annot_view_filter_count", {
        shown: 3,
        total: 8,
      }),
    ).toBe("3 / 8");
  });

  test("ignores the active Language Pack, which still serves every other message", () => {
    targeted.setTargetLocale("zh-CN");
    targeted.install(
      fakePack("zh-CN", { notice_install: "来自语言包", hello: "世界" }),
    );

    expect(targeted.translateTarget("notice_install")).toBe("语言包可用。");
    expect(targeted.translate("hello")).toBe("世界");
  });

  test("falls back per message to the base locale, then to the bundle ID", () => {
    targeted.setTargetLocale("zh-CN");

    // Translated in no subset: the half-translated locale still renders.
    expect(targeted.translateTarget("hello")).toBe("world");
    expect(targeted.translateTarget("missing_message")).toBe("missing_message");
  });

  test("falls back to the base locale for a target locale with no bundled subset", () => {
    targeted.setTargetLocale("fr");

    expect(targeted.translateTarget("notice_install")).toBe(
      "A language pack is available.",
    );
  });

  test("falls back to the base locale when a subset message cannot render", () => {
    const unrenderable = createLanguagePackRuntime(BASE_WITH_NOTICE, {
      targetLocaleMessages: {
        "zh-CN": { notice_install: { declarations: [], variants: [] } },
      },
    });
    unrenderable.setTargetLocale("zh-CN");

    expect(unrenderable.translateTarget("notice_install")).toBe(
      "A language pack is available.",
    );
  });

  test("reports each fallback once, naming the target-locale subset", () => {
    const messages: string[] = [];
    targeted.setLogger({
      ...noopLogger,
      debug: (message) => messages.push(message as string),
    });
    targeted.setTargetLocale("zh-CN");

    targeted.translateTarget("hello");
    targeted.translateTarget("hello");

    expect(messages).toHaveLength(1);
  });

  test("renders base-locale text again after a reset drops the target locale", () => {
    targeted.setTargetLocale("zh-CN");
    targeted.reset();

    expect(targeted.translateTarget("notice_install")).toBe(
      "A language pack is available.",
    );
  });
});

function fakePack(
  locale: string,
  messages: LanguagePack["messages"],
): LanguagePack {
  return { schemaVersion: 1, locale, messages };
}
