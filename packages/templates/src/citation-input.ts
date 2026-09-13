// Runtime provenance for direct Citation Item reads in Liquid Citation text.
import { evalQuotedToken, toValueSync, TypeGuards, Value } from "liquidjs";
import type { Context, Liquid, Template } from "liquidjs";

import { PandocCitationError } from "./pandoc-citation";

/** The formatter rejected a direct Citation Item read from the template's entry root. */
export class CitationInputError extends Error {
  constructor(cause: PandocCitationError) {
    super(cause.message, { cause });
    this.name = "CitationInputError";
  }
}

/**
 * Track the entry root separately from later Liquid assignments. Only the
 * executed first filter on a direct `zt.citations` read can name that root as
 * its input; literals, other reads, and preceding filters carry no such proof.
 */
export function withCitationInputProvenance(
  templates: Template[],
  liquid: Liquid,
): Template[] {
  const first = templates[0];
  if (!first) return templates;
  const entries = new WeakMap<Context, { root: unknown }>();
  let instrumented = false;

  function instrument(children: Template[]): void {
    for (const template of children) {
      for (const argument of template.arguments?.() ?? []) {
        if (!(argument instanceof Value)) continue;
        const [operand, ...rest] = argument.initial.postfix;
        const filter = argument.filters[0];
        if (
          !operand ||
          rest.length > 0 ||
          !TypeGuards.isPropertyAccessToken(operand) ||
          operand.variable !== undefined ||
          operand.props.length !== 2 ||
          filter?.name !== "pandoc_cite"
        )
          continue;
        const path = operand.props.map((part) =>
          TypeGuards.isWordToken(part)
            ? part.content
            : TypeGuards.isQuotedToken(part)
              ? evalQuotedToken(part)
              : undefined,
        );
        if (path[0] !== "zt" || path[1] !== "citations") continue;
        instrumented = true;
        const render = filter.render;
        filter.render = function* (value, context) {
          const entry = entries.get(context);
          const fromCaller =
            entry !== undefined && context.getSync(["zt"]) === entry.root;
          try {
            return yield* render.call(this, value, context);
          } catch (error) {
            if (
              fromCaller &&
              error instanceof PandocCitationError &&
              error.code === "invalid-input" &&
              error.property === "items"
            )
              throw new CitationInputError(error);
            throw error;
          }
        };
      }
      if (template.children)
        instrument(toValueSync(template.children(false, true)));
    }
  }
  instrument(templates);
  if (!instrumented) return templates;
  return [
    {
      token: first.token,
      *children() {
        return templates;
      },
      *render(context, emitter) {
        const previous = entries.get(context);
        entries.set(context, {
          root: context.getSync(["zt"]),
        });
        try {
          yield* liquid.renderer.renderTemplates(templates, context, emitter);
        } finally {
          if (previous) entries.set(context, previous);
          else entries.delete(context);
        }
      },
    },
  ];
}
