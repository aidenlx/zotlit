// Caller-sized answers for citation consumer fixtures.
import { CitationLookupAnswer } from "@/services/citation-index/lookup";
import type { CitekeyResolution } from "@/services/citation-index/snapshot";

export function lookupAnswer(
  citekeys: Record<string, CitekeyResolution> = {},
  indexedKeys: Record<string, string | null> = {},
  revision = "fixture:1",
): CitationLookupAnswer {
  return new CitationLookupAnswer({
    revision,
    citekeys: new Map(Object.entries(citekeys)),
    indexedKeys: new Map(Object.entries(indexedKeys)),
  });
}

export function lookupForWorks(
  works: ReadonlyMap<string, string>,
): CitationLookupAnswer {
  return lookupAnswer(Object.fromEntries([...works].map(([citekey, indexedKey]) => [citekey, {
    kind: "unique" as const,
    item: {itemID: 1, libraryID: 1, key: indexedKey, indexedKey},
  }])));
}
