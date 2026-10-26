// Shared revision of the service inputs a preview renders.
import { Effect, Stream } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";

import { viewRuntime, held } from "@/lib/view-atoms";
import { Template } from "@/services/template/service";

export const templateRevisionAtom = held(
  Stream.unwrap(
    Effect.gen(function* () {
      const service = yield* Template;
      return Stream.scan(
        service.compileEvents,
        () => 0,
        (revision) => revision + 1,
      );
    }),
  ),
  0,
);

export const partialDocumentsAtom = viewRuntime.atom((get) => {
  get(templateRevisionAtom);
  return Effect.gen(function* () {
    const template = yield* Template;
    const status = yield* template.status;
    return status.state === "loaded" ? yield* template.getPartialDocuments : [];
  });
});
export const partialNamesAtom = Atom.map(partialDocumentsAtom, (result) =>
  AsyncResult.isSuccess(result)
    ? result.value.map((partial) => partial.name)
    : [],
);
