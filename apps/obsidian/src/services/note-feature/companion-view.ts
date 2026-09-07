// Companion navigation decides whether to open, update, or ask before creation.
import type { App } from "obsidian";

import { getItemsByID } from "@zotlit/db";
import type { Item, ItemRef } from "@zotlit/db";
import type { ProtocolAction } from "@zotlit/protocol";

import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";
import type { ProfileSelector } from "@/lib/profile-stamp";
import * as toast from "@/lib/toast";
import type { DatabaseService } from "@/services/database/service";

import { createNoteInteractively } from "./creation-view";
import type { InteractiveCreationDeps } from "./creation-view";
import type {
  CompanionNoteTarget,
  NoteFeature,
  UpdateScope,
} from "./operations";
import {
  noteOperationDiagnosticContent,
  resolveLiteratureNoteWithWarning,
  updateNoteToast,
} from "./update-single";

export interface CompanionNoteDeps extends InteractiveCreationDeps {
  db: Pick<DatabaseService, "acquireRead">;
  noteFeature: InteractiveCreationDeps["noteFeature"] &
    Pick<NoteFeature, "resolveCompanionNote" | "updateNote">;
}

export async function openCompanionNote(
  deps: CompanionNoteDeps,
  ref: ItemRef,
  options: {
    action: ProtocolAction;
    profile?: ProfileSelector;
    scope?: UpdateScope;
  },
): Promise<void> {
  const target = await deps.noteFeature.resolveCompanionNote(ref.indexedKey, {
    profile: options.profile,
  });
  const notice = companionNoteNotice(deps.app, target);
  if (target.outcome === "refused") {
    new BaseNotice(notice!);
    return;
  }
  if (target.outcome === "existing") {
    const file = resolveLiteratureNoteWithWarning(target.files)!;
    await deps.app.workspace.openLinkText(file.path, "", false, {
      active: true,
    });
    if (target.keptProfile || target.diagnostic) {
      new BaseNotice(notice!);
    } else if (options.action === "update") {
      const scope = options.scope ?? "full";
      await toast.promise(
        deps.noteFeature.updateNote(file, {
          indexedKey: ref.indexedKey,
          scope,
        }),
        updateNoteToast(scope, { app: deps.app }),
      );
    }
    return;
  }
  if (options.action === "update" && options.scope === "metadata") {
    new BaseNotice(m.notice_update_metadata_no_note());
    return;
  }
  let item: Item | undefined;
  {
    using lease = await deps.db.acquireRead();
    item = getItemsByID(lease.client, [ref.itemID])[0];
  }
  if (!item) return;
  const file = await createNoteInteractively(deps, item, {
    headless: options.profile,
    direct: true,
  });
  if (file) {
    await deps.app.workspace.openLinkText(file.path, "", false, {
      active: true,
    });
  }
}

export function companionNoteNotice(
  app: App,
  target: CompanionNoteTarget,
): string | DocumentFragment | undefined {
  if (target.outcome !== "create" && target.diagnostic)
    return noteOperationDiagnosticContent(app, target.diagnostic);
  if (target.outcome === "existing" && target.keptProfile)
    return m.notice_literature_note_profile_kept({
      label: target.keptProfile.label ?? m.settings_profile_default_name(),
    });
  return undefined;
}
