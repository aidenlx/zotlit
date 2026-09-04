// @vitest-environment happy-dom
import { ButtonComponent } from "obsidian";
import type { App } from "obsidian";
import { expect, it, vi } from "vitest";

import * as m from "@/lib/i18n/generated/messages";

import { importedNoteProfileErrorNotice } from "./batch-import-notices";
import { NoteImportProfileError } from "./service";

it("offers recovery on the Literature Note whose unavailable Profile blocked a new child import", () => {
  using click = vi.spyOn(ButtonComponent.prototype, "onClick");
  using label = vi.spyOn(ButtonComponent.prototype, "setButtonText");
  const trigger = vi.fn();
  const notice = importedNoteProfileErrorNotice(
    new NoteImportProfileError("Missing", {
      path: "Literature/Parent.md",
      imported: false,
    }),
    { app: { workspace: { trigger } } as unknown as App },
  );
  expect(notice).toBeInstanceOf(DocumentFragment);
  const content = notice as DocumentFragment;
  expect(content.textContent).toContain(
    m.notice_literature_note_profile_unknown({ stamp: "Missing" }),
  );
  expect(label).toHaveBeenCalledWith(m.profile_switch_recovery());
  click.mock.calls[0]![0]({} as MouseEvent);
  expect(trigger).toHaveBeenCalledWith("zotlit:switch-profile", {
    path: "Literature/Parent.md",
  });
});
