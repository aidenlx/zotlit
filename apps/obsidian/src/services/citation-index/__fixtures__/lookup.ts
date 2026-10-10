// Caller-sized answers for citation consumer fixtures.
import { CitationLookupAnswer } from "@/services/citation-index/lookup";
import type { CitekeyResolution } from "@/services/citation-index/snapshot";

export function lookupAnswer(
  citekeys: Record<string, CitekeyResolution> = {},
  indexedKeys: Record<string, string | null> = {},
): CitationLookupAnswer {
  return new CitationLookupAnswer({
    revision: "fixture:1",
    citekeys: new Map(Object.entries(citekeys)),
    indexedKeys: new Map(Object.entries(indexedKeys)),
  });
}
