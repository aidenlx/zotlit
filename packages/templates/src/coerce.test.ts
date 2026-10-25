import { describe, expect, it } from "vitest";

import { createLiquidEngine } from "./liquid";

describe("coerceOutput", () => {
  it("renders a JS Date via toISOString", () => {
    const engine = createLiquidEngine();
    const date = new Date("2026-06-21T04:00:00Z");
    expect(
      engine.parseAndRenderSync("{{ zt.value }}", { zt: { value: date } }),
    ).toBe("2026-06-21T04:00:00.000Z");
  });
});
