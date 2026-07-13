import * as v from "valibot";
import { describe, expect, it } from "vitest";

import {
  batchUpdateRequestSchema,
  buildBatchProtocolUrl,
  buildExploreProtocolUrl,
  buildProtocolUrl,
  parseExploreProtocolQuery,
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
    const url = buildProtocolUrl(action, 42, { sourceId: SOURCE });
    expect(url).toBe(
      `obsidian://zotlit/${action}?item=42&source-id=${SOURCE}&v=${PROTOCOL_VERSION}`,
    );
    expect(decode(url).action).toBe(`zotlit/${action}`);
    expect(parseProtocolQuery(decode(url))).toEqual({
      item: 42,
      sourceId: SOURCE,
      scope: "full",
    });
  });

  it("builds + round-trips a metadata-scoped update link", () => {
    const url = buildProtocolUrl("update", 42, {
      sourceId: SOURCE,
      scope: "metadata",
    });
    expect(url).toBe(
      `obsidian://zotlit/update?item=42&source-id=${SOURCE}&v=${PROTOCOL_VERSION}&scope=metadata`,
    );
    expect(parseProtocolQuery(decode(url))).toEqual({
      item: 42,
      sourceId: SOURCE,
      scope: "metadata",
    });
  });

  it("omits scope from the link when it is the full default", () => {
    expect(
      buildProtocolUrl("update", 42, { sourceId: SOURCE, scope: "full" }),
    ).toBe(
      `obsidian://zotlit/update?item=42&source-id=${SOURCE}&v=${PROTOCOL_VERSION}`,
    );
  });

  it("defaults scope to full and parses an explicit metadata scope", () => {
    expect(parseProtocolQuery({ item: "42", "source-id": SOURCE })).toEqual({
      item: 42,
      sourceId: SOURCE,
      scope: "full",
    });
    expect(
      parseProtocolQuery({
        item: "42",
        "source-id": SOURCE,
        scope: "metadata",
      }),
    ).toEqual({ item: 42, sourceId: SOURCE, scope: "metadata" });
  });

  it("rejects an unknown scope", () => {
    expect(() =>
      parseProtocolQuery({ item: "42", "source-id": SOURCE, scope: "body" }),
    ).toThrow();
  });
});

describe("zotlit update-many protocol", () => {
  it("builds + round-trips a batch link", () => {
    const url = buildBatchProtocolUrl([1, 2, 3], { sourceId: SOURCE });
    expect(url).toBe(
      `obsidian://zotlit/update-many?items=1%2C2%2C3&source-id=${SOURCE}&v=${PROTOCOL_VERSION}`,
    );
    expect(parseProtocolBatchQuery(decode(url))).toEqual({
      items: [1, 2, 3],
      sourceId: SOURCE,
      scope: "full",
    });
  });

  it("builds + round-trips a metadata-scoped batch link", () => {
    const url = buildBatchProtocolUrl([1, 2, 3], {
      sourceId: SOURCE,
      scope: "metadata",
    });
    expect(url).toBe(
      `obsidian://zotlit/update-many?items=1%2C2%2C3&source-id=${SOURCE}&v=${PROTOCOL_VERSION}&scope=metadata`,
    );
    expect(parseProtocolBatchQuery(decode(url))).toEqual({
      items: [1, 2, 3],
      sourceId: SOURCE,
      scope: "metadata",
    });
  });

  it("tolerates a trailing comma and dedupes ids", () => {
    expect(
      parseProtocolBatchQuery({ items: "1,2,2,3,", "source-id": SOURCE }),
    ).toEqual({ items: [1, 2, 3], sourceId: SOURCE, scope: "full" });
  });

  it("parses an explicit metadata scope", () => {
    expect(
      parseProtocolBatchQuery({
        items: "1,2,3",
        "source-id": SOURCE,
        scope: "metadata",
      }),
    ).toEqual({ items: [1, 2, 3], sourceId: SOURCE, scope: "metadata" });
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
      scope: "full",
    });
  });

  it("parses an explicit metadata scope", () => {
    expect(
      v.parse(batchUpdateRequestSchema, { items: [1], scope: "metadata" }),
    ).toEqual({ items: [1], scope: "metadata" });
  });

  it("rejects an empty item list", () => {
    expect(() => v.parse(batchUpdateRequestSchema, { items: [] })).toThrow();
  });

  it("rejects non-integer ids", () => {
    expect(() => v.parse(batchUpdateRequestSchema, { items: [1.5] })).toThrow();
  });
});

describe("zotlit explore protocol", () => {
  it("builds + round-trips an item-only link", () => {
    const url = buildExploreProtocolUrl(42, { sourceId: SOURCE });
    expect(url).toBe(
      `obsidian://zotlit/explore?item=42&source-id=${SOURCE}&v=${PROTOCOL_VERSION}`,
    );
    expect(decode(url).action).toBe("zotlit/explore");
    expect(parseExploreProtocolQuery(decode(url))).toEqual({
      item: 42,
      annotation: undefined,
      sourceId: SOURCE,
    });
  });

  it("builds + round-trips a link with annotation anchor", () => {
    const url = buildExploreProtocolUrl(42, {
      sourceId: SOURCE,
      annotation: "ABC23456",
    });
    expect(url).toBe(
      `obsidian://zotlit/explore?item=42&source-id=${SOURCE}&v=${PROTOCOL_VERSION}&annotation=ABC23456`,
    );
    expect(parseExploreProtocolQuery(decode(url))).toEqual({
      item: 42,
      annotation: "ABC23456",
      sourceId: SOURCE,
    });
  });

  it("omits annotation when not provided", () => {
    const url = buildExploreProtocolUrl(42, { sourceId: SOURCE });
    expect(url).not.toContain("annotation");
  });

  it("rejects a missing item", () => {
    expect(() => parseExploreProtocolQuery({ "source-id": SOURCE })).toThrow();
  });

  it("rejects a missing source-id", () => {
    expect(() => parseExploreProtocolQuery({ item: "42" })).toThrow();
  });

  it.each(["x", "ABC1234!", "ABC123456", "ABC10ILO"])(
    "rejects malformed annotation key %s",
    (annotation) => {
      expect(() =>
        parseExploreProtocolQuery({
          item: "42",
          annotation,
          "source-id": SOURCE,
        }),
      ).toThrow();
    },
  );
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
