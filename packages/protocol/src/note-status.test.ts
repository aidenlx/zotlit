import * as v from "valibot";
import { describe, expect, it } from "vitest";

import { noteStatusResponseSchema } from "./note-status";

describe("noteStatusResponseSchema", () => {
  it("parses a valid payload", () => {
    expect(v.parse(noteStatusResponseSchema, { keys: [] })).toEqual({
      keys: [],
    });
    expect(v.parse(noteStatusResponseSchema, { keys: ["ABCD2345"] })).toEqual({
      keys: ["ABCD2345"],
    });
    expect(
      v.parse(noteStatusResponseSchema, { keys: ["ABCD2345g17"] }),
    ).toEqual({ keys: ["ABCD2345g17"] });
    expect(
      v.parse(noteStatusResponseSchema, {
        keys: ["ABCD2345", "ABCD2345g17"],
      }),
    ).toEqual({ keys: ["ABCD2345", "ABCD2345g17"] });
  });

  it.each([
    "abcd2345",
    "ABCD234",
    "ABCD23456",
    "ABCDO145",
    "ABCD1345",
    "ABCD0345",
    "ABCD2345g",
    "ABCD2345gx",
  ])("rejects malformed key %s", (key) => {
    expect(v.safeParse(noteStatusResponseSchema, { keys: [key] }).success).toBe(
      false,
    );
  });

  it.each([{}, { keys: "ABCD2345" }, { keys: [1] }, { keys: [null] }, null])(
    "rejects malformed shape %j",
    (payload) => {
      expect(v.safeParse(noteStatusResponseSchema, payload).success).toBe(
        false,
      );
    },
  );
});
