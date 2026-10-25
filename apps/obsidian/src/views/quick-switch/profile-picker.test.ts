// @vitest-environment happy-dom
import { SuggestModal } from "obsidian";
import type { App } from "obsidian";
import { expect, it, onTestFinished, vi } from "vitest";

import { keymapApp, pressTop } from "@/lib/__fixtures__/keymap";
import { stubService } from "@/lib/__fixtures__/service-stub";
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
  match: { state: "absent", summary: m.profile_match_absent() },
};
const emptyApp = stubService<App>("App", {
  keymap: stubService<App["keymap"]>("Keymap", {
    pushScope: vi.fn(),
    popScope: vi.fn(),
  }),
});

it("keeps the preselected choice when Obsidian closes before choosing it", async () => {
  using opened = vi.spyOn(SuggestModal.prototype, "open");
  const choice = chooseLiteratureNoteProfile(emptyApp, [books], {
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
  const choice = chooseLiteratureNoteProfile(emptyApp, [books]);
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
  const choice = chooseLiteratureNoteProfile(emptyApp, {
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
    classList: { add: () => {} },
    createDiv: ({ text: value }: { text: string }) => {
      text.push(value);
      return {
        createSpan: ({ text: value }: { text: string }) => text.push(value),
      };
    },
  } as unknown as HTMLElement;
  modal.renderSuggestion(rows[0]!, el);
  expect(text).toContain(m.modal_profile_preselected());
  expect(text).toContain(m.modal_profile_source_link());
  expect(text).toContain("Reading/2024/Paper.md");
  modal.renderSuggestion({ ...rows[0]!, current: true }, el);
  expect(text).toContain(m.modal_profile_current());
  modal.onClose();
  await expect(choice).resolves.toBeUndefined();
});

it("shows the rule behind a preselected choice and the problem that stopped automatic selection", async () => {
  using opened = vi.spyOn(SuggestModal.prototype, "open");
  const preview = {
    selector: books.id,
    label: "Books",
    folder: "Reading",
    citationStyle: null,
    document: "books.md",
    path: "Reading/Paper.md",
  };
  const choice = chooseLiteratureNoteProfile(emptyApp, {
    preselected: books.id,
    source: "match",
    reason: "Item type is Book in My Library",
    previews: [preview],
  });
  const modal = opened.mock
    .instances[0] as SuggestModal<LiteratureNoteProfileChoice>;
  const rows = await modal.getSuggestions("");
  expect(rows[0]).toMatchObject({
    id: books.id,
    source: "match",
    reason: "Item type is Book in My Library",
  });
  const text: string[] = [];
  const el = {
    classList: { add: () => {} },
    createDiv: ({ text: value }: { text: string }) => {
      text.push(value);
      return {
        createSpan: ({ text: value }: { text: string }) => text.push(value),
      };
    },
  } as unknown as HTMLElement;
  modal.renderSuggestion(rows[0]!, el);
  expect(text).toContain("Item type is Book in My Library");
  modal.onClose();
  await expect(choice).resolves.toBeUndefined();

  const stopped = chooseLiteratureNoteProfile(emptyApp, {
    preselected: "default",
    source: "bound",
    problem: "Rule broke. Choose a profile for this note.",
    previews: [{ ...preview, selector: "default", label: undefined }, preview],
  });
  const stoppedModal = opened.mock
    .instances[1] as SuggestModal<LiteratureNoteProfileChoice>;
  const stoppedRows = await stoppedModal.getSuggestions("");
  expect(stoppedRows[0]).toMatchObject({
    id: "default",
    preselected: true,
    problem: "Rule broke. Choose a profile for this note.",
  });
  expect(stoppedRows[1]).toMatchObject({ id: books.id, problem: undefined });
  text.length = 0;
  stoppedModal.renderSuggestion(stoppedRows[0]!, el);
  expect(text).toContain("Rule broke. Choose a profile for this note.");
  stoppedModal.onClose();
  await expect(stopped).resolves.toBeUndefined();
});

it("waits for the shared create dialog when New profile is chosen after native close", async () => {
  using opened = vi.spyOn(SuggestModal.prototype, "open");
  const created = Promise.withResolvers<
    LiteratureNoteProfileChoice | undefined
  >();
  const onNew = vi.fn(() => created.promise);
  const choice = chooseLiteratureNoteProfile(emptyApp, [books], { onNew });
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
  const choice = chooseLiteratureNoteProfile(emptyApp, [books], {
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

it("imports from Enter on the focused secondary action, before the list takes the highlighted row", async () => {
  using opened = vi.spyOn(SuggestModal.prototype, "open");
  const onImport = vi.fn(async () => {});
  const onNew = vi.fn(async () => undefined);
  const app = keymapApp();
  const choice = chooseLiteratureNoteProfile(app as unknown as App, [books], {
    onImport,
    onNew,
  });
  const modal = opened.mock
    .instances[0] as SuggestModal<LiteratureNoteProfileChoice>;
  const rows = await modal.getSuggestions("");
  const el = document.body.createDiv();
  onTestFinished(() => el.remove());
  /** The Import button, as the list draws its rows on a keystroke. */
  const draw = () => {
    el.empty();
    modal.renderSuggestion(rows.at(-1)!, el);
    return el.querySelector("button")!;
  };

  // A row drawn again gives the last button's Scope back.
  draw().focus();
  const button = draw();
  expect(app.scopes).toEqual([]);

  button.focus();
  expect(app.scopes).toHaveLength(1);
  // The modal's own Scope, beneath, holds the list's Enter.
  expect(app.scopes[0]).not.toBe(modal.scope);
  expect(pressTop(app, { key: "Enter" }, button).defaultPrevented).toBe(true);

  await expect(choice).resolves.toBeUndefined();
  expect(onImport).toHaveBeenCalledOnce();
  expect(onNew).not.toHaveBeenCalled();
  // Closing the modal gives the Scope back.
  expect(app.scopes).toEqual([]);
});

it.each([
  {
    matchContext: "item",
    reason: m.modal_profile_match_candidate(),
    other: m.modal_profile_match_batch_candidate(),
  },
  {
    matchContext: "batch",
    reason: m.modal_profile_match_batch_candidate(),
    other: m.modal_profile_match_candidate(),
  },
] as const)(
  "puts every overlap candidate first with a $matchContext match reason",
  async ({ matchContext, reason, other }) => {
    using opened = vi.spyOn(SuggestModal.prototype, "open");
    const papers = "Rz9Wm4YfH6Kd" as ProfileId;
    const choice = chooseLiteratureNoteProfile(emptyApp, {
      candidates: [books.id, papers],
      matchContext,
      problem: m.modal_profile_problem_overlap({ profiles: "Books, Papers" }),
      previews: [
        {
          selector: "default",
          label: undefined,
          folder: "Literature",
          citationStyle: null,
          document: undefined,
          path: "Literature/Book.md",
        },
        {
          selector: papers,
          label: "Papers",
          folder: "Papers",
          citationStyle: null,
          document: "papers.md",
          path: "Papers/Book.md",
        },
        {
          selector: books.id,
          label: "Books",
          folder: "Books",
          citationStyle: null,
          document: "books.md",
          path: "Books/Book.md",
        },
      ],
    });
    const modal = opened.mock
      .instances[0] as SuggestModal<LiteratureNoteProfileChoice>;
    const rows = await modal.getSuggestions("");
    expect(rows).toMatchObject([
      { id: papers, candidate: matchContext, preselected: true },
      { id: books.id, candidate: matchContext, preselected: true },
      { id: "default", candidate: undefined, preselected: false },
      { action: "new" },
    ]);
    for (const row of rows.slice(0, 2)) {
      const el = document.createElement("div");
      modal.renderSuggestion(row, el);
      expect(el.textContent).toContain(reason);
      expect(el.textContent).not.toContain(other);
      expect(el.textContent).toContain(
        m.modal_profile_problem_overlap({ profiles: "Books, Papers" }),
      );
    }
    modal.onClose();
    await expect(choice).resolves.toBeUndefined();
  },
);
