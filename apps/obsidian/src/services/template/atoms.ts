// Shared invalidation of view reads that depend on compiled templates.
import { Effect, Stream } from "effect";

import { held } from "@/lib/view-atoms";

import { Template } from "./service";

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
