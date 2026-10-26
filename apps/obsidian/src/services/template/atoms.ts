// Shared revision of the service inputs a preview renders.
import { Effect, Stream } from "effect";

import { held } from "@/lib/view-atoms";
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
