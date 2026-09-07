import { describe, expect, it } from "vitest";

import { CONTRACT_VERSION } from "@zotlit/db";

import { unsupportedProfileReason } from "./unsupported";

/** A Profile document with `extra` folded into its manifest. */
function profileSource(extra: string, language = "liquid"): string {
  return `---
id: default
name: Default
version: 1.0.0
contract: ${CONTRACT_VERSION}
filename: '{{ zt.key }}'
language: ${language}
${extra}---
# {{ zt.title }}

--- zotlit:annotation ---
{{ zt.text }}
`;
}

describe("the unsupported-Profile check", () => {
  it("passes a Liquid document with no JavaScript and no Eta partial", () => {
    expect(unsupportedProfileReason(profileSource(""))).toBeNull();
  });

  it("names an Eta document", () => {
    expect(unsupportedProfileReason(profileSource("", "eta"))).toBe(
      "eta-document",
    );
  });

  it("names a property computed in JavaScript", () => {
    const source = profileSource(`frontmatter:
  - key: shelf
    js: 'return zt.title.length'
`);
    expect(unsupportedProfileReason(source)).toBe("javascript-property");
  });

  it("names a dependency written in Eta", () => {
    const source = profileSource(`partials:
  - name: cite
    language: eta
    source: '<%= it.zt.title %>'
`);
    expect(unsupportedProfileReason(source)).toBe("eta-dependency");
  });

  it("leaves a document that does not parse to the page's own report", () => {
    expect(unsupportedProfileReason("not a Profile document")).toBeNull();
  });
});
