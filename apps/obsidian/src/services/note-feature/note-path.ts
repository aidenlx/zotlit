// A new Literature Note's vault path, rendered and checked against the Vault.
import { Effect, Schema } from "effect";

import { buildFilenameContext } from "@zotlit/db";
import type { Item, ItemTag, TemplateCollection } from "@zotlit/db";
import { joinNotePath } from "@zotlit/templates";

import { creatorSummary } from "@/lib/item-summary";
import { Vault } from "@/lib/obsidian-vault";
import { getProfileBinding } from "@/services/profile/bindings";
import type { ProfileBindingSettings } from "@/services/profile/bindings";
import { Template } from "@/services/template/service";
import type { ResolvedLiteratureNoteTemplate } from "@/services/template/service";

import { freeNotePathSteps } from "./filename";

/**
 * No free path came of the rendered filename: it is empty, or each `suffix()`
 * attempt collided. `message` is the text a preview shows; `cause` holds what
 * the filename resolution threw.
 */
export class NotePathUnavailable extends Schema.TaggedError<
  NotePathUnavailable,
  { readonly brand: unique symbol }
>()("NotePathUnavailable", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

const unavailable = (cause: unknown) =>
  new NotePathUnavailable({
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });

/** `data` rendered by `document`'s filename template. */
export const renderDocumentFilename = (
  document: Pick<ResolvedLiteratureNoteTemplate, "renderFilename">,
  data: object,
) =>
  Effect.try({ try: () => document.renderFilename(data), catch: unavailable });

/**
 * The free path of `rendered` under `folder`. A path the vault holds, or one
 * of `reserved`, is taken.
 */
export const resolveRenderedNotePath = Effect.fnUntraced(function* (
  folder: string,
  rendered: string,
  reserved?: ReadonlySet<string>,
) {
  const vault = yield* Vault;
  const step = (advance: () => IteratorResult<string, string>) =>
    Effect.try({ try: advance, catch: unavailable });
  const steps = freeNotePathSteps(rendered);
  let next = yield* step(() => steps.next());
  while (!next.done) {
    const path = joinNotePath(folder, next.value);
    const taken =
      reserved?.has(path) === true ||
      (yield* vault.getAbstractFileByPath(path)) !== null;
    next = yield* step(() => steps.next(taken));
  }
  return { path: joinNotePath(folder, next.value) };
});

/**
 * The path `item`'s note takes under `settings`' Literature folder, its
 * filename rendered by `document`, or by the settings template without one.
 */
export const resolveNotePath = Effect.fnUntraced(function* (
  item: Item,
  options: {
    itemTags: readonly ItemTag[];
    itemCollections: readonly TemplateCollection[];
    settings: ProfileBindingSettings;
    document?: Pick<ResolvedLiteratureNoteTemplate, "renderFilename">;
    reservedPaths?: ReadonlySet<string>;
  },
) {
  const data = buildFilenameContext({
    item,
    tags: options.itemTags,
    collections: options.itemCollections,
    authorsShort: creatorSummary,
  });
  const rendered = options.document
    ? yield* renderDocumentFilename(options.document, data)
    : yield* (yield* Template).renderFilename(data);
  return yield* resolveRenderedNotePath(
    getProfileBinding(options.settings, "note.literature-folder"),
    rendered,
    options.reservedPaths,
  );
});
