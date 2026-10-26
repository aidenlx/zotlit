// Template and Profile calls as the Workbench's plain callers answered them:
// a failure is what the Template or the Profile store threw.
import { Cause, Effect, Exit, Result } from "effect";

import type { CompiledFrontmatterField } from "@zotlit/templates/frontmatter";

import type { ProfileOperationError } from "@/services/profile/service";
import { plainTemplateError } from "@/services/template/errors";
import { Template } from "@/services/template/service";
import type {
  TemplateFailure,
  TemplateOperations,
} from "@/services/template/service";

/**
 * A Template call that fails with what the Template threw, as `Effect.try`
 * over the plain call did. A defect stays a defect.
 */
export const templateCall = <A, R>(
  effect: Effect.Effect<A, TemplateFailure, R>,
): Effect.Effect<A, unknown, R> =>
  Effect.mapError(effect, (error) => plainTemplateError(error));

/**
 * A Profile call that fails with what the store threw, as `Effect.try` over
 * the plain call did. A defect stays a defect.
 */
export const profileCall = <A, R>(
  effect: Effect.Effect<A, ProfileOperationError, R>,
): Effect.Effect<A, unknown, R> =>
  effect.pipe(
    Effect.catchTag("ProfileOperationError", (error) =>
      Effect.fail(error.cause),
    ),
  );

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
  const read = <A>(effect: Effect.Effect<A, TemplateFailure>): A => {
    const exit = runSync(Effect.exit(effect));
    if (Exit.isSuccess(exit)) return exit.value;
    const failure = Cause.findError(exit.cause);
    throw Result.isSuccess(failure)
      ? plainTemplateError(failure.success)
      : Cause.squash(exit.cause);
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
