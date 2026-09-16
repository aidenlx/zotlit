// The Annotation View's structural dependencies, as a test supplies them.

import type { AnnotationRepository } from "@/services/annotation-repository/service";
import { IDLE } from "@/services/annotation-repository/write";

/**
 * The repository's capability and write surface for a view test that is not
 * about writing: a session no probe has answered for yet, and commands nothing
 * calls. The write path's own tests drive the real repository.
 */
export function readOnlyWrites(): Pick<
  AnnotationRepository,
  | "capability"
  | "capabilityFor"
  | "deleteAnnotation"
  | "mutationFor"
  | "patchColor"
  | "patchComment"
> {
  const capability = { kind: "read-only", reason: "probing" } as const;
  return {
    capability,
    capabilityFor: () => capability,
    mutationFor: () => IDLE,
    patchColor: () => Promise.resolve(IDLE),
    patchComment: () => Promise.resolve(IDLE),
    deleteAnnotation: () => Promise.resolve(IDLE),
  };
}
