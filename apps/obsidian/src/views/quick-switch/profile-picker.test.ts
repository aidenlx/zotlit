import { SuggestModal } from "obsidian";
import type { App } from "obsidian";
import { expect, it, vi } from "vitest";

import type { ProfileId } from "@/lib/profile-stamp";
import type { LiteratureNoteProfile } from "@/services/profile/service";

import { chooseLiteratureNoteProfile } from "./profile-picker";
import type { LiteratureNoteProfileChoice } from "./profile-picker";

const books: LiteratureNoteProfile = {
  id: "Bk3Qn7XvT2Lp" as ProfileId,
  label: "Books",
  document: "zotlit-profile.books.md",
  path: "templates/zotlit-profile.books.md",
  bindings: {},
};

it("places the preselected Profile at the initial keyboard choice", async () => {
  using opened = vi.spyOn(SuggestModal.prototype, "open");
  const choice = chooseLiteratureNoteProfile({} as App, [books], {
    preselected: books.id,
  });
  const modal = opened.mock
    .instances[0] as SuggestModal<LiteratureNoteProfileChoice>;
  const rows = await modal.getSuggestions("");
  expect(rows.map(({ id }) => id)).toEqual([books.id, "default"]);
  modal.onChooseSuggestion(rows[0]!, {} as KeyboardEvent);
  await expect(choice).resolves.toMatchObject({ id: books.id });
});

it("keeps Default first without preselection and resolves dismissal without a choice", async () => {
  using opened = vi.spyOn(SuggestModal.prototype, "open");
  const choice = chooseLiteratureNoteProfile({} as App, [books]);
  const modal = opened.mock
    .instances[0] as SuggestModal<LiteratureNoteProfileChoice>;
  const rows = await modal.getSuggestions("");
  expect(rows.map(({ id }) => id)).toEqual(["default", books.id]);
  modal.onClose();
  await expect(choice).resolves.toBeUndefined();
});
