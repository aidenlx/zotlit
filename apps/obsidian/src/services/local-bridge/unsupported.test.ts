import { describe, expect, it } from "vitest";

import { CONTRACT_VERSION } from "@zotlit/db";

import { unsupportedProfileSourceReason } from "./unsupported";

/** The build the checks read a Profile against. */
const PLUGIN_VERSION = "2.3.0";

/** A Profile document with `extra` folded into its manifest. */
function profileSource(
  extra: string,
  language = "liquid",
  contract: number = CONTRACT_VERSION,
): string {
  return `---
id: default
name: Default
version: 1.0.0
contract: ${contract}
filename: '{{ zt.key }}'
language: ${language}
${extra}---
# {{ zt.title }}

--- zotlit:annotation ---
{{ zt.text }}
`;
}

/** The reason this source earns for the build above. */
function reasonFor(source: string) {
  return unsupportedProfileSourceReason(source, PLUGIN_VERSION);
}

describe("the unsupported-Profile check", () => {
  it("passes a Liquid document with no JavaScript and no Eta partial", () => {
    expect(reasonFor(profileSource(""))).toBeNull();
  });

  it("names an Eta document", () => {
    expect(reasonFor(profileSource("", "eta"))).toBe("eta-document");
  });

  it("names a property computed in JavaScript", () => {
    const source = profileSource(`frontmatter:
  - key: shelf
    js: 'return zt.title.length'
`);
    expect(reasonFor(source)).toBe("javascript-property");
  });

  it("names a dependency written in Eta", () => {
    const source = profileSource(`partials:
  - name: cite
    language: eta
    source: '<%= it.zt.title %>'
`);
    expect(reasonFor(source)).toBe("eta-dependency");
  });

  it("names a document written against another data contract", () => {
    const source = profileSource("", "liquid", CONTRACT_VERSION + 1);
    expect(reasonFor(source)).toBe("foreign-contract");
  });

  it("names a document that asks for a newer plugin", () => {
    expect(reasonFor(profileSource("minAppVersion: 9.9.9\n"))).toBe(
      "min-app-version",
    );
  });

  it("passes a document this build already meets", () => {
    expect(reasonFor(profileSource("minAppVersion: 2.0.0\n"))).toBeNull();
  });

  it("leaves a document that does not parse to the page's own report", () => {
    expect(reasonFor("not a Profile document")).toBeNull();
  });
});
