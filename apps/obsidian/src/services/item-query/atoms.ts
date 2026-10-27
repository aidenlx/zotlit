// Shared invalidation of Item queries when device Uses change.
import { Effect, Stream } from "effect";

import { held } from "@/lib/view-atoms";

import { QueryService } from "./service";

export const queryRevisionAtom = held(
  Stream.unwrap(
    Effect.map(QueryService, (query) =>
      Stream.scan(
        query.changed,
        () => 0,
        (revision) => revision + 1,
      ),
    ),
  ),
  0,
);
