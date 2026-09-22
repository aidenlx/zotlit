// Available outcomes for consumer tests whose subject is not excerpt identity.
import type { ExcerptOutcome } from "@/services/excerpt-image/service";

/**
 * The identity a consumer test does not read. Consumers that persist or
 * revalidate an excerpt read the real identity from the service instead.
 */
const FIXTURE_IDENTITY = {
  key: "fixture-key",
  fingerprint: "fixture-fingerprint",
  pdf: null,
};

/** An available outcome carrying a present, unremarkable identity. */
export function availableOutcome(
  outcome: Omit<
    Extract<ExcerptOutcome, { kind: "available" }>,
    "kind" | "identity"
  >,
): Extract<ExcerptOutcome, { kind: "available" }> {
  return { kind: "available", ...outcome, identity: FIXTURE_IDENTITY };
}
