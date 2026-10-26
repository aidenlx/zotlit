// Template and Profile calls as the Workbench's plain callers answered them:
// a failure is what the Template or the Profile store threw.
import { Cause, Effect, Exit } from "effect";

import type { CompiledFrontmatterField } from "@zotlit/templates/frontmatter";

import { ProfileOperationError } from "@/services/profile/service";
import { plainTemplateError } from "@/services/template/errors";
import { Template } from "@/services/template/service";
import type {
  TemplateFailure,
  TemplateOperations,
} from "@/services/template/service";

/** A Template call whose failure is a defect carrying what the Template threw. */
export const templateRead = <A, R>(
  effect: Effect.Effect<A, TemplateFailure, R>,
): Effect.Effect<A, never, R> =>
  Effect.orDie(Effect.mapError(effect, (error) => plainTemplateError(error)));

/**
 * A Template call that fails with what the Template threw, defects included,
 * as `Effect.try` over the plain call did.
 */
export const templateCall = <A, R>(
  effect: Effect.Effect<A, TemplateFailure, R>,
): Effect.Effect<A, unknown, R> =>
  Effect.catchCause(effect, (cause) =>
    Effect.fail(plainTemplateError(Cause.squash(cause))),
  );

/**
 * A Profile call that fails with what the store threw, defects included, as
 * `Effect.try` over the plain call did.
 */
export const profileCall = <A, R>(
  effect: Effect.Effect<A, ProfileOperationError, R>,
): Effect.Effect<A, unknown, R> =>
  Effect.catchCause(effect, (cause) => {
    const error = Cause.squash(cause);
    return Effect.fail(
      error instanceof ProfileOperationError ? error.cause : error,
    );
  });

/** A Profile read whose failure is a defect carrying what the store threw. */
export const profileRead = <A, R>(
  effect: Effect.Effect<A, ProfileOperationError, R>,
): Effect.Effect<A, never, R> =>
  Effect.orDie(Effect.mapError(effect, (error) => error.cause));

/**
 * The Template's `render`, `renderCitation`, `renderProfileAnnotation` and
 * `frontmatterFields`, run
 * synchronously on the caller's context. A failure throws what the Template
 * threw, as the getter or helper that runs it expects.
 */
export const syncTemplate: Effect.Effect<
  Pick<
    TemplateOperations,
    | "render"
    | "renderCitation"
    | "renderProfileAnnotation"
    | "frontmatterFields"
  >,
  never,
  Template
> = Effect.gen(function* () {
  const template = yield* Template;
  const runSync = Effect.runSyncWith(yield* Effect.context<never>());
  const read = <A, E>(effect: Effect.Effect<A, E>): A => {
    const exit = runSync(Effect.exit(effect));
    if (Exit.isFailure(exit))
      throw plainTemplateError(Cause.squash(exit.cause));
    return exit.value;
  };
  return {
    render: (name, data) => read(template.render(name, data)),
    renderCitation: (refs, variant) =>
      read(template.renderCitation(refs, variant)),
    renderProfileAnnotation: (data, options) =>
      read(template.renderProfileAnnotation(data, options)),
    get frontmatterFields(): readonly CompiledFrontmatterField[] {
      return read(template.frontmatterFields);
    },
  };
});
