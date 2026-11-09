// What the Template Workbench View's reads and previews fail with.
import { Schema } from "effect";

import * as m from "@/lib/i18n/generated/messages";
import { formatErrorMessage } from "@/lib/toast";

/**
 * The chosen Item cannot be read: it is not in the library, it is a child
 * Item, or the database is unavailable.
 */
export class ItemUnavailable extends Schema.TaggedError<
  ItemUnavailable,
  { readonly brand: unique symbol }
>()("ItemUnavailable", {
  indexedKey: Schema.String,
  reason: Schema.Literals(["missing", "child", "degraded"]),
}) {
  override get message(): string {
    return this.reason === "degraded"
      ? m.template_workbench_database_unavailable()
      : m.workbench_example_missing_item();
  }
}

/** A partial preview was asked for before any paper was chosen. */
export class PreviewItemMissing extends Schema.TaggedError<
  PreviewItemMissing,
  { readonly brand: unique symbol }
>()("PreviewItemMissing", {}) {
  override get message(): string {
    return m.workbench_example_missing_item();
  }
}

/** The registered Shared Partial failed to render. The message is the render's own. */
export class PartialPreviewFailed extends Schema.TaggedError<
  PartialPreviewFailed,
  { readonly brand: unique symbol }
>()("PartialPreviewFailed", {
  /** What the render failed with. */
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return formatErrorMessage(this.cause);
  }
}
