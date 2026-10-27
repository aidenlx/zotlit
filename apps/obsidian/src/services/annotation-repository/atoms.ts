// Shared repository observations for view models and card layouts.
import { Effect, Stream } from "effect";
import * as Atom from "effect/reactivity/Atom";

import { held, viewRuntime } from "@/lib/view-atoms";
import type { Held } from "@/services/query-client/service";

import { AnnotationRepository } from "./service";
import type {
  AnnotationList,
  AnnotationState,
  EditingCapability,
} from "./service";

/** A batch can change several cards before the registry publishes one update. */
export const annotationChangeAtom = held<ReadonlyMap<string, AnnotationState>>(
  Stream.unwrap(
    Effect.map(AnnotationRepository, (repository) =>
      repository.annotationChanged.pipe(
        Stream.mapEffect((key) =>
          Effect.map(
            repository.annotationState(key),
            (state) => [key, state] as const,
          ),
        ),
        Stream.scan(
          (): ReadonlyMap<string, AnnotationState> => new Map(),
          (states, [key, state]) => new Map(states).set(key, state),
        ),
      ),
    ),
  ),
  new Map(),
);

interface ListChange {
  readonly key: string;
  readonly held: Held<AnnotationList> | null;
}

export const annotationListsChangeAtom = held<ReadonlyMap<string, ListChange>>(
  Stream.unwrap(
    Effect.map(AnnotationRepository, (repository) =>
      repository.annotationsChanged.pipe(
        Stream.mapEffect((key) =>
          Effect.map(repository.peek(key), (held) => ({ key, held })),
        ),
        Stream.scan(
          (): ReadonlyMap<string, ListChange> => new Map(),
          (changes, event) => new Map(changes).set(event.key, event),
        ),
      ),
    ),
  ),
  new Map(),
);

export const annotationCapabilityAtom = held<EditingCapability>(
  Stream.unwrap(
    Effect.map(AnnotationRepository, (repository) =>
      Stream.concat(Stream.make(null), repository.capabilityChanges).pipe(
        Stream.mapEffect(() => repository.capability),
      ),
    ),
  ),
  { kind: "read-only", reason: "probing" },
);

export const attachmentCapabilityAtom = Atom.family((key: string) =>
  viewRuntime.atom((get) => {
    get(annotationCapabilityAtom);
    return Effect.flatMap(AnnotationRepository, (repository) =>
      repository.capabilityFor(key),
    );
  }),
);
