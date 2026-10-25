// The view's clock and its ledger's Uses, for tests: the view is plain code,
// so it reads Temporal.
import { vi } from "vitest";

import type { PlainUse } from "@/services/use-ledger/plain";
import type { UseKind } from "@/services/use-ledger/service";

/** Hold the view's clock at `iso`; the returned spy restores it. */
export function holdNow(iso: string) {
  return vi
    .spyOn(Temporal.Now, "instant")
    .mockReturnValue(Temporal.Instant.from(iso));
}

/** A `kind` Use at `iso`. */
export function useAt(kind: UseKind, iso: string): PlainUse {
  return { kind, instant: Temporal.Instant.from(iso) };
}
