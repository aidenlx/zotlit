// The Reading Card's per-leaf target, delayed row preview and interruptible data read.
import { useAtomValue } from "@effect/atom-react";
import { Effect, Option, Stream } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import { createContext, useContext } from "react";

import { recover } from "@/lib/effect-cause";
import { withLogCategory } from "@/lib/effect-log";
import { viewRuntime } from "@/lib/view-atoms";
import { QueryService } from "@/services/item-query/service";
import { libraryScopeStateAtom } from "@/services/library-scope/atoms";
import { libraryLabel } from "@/services/library-scope/label";
import type { LibraryScope } from "@/services/library-scope/scope";
import { notedItemKeysAtom } from "@/services/note-index/atoms";
import { zoteroRevisionAtom } from "@/services/zotero-reads/atoms";

import {
  cardItem,
  previewItem,
  quoteOf,
  QUOTED,
  QUOTE_PATHS,
} from "./card-data";
import type { CardItem, Values } from "./card-data";
import { CARD_PATHS } from "./card-fields";
import type { ReadingCardDisclosures } from "./document";
import { libraryOf, sameLibrary } from "./tree";

export interface CardSession {
  readonly key: string | null;
  readonly disclosures: ReadingCardDisclosures;
}
interface CardLoad {
  readonly key: string | null;
  readonly item: CardItem | null;
  readonly loading: boolean;
}
const EMPTY: CardLoad = { key: null, item: null, loading: false };
export const patchCard =
  (patch: Partial<CardSession>) =>
  (state: CardSession): CardSession =>
    Object.entries(patch).every(
      ([key, value]) => state[key as keyof CardSession] === value,
    )
      ? state
      : { ...state, ...patch };
export function cardLibraries(key: string | null): LibraryScope {
  const library = key === null ? null : libraryOf(key);
  return { mode: "selected", libraries: library ? [library] : [] };
}

export function makeCardModel(row: (key: string) => Values | null) {
  const session = Atom.make<CardSession>({
    key: null,
    disclosures: { allFields: false, annotations: false },
  });
  const target = Atom.map(session, (s) => s.key);
  const loaded = viewRuntime.atom((get) => {
    const key = get(target);
    get(zoteroRevisionAtom);
    if (key === null) return Stream.make(EMPTY);
    const previous = Option.getOrElse(
      get
        .self<AsyncResult.AsyncResult<CardLoad>>()
        .pipe(Option.flatMap((result) => AsyncResult.value(result))),
      () => EMPTY,
    );
    const values = row(key);
    const preview: CardLoad = {
      key,
      item: values && previewItem(values),
      loading: true,
    };
    const scope = get.once(libraryScopeStateAtom);
    const selector = libraryOf(key);
    const library = selector
      ? libraryLabel(
          scope.current?.available.find((l) =>
            sameLibrary(l.selector, selector),
          ) ?? { selector, libraryID: 0, name: null },
        )
      : null;
    const fallback: CardLoad = {
      ...(previous.key === key && !previous.loading ? previous : preview),
      loading: false,
    };
    const read = Effect.gen(function* () {
      const query = yield* QueryService;
      const [outcome, quotes] = yield* Effect.all(
        [
          query.run({
            from: "items",
            filter: `${JSON.stringify([key])}.contains(indexedKey)`,
            fields: [...CARD_PATHS],
            limit: 1,
            libraries: cardLibraries(key),
          }),
          query
            .run({
              from: "annotations",
              filter: "item == this.item",
              context: { item: key },
              fields: [...QUOTE_PATHS],
              limit: QUOTED,
              libraries: cardLibraries(key),
            })
            .pipe(
              Effect.map((outcome) =>
                outcome.kind === "result"
                  ? (outcome.result.rows ?? []).map((r) =>
                      quoteOf(r.indexedKey, r.values),
                    )
                  : [],
              ),
              recover(
                (error) =>
                  Effect.logWarning(
                    "The Reading Card could not read its first Annotations",
                    { error, indexedKey: key },
                  ),
                Effect.succeed([]),
              ),
            ),
        ],
        { concurrency: "unbounded" },
      );
      const values =
        outcome.kind === "result" ? outcome.result.rows?.[0]?.values : null;
      return values
        ? { key, item: cardItem(values, library, quotes), loading: false }
        : fallback;
    }).pipe(
      recover(
        (error) =>
          Effect.logWarning("The Reading Card could not read its Item", {
            error,
            indexedKey: key,
          }),
        Effect.succeed(fallback),
      ),
      withLogCategory("library-view", "reading-card"),
    );
    if (previous.key === null)
      return Stream.concat(Stream.make(preview), Stream.fromEffect(read));
    if (previous.key === key) return Stream.fromEffect(read);
    return Stream.merge(
      Stream.fromEffect(Effect.as(Effect.sleep(150), preview)),
      Stream.fromEffect(read),
    ).pipe(Stream.takeUntil((state) => !state.loading));
  });
  const state = Atom.make((get) => {
    const current = get(session);
    const data = Option.getOrElse(AsyncResult.value(get(loaded)), () => EMPTY);
    return {
      ...data,
      disclosures: current.disclosures,
      noted: data.key !== null && get(notedItemKeysAtom).has(data.key),
    };
  });
  return { session, loaded, state };
}

export type CardModel = ReturnType<typeof makeCardModel>;

const CardModelContext = createContext<CardModel | null>(null);
export const CardModelProvider = CardModelContext.Provider;

export function useCardState<A>(
  select: (state: Atom.Type<CardModel["state"]>) => A,
): A {
  const model = useContext(CardModelContext);
  if (!model)
    throw new Error("useCardState must be used within CardModelProvider");
  return useAtomValue(model.state, select);
}
