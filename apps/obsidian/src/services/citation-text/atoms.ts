// The held citation text of one note, shared by its reading surfaces.
import { Effect, Stream } from "effect";
import * as Atom from "effect/reactivity/Atom";

import { held } from "@/lib/view-atoms";

import { CitationText } from "./service";

export const entrySerialsAtom = Atom.family((path: string) =>
  held(
    Stream.unwrap(
      Effect.gen(function* () {
        const text = yield* CitationText;
        return Stream.merge(
          Stream.make(undefined),
          text.events.pipe(
            Stream.filter(
              (event) => event.type === "changed" && event.path === path,
            ),
            Stream.map(() => undefined),
          ),
        ).pipe(
          Stream.mapEffect(() => text.peek(path)),
          Stream.map((record) => record?.value.entrySerials ?? false),
          Stream.changes,
        );
      }),
    ),
    false,
  ),
);
