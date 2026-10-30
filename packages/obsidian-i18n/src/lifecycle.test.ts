import { describe, expect, test } from "vitest";

import { resolveLocale } from "./index.js";

const CATALOG = {
  baseLocale: "en",
  packs: {
    "zh-CN": { fileName: "zh-CN.json" },
  },
} as const;
const ALIASES = { zh: "zh-CN" } as const;

/** Never called — exists only so the `aliases` generic is type-checked. */
function assertAliasesRejectUnknownTargets(): void {
  resolveLocale("zh", CATALOG, {
    // @ts-expect-error Locale Alias targets must exist in this catalog.
    zh: "fr",
  });
}
void assertAliasesRejectUnknownTargets;

describe("Locale Aliases", () => {
  test("resolve supported Obsidian codes and default to the base locale", () => {
    expect(resolveLocale("zh", CATALOG, ALIASES)).toBe("zh-CN");
    expect(resolveLocale("zh-TW", CATALOG, ALIASES)).toBe("en");
    expect(resolveLocale("fr", CATALOG, ALIASES)).toBe("en");
    expect(resolveLocale("", CATALOG, ALIASES)).toBe("en");
  });
});
