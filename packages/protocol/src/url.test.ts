import { describe, expect, it } from "vitest";

import {
  buildProtocolUrl,
  parseProtocolQuery,
  protocolActions,
  protocolSourceMatches,
} from "./url";
import { PROTOCOL_VERSION } from "./version";

const SOURCE = "a1b2c3d4";

/** Reconstruct the flat record Obsidian decodes from an `obsidian://zotlit/<action>` link. */
function decode(url: string): Record<string, string> {
  const parsed = new URL(url);
  return {
    action: `${parsed.host}${parsed.pathname}`,
    ...Object.fromEntries(parsed.searchParams),
  };
}

describe("zotlit obsidian protocol", () => {
  it.each(protocolActions)("builds + round-trips %s", (action) => {
    const url = buildProtocolUrl(action, 42, SOURCE);
    expect(url).toBe(
      `obsidian://zotlit/${action}?item=42&source-id=${SOURCE}&v=${PROTOCOL_VERSION}`,
    );
    expect(decode(url).action).toBe(`zotlit/${action}`);
    expect(parseProtocolQuery(decode(url))).toEqual({
      item: 42,
      sourceId: SOURCE,
    });
  });
});

describe("protocolSourceMatches", () => {
  const query = { item: 1, sourceId: SOURCE };

  it("accepts when ids match", () => {
    expect(protocolSourceMatches(query, SOURCE)).toBe(true);
  });

  it("rejects when ids differ", () => {
    expect(protocolSourceMatches(query, "00000000")).toBe(false);
  });

  it("rejects when expected is null", () => {
    expect(protocolSourceMatches(query, null)).toBe(false);
  });
});
