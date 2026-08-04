import { describe, expect, it } from "vitest";

import { extraToCsl } from "./zt-extra-to-csl";

describe("extraToCsl", () => {
  it("normalizes Extra's citeproc-js variable overrides", () => {
    expect(
      extraToCsl(
        "Publication Title: Replacement title\nlowercase field: stays put\ndoi: 10.1234/example",
      ),
    ).toBe(
      "container-title: Replacement title\nlowercase field: stays put\nDOI: 10.1234/example",
    );
  });
});
