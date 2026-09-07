import { describe, expect, it } from "vitest";

import {
  inertPlaceholderReason,
  markInertPlaceholder,
} from "./inert-placeholder";

describe("inert placeholders", () => {
  it("round-trips the reason through inertPlaceholderReason", () => {
    const placeholder = markInertPlaceholder(() => "", "Not imported");
    expect(inertPlaceholderReason(placeholder)).toBe("Not imported");
    expect(inertPlaceholderReason(() => "")).toBeUndefined();
    expect(inertPlaceholderReason("not a function")).toBeUndefined();
  });
});
