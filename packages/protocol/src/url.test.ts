import * as v from "valibot";
import { describe, expect, it } from "vitest";

import {
  batchUpdateRequestSchema,
  buildBatchProtocolUrl,
  buildProtocolUrl,
  parseProtocolBatchQuery,
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

describe("zotlit update-many protocol", () => {
  it("builds + round-trips a batch link", () => {
    const url = buildBatchProtocolUrl([1, 2, 3], SOURCE);
    expect(url).toBe(
      `obsidian://zotlit/update-many?items=1%2C2%2C3&source-id=${SOURCE}&v=${PROTOCOL_VERSION}`,
    );
    expect(parseProtocolBatchQuery(decode(url))).toEqual({
      items: [1, 2, 3],
      sourceId: SOURCE,
    });
  });

  it("tolerates a trailing comma and dedupes ids", () => {
    expect(
      parseProtocolBatchQuery({ items: "1,2,2,3,", "source-id": SOURCE }),
    ).toEqual({ items: [1, 2, 3], sourceId: SOURCE });
  });

  it("rejects an empty item list", () => {
    expect(() =>
      parseProtocolBatchQuery({ items: "", "source-id": SOURCE }),
    ).toThrow();
    expect(() =>
      parseProtocolBatchQuery({ items: ",", "source-id": SOURCE }),
    ).toThrow();
  });

  it("rejects a non-numeric id", () => {
    expect(() =>
      parseProtocolBatchQuery({ items: "1,x,3", "source-id": SOURCE }),
    ).toThrow();
  });
});

describe("batchUpdateRequestSchema (HTTP body)", () => {
  it("dedupes ids, matching the URL path", () => {
    expect(v.parse(batchUpdateRequestSchema, { items: [1, 2, 2, 3] })).toEqual({
      items: [1, 2, 3],
    });
  });

  it("rejects an empty item list", () => {
    expect(() => v.parse(batchUpdateRequestSchema, { items: [] })).toThrow();
  });

  it("rejects non-integer ids", () => {
    expect(() => v.parse(batchUpdateRequestSchema, { items: [1.5] })).toThrow();
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
