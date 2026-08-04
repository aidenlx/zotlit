import { describe, expect, it } from "vitest";

import { parseNameParticles, type CslPersonName } from "./zt-csl-name";

describe("parseNameParticles", () => {
  it("splits Zotero name particles and suffixes", () => {
    const names: CslPersonName[] = [
      { family: "la Fontaine", given: "Jean de, Jr." },
      { family: '"van Gogh"', given: "Vincent de" },
    ];
    for (const name of names) parseNameParticles(name);
    expect(names).toEqual([
      {
        family: "Fontaine",
        given: "Jean",
        "non-dropping-particle": "la",
        "dropping-particle": "de",
        suffix: "Jr.",
      },
      { family: "van Gogh", given: "Vincent de" },
    ]);
  });
});
