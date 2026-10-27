// Shared invalidation of view reads that depend on compiled templates.
import { Effect, Stream } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";

import { viewRuntime, held } from "@/lib/view-atoms";
import { Template } from "@/services/template/service";

export const templateRevisionAtom = held(
  Stream.unwrap(
    Effect.map(Template, (template) =>
      template.compileEvents.pipe(
        Stream.scan(
          () => 0,
          (revision) => revision + 1,
        ),
      ),
    ),
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

/** JavaScript permission follows the template rebuild that applies it. */
export const javascriptTemplatesEnabledAtom = viewRuntime.atom((get) => {
  get(templateRevisionAtom);
  return Effect.flatMap(
    Template,
    (template) => template.javascriptTemplatesEnabled,
  );
});
