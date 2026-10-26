// Shared revision of the service inputs a preview renders.
import { Effect, Stream } from "effect";

import { held } from "@/lib/view-atoms";
import {
  BibliographyRender,
  renderInvalidated,
} from "@/services/pandoc/render-cache";
export const bibliographyRevisionAtom = held(
  Stream.unwrap(
    Effect.gen(function* () {
      const service = yield* BibliographyRender;
      return Stream.scan(
        renderInvalidated(service),
        () => 0,
        (revision) => revision + 1,
      );
    }),
  ),
  0,
);
