import * as v from "valibot";
import { describe, expect, it } from "vitest";

import {
  highlightEmoji,
  highlightMappingsSchema,
  isHighlightEmoji,
} from "./highlight-mapping";

describe("custom highlight emoji", () => {
  it.each(["🔴", "👩‍🔬", "👍🏽", "🇸🇬", "❤️", "1️⃣"])(
    "accepts one visible emoji: %s",
    (value) => {
      expect(isHighlightEmoji(value)).toBe(true);
      expect(
        highlightEmoji("blue", {
          blue: { output: "custom", customEmoji: value },
        }),
      ).toBe(value);
    },
  );

  it.each(["", " ", "blue", "a", "1", "🔴🔵", " 🔴", "🔴\n", "==", "<b>"])(
    "falls back to HTML for invalid input: %j",
    (value) => {
      expect(isHighlightEmoji(value)).toBe(false);
      expect(
        highlightEmoji("blue", {
          blue: { output: "custom", customEmoji: value },
        }),
      ).toBeNull();
    },
  );
});

describe("highlight mapping settings", () => {
  it("accepts sparse overrides and keeps the other color defaults", () => {
    const mappings = v.parse(highlightMappingsSchema, {
      blue: { output: "mark", customEmoji: "👩‍🔬" },
      magenta: { output: "🟣", customEmoji: "" },
      gray: { output: "custom", customEmoji: "" },
    });

    expect(highlightEmoji("blue", mappings)).toBeNull();
    expect(highlightEmoji("magenta", mappings)).toBe("🟣");
    expect(highlightEmoji("gray", mappings)).toBeNull();
    expect(highlightEmoji("red", mappings)).toBe("🔴");
    expect(highlightEmoji("plum", mappings)).toBeNull();
    expect(highlightEmoji(null, mappings)).toBeNull();
    expect(highlightEmoji("#123456", mappings)).toBeNull();
  });

  it("requires recognized source colors and output choices", () => {
    expect(
      v.safeParse(highlightMappingsSchema, {
        teal: { output: "🔵", customEmoji: "" },
      }).success,
    ).toBe(false);
    expect(
      v.safeParse(highlightMappingsSchema, {
        blue: { output: "👩‍🔬", customEmoji: "" },
      }).success,
    ).toBe(false);
  });
});
