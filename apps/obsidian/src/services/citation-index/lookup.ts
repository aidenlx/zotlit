// A bounded projection of one worker-owned citation revision.
import type { CitekeyResolution } from "./snapshot";

export interface CitationLookupRequest {
  citekeys?: readonly string[];
  indexedKeys?: readonly string[];
  annotationKeys?: readonly string[];
}

export interface AnnotationParent {
  readonly indexedKey: string;
  readonly citekey: string | null;
}

export interface CitationLookupWireAnswer {
  readonly revision: string;
  readonly citekeys: ReadonlyMap<string, CitekeyResolution>;
  readonly indexedKeys: ReadonlyMap<string, string | null>;
  readonly annotationKeys: ReadonlyMap<string, AnnotationParent | null>;
}

/** Only requested keys are retained. Reading an unrequested key is a programming error. */
export class CitationLookupAnswer {
  readonly revision;
  readonly #citekeys;
  readonly #indexedKeys;
  readonly #annotationKeys;

  constructor(answer: CitationLookupWireAnswer) {
    this.revision = answer.revision;
    this.#citekeys = answer.citekeys;
    this.#indexedKeys = answer.indexedKeys;
    this.#annotationKeys = answer.annotationKeys;
  }

  covers(citekey: string): boolean {
    return this.#citekeys.has(citekey);
  }

  coversIndexedKey(indexedKey: string): boolean {
    return this.#indexedKeys.has(indexedKey);
  }

  coversAnnotationKey(indexedKey: string): boolean {
    return this.#annotationKeys.has(indexedKey);
  }

  /** @returns `null` for a missing Annotation; a parent with a null citekey still has an identity. */
  parentOfAnnotation(indexedKey: string): AnnotationParent | null {
    const parent = this.#annotationKeys.get(indexedKey);
    if (parent === undefined)
      throw new Error(
        `Annotation Indexed Key "${indexedKey}" was not requested`,
      );
    return parent;
  }

  resolve(citekey: string): CitekeyResolution {
    const resolution = this.#citekeys.get(citekey);
    if (resolution === undefined)
      throw new Error(`Citation key "${citekey}" was not requested`);
    return resolution;
  }

  /** @returns `null` when the requested Item has no native Citation Key. */
  citekeyOf(indexedKey: string): string | null {
    const citekey = this.#indexedKeys.get(indexedKey);
    if (citekey === undefined)
      throw new Error(`Indexed Key "${indexedKey}" was not requested`);
    return citekey;
  }
}

/** @returns `null` for pending: no held answer, or it does not cover this key yet. */
export function heldResolution(
  answer: CitationLookupAnswer | null,
  citekey: string,
): CitekeyResolution | null {
  return answer?.covers(citekey) ? answer.resolve(citekey) : null;
}

/** @returns `undefined` for pending; `null` for a covered Item with no native Citation Key. */
export function heldCitekeyOf(
  answer: CitationLookupAnswer | null,
  indexedKey: string,
): string | null | undefined {
  return answer?.coversIndexedKey(indexedKey)
    ? answer.citekeyOf(indexedKey)
    : undefined;
}
