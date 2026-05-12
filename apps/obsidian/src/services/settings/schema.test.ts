import { describe, expect, it } from "vitest";
import * as v from "valibot";

import { defaults, schema } from "./schema";

describe("schema/defaults invariants", () => {
  it("defaults stay aligned with schema entries", () => {
    expect(Object.keys(defaults).sort()).toEqual(
      Object.keys(schema.entries).sort(),
    );
  });

  it("defaults satisfy the schema", () => {
    const result = v.safeParse(schema, defaults);
    expect(result.success).toBe(true);
  });
});
