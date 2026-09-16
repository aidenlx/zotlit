import * as v from "valibot";
import { describe, expect, it } from "vitest";

import { notifyEventSchema } from "./notify";

/**
 * The reader events the Obsidian listener validates bodies against. The
 * variant discriminates on `event`, so a body is accepted only when its own
 * option accepts it.
 *
 * @see https://github.com/aidenlx/zotlit/issues/1146
 */
describe("reader/inactive", () => {
  it("accepts a body carrying only the event name", () => {
    expect(v.parse(notifyEventSchema, { event: "reader/inactive" })).toEqual({
      event: "reader/inactive",
    });
  });

  it("accepts the optional debug dirs every notify event shares", () => {
    const event = {
      event: "reader/inactive",
      profilePath: "/home/reader/Zotero/profile",
      dataPath: "/home/reader/Zotero",
    };
    expect(v.parse(notifyEventSchema, event)).toEqual(event);
  });

  it("carries no reader identity, so a sender's extra field never lands", () => {
    expect(
      v.parse(notifyEventSchema, {
        event: "reader/inactive",
        attachmentID: 42,
      }),
    ).toEqual({ event: "reader/inactive" });
  });

  it("stays distinct from reader/active, which still names its item", () => {
    expect(() =>
      v.parse(notifyEventSchema, { event: "reader/active" }),
    ).toThrow();
    expect(
      v.parse(notifyEventSchema, {
        event: "reader/active",
        itemID: 1,
        attachmentID: 2,
        selected: [],
      }),
    ).toMatchObject({ event: "reader/active", attachmentID: 2 });
  });
});
