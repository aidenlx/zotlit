// What one Shared Partial preview renders: the caller the reader chose to see
// the partial as called from, and the Profile whose bindings build its data.

/**
 * The caller a Shared Partial is previewed as called from, which picks the
 * root data the partial reads. It is the reader's own choice, remembered per
 * file: ADR 0050 rules out reading it off the callers, since a partial nothing
 * calls yet, and one two roots call, name no single caller to read it from.
 * This comment is the one place that argument is made; elsewhere link here.
 */
export type PartialContext = "note" | "annotation" | "citation";

/** Every context, in the order the preview's menu offers them. */
export const PARTIAL_CONTEXTS = [
  "note",
  "annotation",
  "citation",
] as const satisfies readonly PartialContext[];

/** The context a partial's preview opens with, which is the common case. */
export const DEFAULT_PARTIAL_CONTEXT: PartialContext = "note";

export function isPartialContext(value: unknown): value is PartialContext {
  return (PARTIAL_CONTEXTS as readonly unknown[]).includes(value);
}

/**
 * The two choices one Shared Partial preview is shown under, which every pane
 * that follows the editor reads together.
 */
export interface PartialChoice {
  readonly context: PartialContext;
  /**
   * The Profile whose bindings build the data, by its own id; null names the
   * default Profile, which is what a vault with one Profile always renders
   * under.
   */
  readonly profile: string | null;
}

/** The partial one render draws, under the choice it draws it with. */
export interface PartialPreviewSelection extends PartialChoice {
  /** The partial's own name, which the render reports faults against. */
  readonly name: string;
}
