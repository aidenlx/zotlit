// Shared Literature Note navigation for Quick Switch, Library rows and Companion links.
import { Effect } from "effect";
import { MarkdownView } from "obsidian";
import type { PaneType, TFile } from "obsidian";

import type { Item } from "@zotlit/db";

import { recover } from "@/lib/effect-cause";
import { withLogCategory } from "@/lib/effect-log";
import { Workspace } from "@/lib/obsidian-workspace";
import { NoteIndex } from "@/services/note-index/service";
import { UseLedger } from "@/services/use-ledger/service";
import { ZoteroReads } from "@/services/zotero-reads/service";

import type { CompanionLinkOptions } from "./companion-view";
import { createNoteInteractively } from "./creation-view";
import type { InteractiveCreationPorts } from "./creation-view";
import type { CompanionNoteTarget } from "./operations";
import { NoteFeature } from "./service";
import {
  resolveLiteratureNoteWithWarning,
  updateWithNotice,
  updateNoteToast,
} from "./update-single";

/** How opening or creating a Literature Note ended. */
export type LiteratureNoteOutcome =
  /** The note resolution refused the link; nothing opened. */
  | { readonly outcome: "refused"; readonly target: CompanionNoteTarget }
  /**
   * An existing note opened and stayed as it was: its Profile stamp was kept
   * or carries a diagnostic.
   */
  | { readonly outcome: "opened-as-is"; readonly target: CompanionNoteTarget }
  /** An existing note opened, and updated when the link asked for it. */
  | { readonly outcome: "opened"; readonly file: TFile }
  /** A metadata-only update found no note, so it created none. */
  | { readonly outcome: "metadata-no-note" }
  /** No Item is available for creation. */
  | { readonly outcome: "item-not-found" }
  /** A note was created and opened. */
  | { readonly outcome: "created"; readonly file: TFile }
  /** The creation wrote no note: the user cancelled, or the create failed. */
  | { readonly outcome: "not-created" };

type LiteratureNoteOptions =
  | ({ readonly source: "companion" } & CompanionLinkOptions)
  | {
      readonly source: "interactive";
      readonly item?: Item;
      readonly paneType: PaneType | boolean;
    };

/** Open an existing Literature Note or create one through Profile selection. */
export const openLiteratureNote = Effect.fn("openLiteratureNote")(function* (
  deps: InteractiveCreationPorts,
  indexedKey: string,
  options: LiteratureNoteOptions,
) {
  const workspace = yield* Workspace;
  const noteFeature = yield* NoteFeature;
  const ended = (outcome: LiteratureNoteOutcome) => outcome;
  const open = Effect.fnUntraced(function* (file: TFile) {
    if (options.source === "interactive" && !options.paneType) {
      const existing = (yield* workspace.leavesOfType("markdown")).find(
        (leaf) => leaf.view instanceof MarkdownView && leaf.view.file === file,
      );
      if (existing) {
        yield* workspace.revealLeaf(existing);
        yield* workspace.setActiveLeaf(existing, { focus: true });
        return;
      }
    }
    const navigate = workspace.openLinkText(file.path, "", {
      newLeaf: options.paneType ?? false,
      state: { active: true },
    });
    return yield* options.source === "companion" && options.action === "update"
      ? (yield* UseLedger).withoutNoteUse(file, navigate)
      : navigate;
  });
  const target: CompanionNoteTarget =
    options.source === "companion"
      ? yield* noteFeature.resolveCompanionNote(indexedKey, {
          profile: options.profile,
        })
      : yield* Effect.gen(function* () {
          const index = yield* NoteIndex;
          yield* index.whenIndexed;
          const files = yield* index.getNotesByItemKey(indexedKey);
          const [file, ...rest] = files;
          return file
            ? { outcome: "existing" as const, files: [file, ...rest] as const }
            : { outcome: "create" as const };
        });
  if (target.outcome === "refused")
    return ended({ outcome: "refused", target });
  if (target.outcome === "existing") {
    const file = resolveLiteratureNoteWithWarning(target.files)!;
    yield* open(file);
    if (target.keptProfile || target.diagnostic)
      return ended({ outcome: "opened-as-is", target });
    if (options.source === "companion" && options.action === "update") {
      const scope = options.scope ?? "full";
      yield* updateWithNotice(
        file,
        { indexedKey, scope },
        updateNoteToast(scope, { app: deps.app }),
      );
    }
    return ended({ outcome: "opened", file });
  }
  if (
    options.source === "companion" &&
    options.action === "update" &&
    options.scope === "metadata"
  )
    return ended({ outcome: "metadata-no-note" });
  const readItem = Effect.gen(function* () {
    const source = yield* ZoteroReads;
    const reads =
      options.source === "interactive" ? yield* source.snapshot : source.reads;
    return (yield* reads.ItemsByIndexedKeys({ indexedKeys: [indexedKey] })).get(
      indexedKey,
    );
  }).pipe(Effect.scoped);
  const item =
    options.source === "interactive"
      ? (options.item ??
        (yield* readItem.pipe(
          recover(
            (error) =>
              Effect.logWarning("The Library View could not read an Item", {
                indexedKey,
                error,
              }).pipe(withLogCategory("library-view", "item-actions")),
            Effect.void,
          ),
        )))
      : yield* readItem;
  if (!item) return ended({ outcome: "item-not-found" });
  const file = yield* createNoteInteractively(deps, item, {
    ...(options.source === "companion" && {
      headless: options.profile,
      direct: true,
    }),
  });
  if (!file) return ended({ outcome: "not-created" });
  yield* open(file);
  return ended({ outcome: "created", file });
});
