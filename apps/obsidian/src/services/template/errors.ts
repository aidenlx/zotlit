// Typed error naming an inert JavaScript-Templates artifact an operation requires.

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
