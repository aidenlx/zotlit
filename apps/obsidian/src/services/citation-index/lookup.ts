// A bounded projection of one worker-owned citation revision.
import type { CitekeyResolution } from "./snapshot";

export interface CitationLookupRequest {
  citekeys?: readonly string[];
  indexedKeys?: readonly string[];
}

export interface CitationLookupWireAnswer {
  readonly revision: string;
  readonly citekeys: ReadonlyMap<string, CitekeyResolution>;
  readonly indexedKeys: ReadonlyMap<string, string | null>;
}

/** Only requested keys are retained. Missing and unrequested stay distinct. */
export class CitationLookupAnswer {
  readonly revision;
  readonly #citekeys;
  readonly #indexedKeys;

  constructor(answer: CitationLookupWireAnswer) {
    this.revision = answer.revision;
    this.#citekeys = answer.citekeys;
    this.#indexedKeys = answer.indexedKeys;
  }

  resolve(citekey: string): CitekeyResolution | null {
    return this.#citekeys.get(citekey) ?? null;
  }

  citekeyOf(indexedKey: string): string | null | undefined {
    return this.#indexedKeys.get(indexedKey);
  }
}
