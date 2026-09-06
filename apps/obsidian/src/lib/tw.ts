import { createTV } from "tailwind-variants";
import { extendTailwindMerge } from "cn/config";

/** Tailwind v4 `prefix(zt)` — prefix string only, no combining character. */
const PREFIX = "zt";

export const twMerge = extendTailwindMerge({ prefix: PREFIX });

export const tv = createTV({
  twMerge: true,
  twMergeConfig: { prefix: PREFIX },
});
