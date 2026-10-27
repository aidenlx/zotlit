// Shared Literature Note navigation for Quick Switch, Library rows and Companion links.
import { Effect } from "effect";
import type { Cause } from "effect";
import type { RpcClientError } from "effect/rpc";
import { MarkdownView } from "obsidian";
import type { PaneType, TFile } from "obsidian";

import type { Item } from "@zotlit/db";

import { Workspace } from "@/lib/obsidian-workspace";
import type { OpenLinkFailed } from "@/lib/obsidian-workspace";
import type { ItemQueryError } from "@/services/item-query/service";
import { NoteIndex } from "@/services/note-index/service";
import type { ProfileOperationError } from "@/services/profile/service";
import type { TemplateFailure } from "@/services/template/service";
import { UseLedger } from "@/services/use-ledger/service";
import { readActionItem } from "@/services/zotero-reads/read-item";
import type {
  DbUnavailable,
  SnapshotExpired,
} from "@/services/zotero-reads/rpc";
import { ZoteroReads } from "@/services/zotero-reads/service";
import type { ProfileDialogServices } from "@/setting-tab/profile-dialogs";

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
export const openLiteratureNote = Effect.fn("LiteratureNoteNavigation.open")(
  function* (
    deps: InteractiveCreationPorts,
    indexedKey: string,
    options: LiteratureNoteOptions,
  ): Effect.fn.Return<
    LiteratureNoteOutcome,
    | ProfileOperationError
    | DbUnavailable
    | SnapshotExpired
    | RpcClientError.RpcClientError
    | ItemQueryError
    | TemplateFailure
    | OpenLinkFailed
    | Cause.UnknownError,
    Workspace | NoteIndex | UseLedger | ZoteroReads | ProfileDialogServices
  > {
    const workspace = yield* Workspace;
    const noteFeature = yield* NoteFeature;
    const open = Effect.fnUntraced(function* (file: TFile) {
      if (options.source === "interactive" && !options.paneType) {
        const existing = (yield* workspace.leavesOfType("markdown")).find(
          (leaf) =>
            leaf.view instanceof MarkdownView && leaf.view.file === file,
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
      return yield* options.source === "companion" &&
      options.action === "update"
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
              ? {
                  outcome: "existing" as const,
                  files: [file, ...rest] as const,
                }
              : { outcome: "create" as const };
          });
    if (target.outcome === "refused") return { outcome: "refused", target };
    if (target.outcome === "existing") {
      const file = resolveLiteratureNoteWithWarning(target.files)!;
      yield* open(file);
      if (target.keptProfile || target.diagnostic)
        return { outcome: "opened-as-is", target };
      if (options.source === "companion" && options.action === "update") {
        const scope = options.scope ?? "full";
        yield* updateWithNotice(
          file,
          { indexedKey, scope },
          updateNoteToast(scope, { app: deps.app }),
        );
      }
      return { outcome: "opened", file };
    }
    if (
      options.source === "companion" &&
      options.action === "update" &&
      options.scope === "metadata"
    )
      return { outcome: "metadata-no-note" };
    const item =
      options.source === "interactive"
        ? (options.item ?? (yield* readActionItem(indexedKey)))
        : (yield* (yield* ZoteroReads).reads.ItemsByIndexedKeys({
            indexedKeys: [indexedKey],
          })).get(indexedKey);
    if (!item) return { outcome: "item-not-found" };
    const file = yield* createNoteInteractively(deps, item, {
      ...(options.source === "companion" && {
        headless: options.profile,
        direct: true,
      }),
    });
    if (!file) return { outcome: "not-created" };
    yield* open(file);
    return { outcome: "created", file };
  },
);
