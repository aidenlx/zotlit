import { expect, it } from "vitest";

import { GLOBAL_FUNCTIONS, IF_FUNCTION } from "./filter-functions";
import { parameterTexts, resultText, signatureText } from "./signature-text";
import type { SignatureShape } from "./signature-text";

it("writes each parameter with its types, its texts, null and its optional or rest mark", () => {
  expect(signatureText("max", GLOBAL_FUNCTIONS.get("max")!)).toBe(
    "max(...values: number | null) → number",
  );
  const definition: SignatureShape = {
    parameters: [
      { name: "unit", type: "string", values: ["day", "month"] },
      { name: "at", type: ["date", "string"] },
    ],
    optional: [{ name: "fallback", type: "number", nullable: true }],
    rest: null,
  };
  expect(parameterTexts(definition).map(({ text }) => text)).toEqual([
    'unit: "day" | "month"',
    "at: date | string",
    "fallback?: number | null",
  ]);
});

it("writes a result whose type varies as any", () => {
  expect(resultText(null)).toBe("any");
  expect(signatureText("if", { ...IF_FUNCTION, returns: null })).toBe(
    "if(condition: any, then: any, else?: any) → any",
  );
});
