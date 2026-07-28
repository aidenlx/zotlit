// Typed error naming an inert JavaScript-Templates artifact an operation requires.

/**
 * Thrown when an operation requires an artifact the JavaScript Templates gate
 * keeps inert: dispatching a render to a name whose winning file is an inert
 * `.eta.md`, or consuming the compiled frontmatter set while it excludes
 * `javascript`-language fields. The message is a localized user message naming
 * the artifact, ready to surface verbatim in operation failure toasts.
 */
export class InertTemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InertTemplateError";
  }
}
