// Typed errors the template service raises: an inert JavaScript-Templates
// artifact an operation requires, and a refused Shared Partial name.

import type { PartialNameRefusal } from "./defaults";

/**
 * Thrown when an operation requires an artifact the JavaScript Templates gate
 * keeps inert: dispatching a render to a name whose winning file is an inert
 * `.eta.md`, or consuming the compiled frontmatter set while it excludes
 * `javascript`-language fields. The message is a localized user message naming
 * the artifact, ready to surface verbatim in operation failure toasts.
 */
export class InertTemplateError extends Error {
  /**
   * The inert Template's name. Absent in exactly one case: the inert artifact
   * is the managed-frontmatter field set, which is a field list rather than a
   * named Template (see `TemplateService.frontmatterFields`). Every failure
   * raised on a render path carries a name.
   */
  readonly templateName: string | undefined;

  constructor(message: string, templateName?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "InertTemplateError";
    this.templateName = templateName;
  }
}

/**
 * Thrown when a name breaks the Shared Partial rule every entry point shares:
 * letters, digits, and hyphens, free of the reserved names, and unique in the
 * vault. Every entry point judges the name with `partialNameRefusal` before it
 * calls, so this is the service's last guard: the message reads in a log, and
 * `refusal` names the clause that refused.
 */
export class PartialNameError extends Error {
  readonly partialName: string;
  readonly refusal: PartialNameRefusal;

  constructor(partialName: string, refusal: PartialNameRefusal) {
    super(`Refused the Shared Partial name '${partialName}': ${refusal}`);
    this.name = "PartialNameError";
    this.partialName = partialName;
    this.refusal = refusal;
  }
}
