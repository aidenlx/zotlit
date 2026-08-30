// @vitest-environment happy-dom
import { SuggestModal } from "obsidian";
import type { App } from "obsidian";
import { expect, it, vi } from "vitest";

import * as m from "@/lib/i18n/generated/messages";
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

it("keeps the preselected choice when Obsidian closes before choosing it", async () => {
  using opened = vi.spyOn(SuggestModal.prototype, "open");
  const choice = chooseLiteratureNoteProfile({} as App, [books], {
    preselected: books.id,
  });
  const modal = opened.mock
    .instances[0] as SuggestModal<LiteratureNoteProfileChoice>;
  const rows = await modal.getSuggestions("");
  expect(rows).toMatchObject([
    { id: books.id },
    { id: "default" },
    { action: "new", label: m.modal_profile_new() },
  ]);
  modal.onClose();
  modal.onChooseSuggestion(rows[0]!, {} as KeyboardEvent);
  await expect(choice).resolves.toMatchObject({ id: books.id });
});

it("keeps Default first without preselection and resolves dismissal without a choice", async () => {
  using opened = vi.spyOn(SuggestModal.prototype, "open");
  const choice = chooseLiteratureNoteProfile({} as App, [books]);
  const modal = opened.mock
    .instances[0] as SuggestModal<LiteratureNoteProfileChoice>;
  const rows = await modal.getSuggestions("");
  expect(rows).toMatchObject([
    { id: "default" },
    { id: books.id },
    { action: "new", label: m.modal_profile_new() },
  ]);
  modal.onClose();
  await expect(choice).resolves.toBeUndefined();
});

it("renders effective folders, style titles, templates, paths and the selected source for every Profile", async () => {
  using opened = vi.spyOn(SuggestModal.prototype, "open");
  const choice = chooseLiteratureNoteProfile({} as App, {
    preselected: books.id,
    source: "headless",
    styles: [{ id: "apa", title: "American Psychological Association" }],
    previews: [
      {
        selector: "default",
        label: undefined,
        folder: "Literature",
        citationStyle: null,
        document: undefined,
        path: "Literature/Paper.md",
      },
      {
        selector: books.id,
        label: "Books",
        folder: "Reading",
        citationStyle: "apa",
        document: "books.md",
        path: "Reading/2024/Paper.md",
      },
    ],
  });
  const modal = opened.mock
    .instances[0] as SuggestModal<LiteratureNoteProfileChoice>;
  const rows = await modal.getSuggestions("");
  expect(rows).toMatchObject([
    {
      id: books.id,
      preselected: true,
      source: "headless",
      path: "Reading/2024/Paper.md",
      detail: m.settings_profile_display({
        folder: "Reading",
        style: "American Psychological Association",
        document: "books.md",
      }),
    },
    {
      id: "default",
      preselected: false,
      path: "Literature/Paper.md",
      detail: m.settings_profile_display({
        folder: "Literature",
        style: m.settings_citation_references_style_default(),
        document: m.settings_profile_document_builtin(),
      }),
    },
    { action: "new", label: m.modal_profile_new() },
  ]);
  const text: string[] = [];
  const el = {
    createDiv: ({ text: value }: { text: string }) => {
      text.push(value);
      return {
        createSpan: ({ text: value }: { text: string }) => text.push(value),
      };
    },
  } as unknown as HTMLElement;
  modal.renderSuggestion(rows[0]!, el);
  expect(text).toContain(m.modal_profile_preselected());
  expect(text).toContain(m.modal_profile_source_companion());
  expect(text).toContain("Reading/2024/Paper.md");
  modal.renderSuggestion({ ...rows[0]!, source: "last-used" }, el);
  expect(text).toContain(m.modal_profile_source_last_used());
  modal.renderSuggestion({ ...rows[0]!, current: true }, el);
  expect(text).toContain(m.modal_profile_current());
  modal.onClose();
  await expect(choice).resolves.toBeUndefined();
});

it("waits for the shared create dialog when New profile is chosen after native close", async () => {
  using opened = vi.spyOn(SuggestModal.prototype, "open");
  const created = Promise.withResolvers<
    LiteratureNoteProfileChoice | undefined
  >();
  const onNew = vi.fn(() => created.promise);
  const choice = chooseLiteratureNoteProfile({} as App, [books], { onNew });
  const modal = opened.mock
    .instances[0] as SuggestModal<LiteratureNoteProfileChoice>;
  const rows = await modal.getSuggestions("");
  modal.onClose();
  modal.onChooseSuggestion(rows.at(-1)!, {} as KeyboardEvent);
  await Promise.resolve();
  expect(onNew).toHaveBeenCalledOnce();
  created.resolve({ id: books.id, label: "New reading profile" });
  await expect(choice).resolves.toEqual({
    id: books.id,
    label: "New reading profile",
  });
});

it("imports from the secondary action without choosing a Profile or starting creation", async () => {
  using opened = vi.spyOn(SuggestModal.prototype, "open");
  const onImport = vi.fn(async () => {});
  const onNew = vi.fn(async () => undefined);
  const choice = chooseLiteratureNoteProfile({} as App, [books], {
    onImport,
    onNew,
  });
  const modal = opened.mock
    .instances[0] as SuggestModal<LiteratureNoteProfileChoice>;
  const rows = await modal.getSuggestions("");
  const el = document.createElement("div");
  modal.renderSuggestion(rows.at(-1)!, el);
  el.querySelector("button")!.click();
  await expect(choice).resolves.toBeUndefined();
  expect(onImport).toHaveBeenCalledOnce();
  expect(onNew).not.toHaveBeenCalled();
});
