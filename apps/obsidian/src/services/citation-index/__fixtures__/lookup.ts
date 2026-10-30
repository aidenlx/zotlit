// Caller-sized answers for citation consumer fixtures.
import { CitationLookupAnswer } from "@/services/citation-index/lookup";
import type { CitekeyResolution } from "@/services/citation-index/snapshot";

export function lookupAnswer(
  citekeys: Record<string, CitekeyResolution> = {},
  indexedKeys: Record<string, string | null> = {},
  revision = "fixture:1",
): CitationLookupAnswer {
  return new CitationLookupAnswer({
    annotationKeys: new Map(),
    revision,
    citekeys: new Map(Object.entries(citekeys)),
    indexedKeys: new Map(Object.entries(indexedKeys)),
  });
}

/** An answer to a request for `requested` Citekeys: each resolves as `resolutions` says, else it is missing. */
export function lookupAnswerFor(
  requested: readonly string[],
  resolutions: Readonly<Record<string, CitekeyResolution>> = {},
  revision = "fixture:1",
): CitationLookupAnswer {
  return lookupAnswer(
    Object.fromEntries(
      requested.map((citekey) => [
        citekey,
        resolutions[citekey] ?? { kind: "missing" as const },
      ]),
    ),
    {},
    revision,
  );
}

export function lookupForWorks(
  works: ReadonlyMap<string, string | null>,
): CitationLookupAnswer {
  return lookupAnswer(Object.fromEntries([...works].map(([citekey, indexedKey]) => [citekey,
    indexedKey === null ? { kind: "missing" as const } : {
      kind: "unique" as const,
      item: {itemID: 1, libraryID: 1, key: indexedKey, indexedKey},
    },
  ])));
}
