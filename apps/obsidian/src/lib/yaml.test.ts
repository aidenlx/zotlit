import { describe, expect } from "vitest";

import { Effect } from "@/lib/effect";
import { it } from "@/lib/effect-vitest";

import { parseYamlEffect } from "./yaml";

describe("parseYamlEffect", () => {
  it.effect("parses YAML", () =>
    Effect.gen(function* () {
      expect(yield* parseYamlEffect("title: Notes\ntags: [a, b]\n")).toEqual({
        title: "Notes",
        tags: ["a", "b"],
      });
    }),
  );

  it.effect("fails with YamlError where parseYaml throws", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(parseYamlEffect("title: [unclosed"));
      expect(error._tag).toBe("YamlError");
      expect(error.cause).toBeInstanceOf(Error);
    }),
  );
});
