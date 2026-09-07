// @vitest-environment happy-dom
import { EditorView } from "@codemirror/view";
import type { App } from "obsidian";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createClient } from "@zotlit/db/client/node";
import { createFixtureSchema } from "@zotlit/db/test-utils";
import type { MatchTree } from "@zotlit/templates/facade";

import * as m from "@/lib/i18n/generated/messages";
import type { ProfileId } from "@/lib/profile-stamp";

import type { SettingTabContext } from "./context";
import { ProfileMatchModal } from "./profile-match-modal";

vi.mock("zustand", () => import("../views/__fixtures__/zustand"));

const profileAId = "profileAAAAA" as ProfileId;

const myLibrary = { selector: { type: "personal" }, libraryID: 1, name: null };
const team = {
  selector: { type: "group", groupID: 5 },
  libraryID: 2,
  name: "Team",
};

/**
 * A Zotero database with two Libraries holding a Collection of the same name
 * and key: My Library's "Project" has a "Drafts" child; Team's stands alone.
 */
function context(
  overrides: Record<string, unknown> = {},
): SettingTabContext & Disposable {
  using stack = new DisposableStack();
  const client = stack.adopt(createClient(":memory:"), ({ $client }) =>
    $client.close(),
  );
  createFixtureSchema(client.$client);
  client.$client.exec(`
    insert into libraries (libraryID, type) values (1, 'user'), (2, 'group');
    insert into groups (groupID, libraryID, name) values (5, 2, 'Team');
    insert into collections (collectionID, collectionName, parentCollectionID, libraryID, key)
      values
        (100, 'Project', null, 1, 'PROJ0001'),
        (101, 'Drafts', 100, 1, 'DRFT0001'),
        (200, 'Project', null, 2, 'PROJ0001');
  `);
  const ctx = {
    app: {} as App,
    profile: { profiles: [{ id: profileAId, label: "Books", document: "" }] },
    libraryScope: { libraries: [] },
    db: { state: "ready", client },
    ...overrides,
  } as unknown as SettingTabContext;
  const cleanup = stack.move();
  return Object.assign(ctx, { [Symbol.dispose]: () => cleanup.dispose() });
}

const opened: ProfileMatchModal[] = [];

afterEach(async () => {
  for (const modal of opened.splice(0)) await act(() => modal.onClose());
  document.body.replaceChildren();
});

/** Open the dialog into a real modal element, as Obsidian would. */
async function open(
  ctx: SettingTabContext,
  options?: { match?: MatchTree },
): Promise<ProfileMatchModal> {
  const modal = new ProfileMatchModal(ctx, { label: "Books", ...options });
  modal.modalEl = document.createElement("div");
  modal.contentEl = document.createElement("div");
  modal.modalEl.append(modal.contentEl);
  document.body.append(modal.modalEl);
  await act(() => modal.onOpen());
  opened.push(modal);
  return modal;
}

/** The `<select>` whose accessible name — its label or `aria-label` — is `name`. */
function selectNamed(
  root: HTMLElement,
  name: string,
  nth = 0,
): HTMLSelectElement {
  const matches = [...root.querySelectorAll("select")].filter((select) => {
    const labelledBy = select.getAttribute("aria-labelledby");
    const label = labelledBy
      ? document.getElementById(labelledBy)?.textContent
      : select.getAttribute("aria-label");
    return label === name;
  });
  return matches[nth]!;
}

function options(select: HTMLSelectElement) {
  return [...select.options].map((option) => ({
    value: option.value,
    label: option.textContent,
  }));
}

async function choose(select: HTMLSelectElement, value: string) {
  await act(() => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function type(input: HTMLInputElement, value: string) {
  await act(() => {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function key(input: HTMLInputElement, value: string) {
  await act(() => {
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: value, bubbles: true }),
    );
  });
}

/** Save and Cancel live in the modal's button container, beside the content. */
function buttonNamed(
  modal: ProfileMatchModal,
  text: string,
): HTMLButtonElement {
  return [...modal.modalEl.querySelectorAll("button")].find(
    (button) => button.textContent === text,
  )!;
}

async function click(element: Element) {
  await act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function mouseDown(element: Element) {
  await act(() => {
    element.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
  });
}

function saveEnabled(modal: ProfileMatchModal): boolean {
  return !buttonNamed(modal, m.settings_profile_match_save()).disabled;
}

/** The condition rows, in reading order: each is the element around one remove button. */
function conditionRows(modal: ProfileMatchModal): HTMLElement[] {
  return [
    ...modal.contentEl.querySelectorAll<HTMLElement>(
      `[aria-label="${m.settings_profile_match_remove_condition()}"]`,
    ),
  ].map((button) => button.closest("li")!);
}

/** The row's toggle between its labelled controls and its expression. */
function toggle(row: HTMLElement, label: string): HTMLElement {
  return row.querySelector<HTMLElement>(`[aria-label="${label}"]`)!;
}

function toggleDisabled(row: HTMLElement, label: string): boolean {
  return toggle(row, label).getAttribute("tabindex") === "-1";
}

function rowSelects(row: HTMLElement): HTMLSelectElement[] {
  return [...row.querySelectorAll("select")];
}

function rowError(row: HTMLElement): string | null {
  return row.querySelector("[role=alert]")?.textContent ?? null;
}

/** The nested group card: the one that names itself "Group". */
function nestedGroup(modal: ProfileMatchModal): HTMLElement {
  return selectNamed(modal.contentEl, m.settings_profile_match_group()).closest(
    "div.zt\\:border",
  )!;
}

/** The buttons of the root group's own footer, after every nested one. */
function rootButton(modal: ProfileMatchModal, text: string) {
  return [...modal.contentEl.querySelectorAll("button")]
    .filter((button) => button.textContent === text)
    .at(-1)!;
}

/** The expression row's editor. */
function editor(row: HTMLElement): EditorView {
  return EditorView.findFromDOM(row.querySelector<HTMLElement>(".cm-editor")!)!;
}

async function typeExpression(row: HTMLElement, text: string) {
  const view = editor(row);
  await act(() =>
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
    }),
  );
}

describe("ProfileMatchModal", () => {
  it("saves a new match with an item type and no target Profile control", async () => {
    using modalContext = context();
    const modal = await open(modalContext);
    expect(modal.contentEl.querySelectorAll("select")).toHaveLength(4);
    const [, , itemType] = rowSelects(conditionRows(modal)[0]!);
    expect(options(itemType!).some(({ value }) => value === "book")).toBe(true);
    await choose(itemType!, "book");
    await click(buttonNamed(modal, m.settings_profile_match_save()));
    await expect(modal.result).resolves.toMatchObject({
      match: { and: ['itemType == "book"'] },
    });
  });

  it("saves a Library condition through labelled and expression controls without a scope field", async () => {
    using modalContext = context({
      libraryScope: { libraries: [myLibrary, team] },
    });
    const modal = await open(modalContext);
    expect(selectNamed(modal.contentEl, "Scope")).toBeUndefined();
    let row = conditionRows(modal)[0]!;
    await choose(rowSelects(row)[0]!, "library");
    row = conditionRows(modal)[0]!;
    expect(options(rowSelects(row)[2]!)).toEqual([
      { value: "personal", label: m.settings_library_scope_personal() },
      { value: "group:5", label: "Team" },
    ]);
    await choose(rowSelects(row)[2]!, "group:5");
    await choose(rowSelects(conditionRows(modal)[0]!)[1]!, "is-not");
    row = conditionRows(modal)[0]!;
    await click(toggle(row, m.settings_profile_match_edit_as_expression()));
    row = conditionRows(modal)[0]!;
    expect(editor(row).state.doc.toString()).toBe('library != "group:5"');
    await click(toggle(row, m.settings_profile_match_edit_visually()));
    expect(
      rowSelects(conditionRows(modal)[0]!).map(({ value }) => value),
    ).toEqual(["library", "is-not", "group:5"]);
    await click(buttonNamed(modal, m.settings_profile_match_save()));
    await expect(modal.result).resolves.toEqual({
      action: "save",

      match: { and: ['library != "group:5"'] },
    });
  });

  it("loads Library and item-type conditions from an existing match", async () => {
    using ctx = context({ libraryScope: { libraries: [team] } });
    const modal = await open(ctx, {
      match: { and: ['library == "group:5"', 'itemType != "thesis"'] },
    });
    expect(
      rowSelects(conditionRows(modal)[0]!).map(({ value }) => value),
    ).toEqual(["library", "is", "group:5"]);
    expect(
      rowSelects(conditionRows(modal)[1]!).map(({ value }) => value),
    ).toEqual(["item-type", "is-not", "thesis"]);
  });

  it("saves the current store before the editor renders a changed control", async () => {
    using modalContext = context();
    const modal = await open(modalContext, { match: 'itemType == "book"' });
    const itemType = rowSelects(conditionRows(modal)[0]!)[2]!;
    const save = buttonNamed(modal, m.settings_profile_match_save());
    await act(() => {
      itemType.value = "thesis";
      itemType.dispatchEvent(new Event("change", { bubbles: true }));
      save.click();
    });
    await expect(modal.result).resolves.toEqual({
      action: "save",
      match: { and: ['itemType == "thesis"'] },
    });
  });

  it("shows an unknown Library diagnostic in labelled and expression rows", async () => {
    using modalContext = context({ libraryScope: { libraries: [myLibrary] } });
    const modal = await open(modalContext, {
      match: 'library == "group:5"',
    });
    let row = conditionRows(modal)[0]!;
    expect(rowSelects(row)[2]!.value).toBe("group:5");
    expect(rowError(row)).toBe(
      m.profile_match_problem_unknown_library({ text: '"group:5"' }),
    );
    expect(saveEnabled(modal)).toBe(false);
    await click(toggle(row, m.settings_profile_match_edit_as_expression()));
    row = conditionRows(modal)[0]!;
    expect(rowError(row)).toBe(
      m.profile_match_problem_unknown_library({ text: '"group:5"' }),
    );
    await typeExpression(row, 'library == "personal"');
    expect(saveEnabled(modal)).toBe(true);
  });

  it("starts with Match all and writes alternatives once switched to Match any", async () => {
    using modalContext = context();
    const modal = await open(modalContext);
    const match = () =>
      selectNamed(modal.contentEl, m.settings_profile_match_match());
    expect(match().value).toBe("all");
    await click(rootButton(modal, m.settings_profile_match_add_condition()));
    await choose(rowSelects(conditionRows(modal)[1]!)[0]!, "tags");
    await type(
      conditionRows(modal)[1]!.querySelector<HTMLInputElement>(
        "input[type=text]",
      )!,
      "Read",
    );
    await choose(match(), "any");
    await click(buttonNamed(modal, m.settings_profile_match_save()));
    await expect(modal.result).resolves.toMatchObject({
      match: { or: ['itemType == "book"', 'tags.contains("Read")'] },
    });
  });

  it("nests a group with its own match beside an exclusion, and reads it back", async () => {
    using modalContext = context();
    const modal = await open(modalContext);
    // The root condition becomes the exclusion: not tagged "Read".
    await choose(rowSelects(conditionRows(modal)[0]!)[0]!, "tags");
    await choose(rowSelects(conditionRows(modal)[0]!)[1]!, "does-not-contain");
    await type(
      conditionRows(modal)[0]!.querySelector<HTMLInputElement>(
        "input[type=text]",
      )!,
      "Read",
    );
    // A group under a "Match all" root starts as "Match any" with one row.
    await click(rootButton(modal, m.settings_profile_match_add_group()));
    expect(
      selectNamed(modal.contentEl, m.settings_profile_match_group()).value,
    ).toBe("any");
    // The nested footer comes before the root footer.
    await click(
      nestedGroup(modal).querySelector("button")!.textContent ===
        m.settings_profile_match_add_condition()
        ? nestedGroup(modal).querySelector("button")!
        : [...nestedGroup(modal).querySelectorAll("button")].find(
            (button) =>
              button.textContent === m.settings_profile_match_add_condition(),
          )!,
    );
    const nested = conditionRows(modal).slice(1);
    expect(nested).toHaveLength(2);
    await choose(rowSelects(nested[1]!)[2]!, "thesis");
    await click(buttonNamed(modal, m.settings_profile_match_save()));
    const match = {
      and: [
        '!tags.contains("Read")',
        { or: ['itemType == "book"', 'itemType == "thesis"'] },
      ],
    };
    await expect(modal.result).resolves.toMatchObject({ match });

    using reopenedContext = context();
    const reopened = await open(reopenedContext, {
      match,
    });
    expect(
      selectNamed(reopened.contentEl, m.settings_profile_match_match()).value,
    ).toBe("all");
    expect(
      selectNamed(reopened.contentEl, m.settings_profile_match_group()).value,
    ).toBe("any");
    expect(
      conditionRows(reopened).map((row) =>
        rowSelects(row)
          .slice(0, 2)
          .map((select) => select.value),
      ),
    ).toEqual([
      ["tags", "does-not-contain"],
      ["item-type", "is"],
      ["item-type", "is"],
    ]);
    // Removing the group leaves the exclusion on its own.
    await click(
      nestedGroup(reopened).querySelector(
        `[aria-label="${m.settings_profile_match_remove_group()}"]`,
      )!,
    );
    await click(buttonNamed(reopened, m.settings_profile_match_save()));
    await expect(reopened.result).resolves.toMatchObject({
      match: { and: ['!tags.contains("Read")'] },
    });
  });

  it.each([
    { and: [] },
    { or: [] },
    { and: [{ or: [] }, { and: [] }] },
  ] satisfies MatchTree[])(
    "preserves valid empty groups: %j",
    async (match) => {
      using modalContext = context();
      const modal = await open(modalContext, { match });
      expect(saveEnabled(modal)).toBe(true);
      await click(buttonNamed(modal, m.settings_profile_match_save()));
      await expect(modal.result).resolves.toEqual({ action: "save", match });
    },
  );

  it("keeps a leaf outside the contract as an expression row until it is corrected", async () => {
    using modalContext = context();
    const modal = await open(modalContext, {
      match: 'title == "Zotero"',
    });
    // A lone leaf sits in a "Match all" group.
    expect(
      selectNamed(modal.contentEl, m.settings_profile_match_match()).value,
    ).toBe("all");
    const row = () => conditionRows(modal)[0]!;
    expect(rowSelects(row())).toEqual([]);
    expect(
      toggleDisabled(row(), m.settings_profile_match_edit_visually()),
    ).toBe(true);
    expect(editor(row()).state.doc.toString()).toBe('title == "Zotero"');
    expect(rowError(row())).toBe(
      m.profile_match_problem_unsupported({ text: 'title == "Zotero"' }),
    );
    expect(saveEnabled(modal)).toBe(false);
    expect(editor(row()).state.doc.toString()).toBe('title == "Zotero"');
    // Each keystroke is checked; a half-typed expression names the gap.
    await typeExpression(row(), 'tags.contains("Read") &&');
    expect(rowError(row())).toBe(m.profile_match_problem_syntax({ text: "" }));
    expect(saveEnabled(modal)).toBe(false);
    await typeExpression(row(), "");
    expect(rowError(row())).toBe(m.profile_match_problem_empty());
    await typeExpression(row(), 'tags.contains("Read") && itemType == "novel"');
    expect(rowError(row())).toBe(
      m.profile_match_problem_unknown_item_type({ text: '"novel"' }),
    );
    // Operators stay inside the leaf; the tree above is the ordinary grouping.
    await typeExpression(row(), 'tags.contains("Read") && itemType == "book"');
    expect(rowError(row())).toBeNull();
    expect(saveEnabled(modal)).toBe(true);
    // Two tests in one leaf have no labelled row, so the toggle stays off.
    expect(
      toggleDisabled(row(), m.settings_profile_match_edit_visually()),
    ).toBe(true);
    await click(buttonNamed(modal, m.settings_profile_match_save()));
    await expect(modal.result).resolves.toEqual({
      action: "save",

      match: { and: ['tags.contains("Read") && itemType == "book"'] },
    });
  });

  it("switches a row between a labelled test and its expression without changing meaning", async () => {
    using modalContext = context();
    const modal = await open(modalContext, {
      match: {
        and: [
          '!tags.contains("Read")',
          'itemType == "book" || tags.contains("Read Later")',
        ],
      },
    });
    // A leaf that combines tests is shown as written: rows take one test each.
    const first = () => conditionRows(modal)[0]!;
    const second = () => conditionRows(modal)[1]!;
    expect(rowSelects(first()).map((select) => select.value)).toEqual([
      "tags",
      "does-not-contain",
    ]);
    expect(rowSelects(second())).toEqual([]);
    expect(editor(second()).state.doc.toString()).toBe(
      'itemType == "book" || tags.contains("Read Later")',
    );
    // A row turned into an expression keeps its meaning as text.
    await click(toggle(first(), m.settings_profile_match_edit_as_expression()));
    expect(editor(first()).state.doc.toString()).toBe('!tags.contains("Read")');
    // An expression that reads as one test turns back into that row.
    await typeExpression(first(), 'itemType != "thesis"');
    await click(toggle(first(), m.settings_profile_match_edit_visually()));
    expect(rowSelects(first()).map((select) => select.value)).toEqual([
      "item-type",
      "is-not",
      "thesis",
    ]);
    await typeExpression(second(), 'tags.contains("Read Later")');
    await click(toggle(second(), m.settings_profile_match_edit_visually()));
    expect(rowSelects(second()).map((select) => select.value)).toEqual([
      "tags",
      "contains",
    ]);
    await click(buttonNamed(modal, m.settings_profile_match_save()));
    await expect(modal.result).resolves.toMatchObject({
      match: {
        and: ['itemType != "thesis"', 'tags.contains("Read Later")'],
      },
    });
  });

  it.each([
    '!tags.containsAny("Read", "To read")',
    '!tags.containsAll("Read", "To read")',
  ])(
    "keeps %s as an expression through save and reopen",
    async (expression) => {
      using originalContext = context();
      const original = await open(originalContext, {
        match: expression,
      });
      const originalRow = conditionRows(original)[0]!;
      expect(rowSelects(originalRow)).toEqual([]);
      expect(editor(originalRow).state.doc.toString()).toBe(expression);
      expect(
        toggleDisabled(originalRow, m.settings_profile_match_edit_visually()),
      ).toBe(true);
      await click(buttonNamed(original, m.settings_profile_match_save()));
      const saved = await original.result;
      expect(saved?.match).toEqual({ and: [expression] });

      using reopenedContext = context();
      const reopened = await open(reopenedContext, saved!);
      const reopenedRow = conditionRows(reopened)[0]!;
      expect(rowSelects(reopenedRow)).toEqual([]);
      expect(editor(reopenedRow).state.doc.toString()).toBe(expression);
      expect(
        toggleDisabled(reopenedRow, m.settings_profile_match_edit_visually()),
      ).toBe(true);
    },
  );

  it("opens the supported contains expression as a labelled Tag row", async () => {
    using modalContext = context();
    const modal = await open(modalContext, {
      match: 'tags.contains("Read")',
    });
    const row = conditionRows(modal)[0]!;
    expect(rowSelects(row).map((select) => select.value)).toEqual([
      "tags",
      "contains",
    ]);
    expect(row.querySelector<HTMLInputElement>("input[type=text]")?.value).toBe(
      "Read",
    );
  });

  it("offers the ordered Tag operators and defaults to contains", async () => {
    using modalContext = context();
    const modal = await open(modalContext);
    const row = conditionRows(modal)[0]!;
    await choose(rowSelects(row)[0]!, "tags");
    const operator = rowSelects(row)[1]!;
    expect(operator.value).toBe("contains");
    expect(
      [...operator.options].map(({ value, textContent }) => [
        value,
        textContent,
      ]),
    ).toEqual([
      ["contains", m.settings_profile_match_tag_contains()],
      ["does-not-contain", m.settings_profile_match_tag_does_not_contain()],
      ["containsAny", m.settings_profile_match_tag_contains_any()],
      ["containsAll", m.settings_profile_match_tag_contains_all()],
      ["isEmpty", m.settings_profile_match_tag_is_empty()],
      ["is-not-empty", m.settings_profile_match_tag_is_not_empty()],
    ]);
  });

  it.each([
    ["contains", ["Read"], 'tags.contains("Read")'],
    ["does-not-contain", ["Read"], '!tags.contains("Read")'],
    ["containsAny", ["Read", "To read"], 'tags.containsAny("Read", "To read")'],
    ["containsAll", ["Read", "To read"], 'tags.containsAll("Read", "To read")'],
    ["isEmpty", [], "tags.isEmpty()"],
    ["is-not-empty", [], "!tags.isEmpty()"],
  ] as const)(
    "saves and reopens the labelled Tag operator %s",
    async (operator, values, expression) => {
      using modalContext = context();
      const modal = await open(modalContext);
      const row = () => conditionRows(modal)[0]!;
      await choose(rowSelects(row())[0]!, "tags");
      await choose(rowSelects(row())[1]!, operator);
      const input = row().querySelector<HTMLInputElement>("input[type=text]");
      if (values.length === 1) await type(input!, values[0]!);
      else
        for (const value of values) {
          await type(
            row().querySelector<HTMLInputElement>("input[type=text]")!,
            value,
          );
          await key(
            row().querySelector<HTMLInputElement>("input[type=text]")!,
            "Enter",
          );
        }
      await click(buttonNamed(modal, m.settings_profile_match_save()));
      const saved = await modal.result;
      expect(saved?.match).toEqual({ and: [expression] });

      using reopenedContext = context();
      const reopened = await open(reopenedContext, saved!);
      const reopenedRow = conditionRows(reopened)[0]!;
      expect(rowSelects(reopenedRow).map((select) => select.value)).toEqual([
        "tags",
        operator,
      ]);
      expect(
        [...reopenedRow.querySelectorAll("[data-chip-input] span > span")].map(
          (chip) => chip.textContent,
        ),
      ).toEqual(values.length > 1 ? [...values] : []);
      if (values.length === 1)
        expect(
          reopenedRow.querySelector<HTMLInputElement>("input[type=text]")
            ?.value,
        ).toBe(values[0]);
      if (values.length === 0)
        expect(reopenedRow.querySelector("input[type=text]")).toBeNull();
    },
  );

  it("commits and removes Tag chips from the keyboard and remove button", async () => {
    using modalContext = context();
    const modal = await open(modalContext);
    const row = () => conditionRows(modal)[0]!;
    await choose(rowSelects(row())[0]!, "tags");
    await choose(rowSelects(row())[1]!, "containsAny");
    const input = () =>
      row().querySelector<HTMLInputElement>("input[type=text]")!;
    await type(input(), "Read");
    await key(input(), ",");
    await type(input(), "Review");
    await key(input(), "Enter");
    const chipInput = row().querySelector<HTMLElement>("[data-chip-input]")!;
    expect(chipInput.querySelector("datalist")).toBeNull();
    await key(input(), "Backspace");
    expect(
      chipInput.querySelector(
        `[aria-label="${m.settings_profile_match_chip_remove({ value: "Review" })}"]`,
      ),
    ).toBeNull();
    await click(
      chipInput.querySelector(
        `[aria-label="${m.settings_profile_match_chip_remove({ value: "Read" })}"]`,
      )!,
    );
    expect(rowError(row())).toBe(m.settings_profile_match_tag_empty());
  });

  it("focuses the Tag input from unused control space and removes without committing its draft", async () => {
    using modalContext = context();
    const modal = await open(modalContext);
    const row = () => conditionRows(modal)[0]!;
    await choose(rowSelects(row())[0]!, "tags");
    await choose(rowSelects(row())[1]!, "containsAny");
    const chipInput = row().querySelector<HTMLElement>("[data-chip-input]")!;
    const input =
      chipInput.querySelector<HTMLInputElement>("input[type=text]")!;

    await mouseDown(chipInput);
    expect(document.activeElement).toBe(input);
    await type(input, "Read");
    await key(input, "Enter");
    await type(input, "pending");
    const remove = chipInput.querySelector<HTMLElement>(
      `[aria-label="${m.settings_profile_match_chip_remove({ value: "Read" })}"]`,
    )!;
    await mouseDown(remove);
    expect(document.activeElement).toBe(input);
    await click(remove);

    expect(input.value).toBe("pending");
    expect(chipInput.textContent).not.toContain("Read");
    await key(input, "Enter");
    expect(chipInput.textContent).toContain("pending");
  });

  it("round-trips a multi-value Tag row through expression text", async () => {
    using modalContext = context();
    const modal = await open(modalContext, {
      match: 'tags.containsAny("Read", "Review")',
    });
    const row = () => conditionRows(modal)[0]!;
    expect(rowSelects(row()).map((select) => select.value)).toEqual([
      "tags",
      "containsAny",
    ]);
    await click(toggle(row(), m.settings_profile_match_edit_as_expression()));
    expect(editor(row()).state.doc.toString()).toBe(
      'tags.containsAny("Read", "Review")',
    );
    await click(toggle(row(), m.settings_profile_match_edit_visually()));
    expect(rowSelects(row()).map((select) => select.value)).toEqual([
      "tags",
      "containsAny",
    ]);
    await click(buttonNamed(modal, m.settings_profile_match_save()));
    await expect(modal.result).resolves.toMatchObject({
      match: { and: ['tags.containsAny("Read", "Review")'] },
    });
  });

  it("resets a changed kind and keeps or trims Tag values when the operator changes", async () => {
    using modalContext = context();
    const modal = await open(modalContext);
    const row = () => conditionRows(modal)[0]!;
    await choose(rowSelects(row())[0]!, "tags");
    await choose(rowSelects(row())[1]!, "containsAll");
    for (const value of ["Read", "Review"]) {
      await type(
        row().querySelector<HTMLInputElement>("input[type=text]")!,
        value,
      );
      await key(
        row().querySelector<HTMLInputElement>("input[type=text]")!,
        "Enter",
      );
    }
    await choose(rowSelects(row())[1]!, "isEmpty");
    expect(row().querySelector("input[type=text]")).toBeNull();
    await choose(rowSelects(row())[1]!, "containsAny");
    expect(row().textContent).toContain("Read");
    expect(row().textContent).toContain("Review");
    await choose(rowSelects(row())[1]!, "contains");
    expect(
      row().querySelector<HTMLInputElement>("input[type=text]")!.value,
    ).toBe("Read");
    await choose(rowSelects(row())[1]!, "does-not-contain");
    await choose(rowSelects(row())[0]!, "item-type");
    expect(rowSelects(row()).map((select) => select.value)).toEqual([
      "item-type",
      "is",
      "book",
    ]);
    await choose(rowSelects(row())[0]!, "tags");
    expect(rowSelects(row()).map((select) => select.value)).toEqual([
      "tags",
      "contains",
    ]);
    expect(
      row().querySelector<HTMLInputElement>("input[type=text]")!.value,
    ).toBe("");
  });

  it.each([
    {
      kind: "tags",
      emptyOperator: "isEmpty",
      values: ["Read", "Review"],
      expression: "tags.isEmpty()",
    },
    {
      kind: "tags",
      emptyOperator: "is-not-empty",
      values: ["Read", "Review"],
      expression: "!tags.isEmpty()",
    },
    {
      kind: "collections",
      emptyOperator: "isEmpty",
      values: [
        "Future/Research",
        "Personal only/Personal child",
        "An extraordinarily long collection path/WithUnbrokenSegment012345678901234567890",
      ],
      expression: "collections.isEmpty()",
    },
    {
      kind: "collections",
      emptyOperator: "is-not-empty",
      values: [
        "Future/Research",
        "Personal only/Personal child",
        "An extraordinarily long collection path/WithUnbrokenSegment012345678901234567890",
      ],
      expression: "!collections.isEmpty()",
    },
  ] as const)(
    "omits populated $kind values for $emptyOperator while preserving its direct operator draft",
    async ({ kind, emptyOperator, values, expression }) => {
      using ctx = context({ libraryScope: { libraries: [myLibrary, team] } });
      const prepare = async () => {
        const modal = await open(ctx);
        const row = () => conditionRows(modal)[0]!;
        await choose(rowSelects(row())[0]!, kind);
        await choose(rowSelects(row())[1]!, "containsAll");
        for (const value of values) {
          await type(
            row().querySelector<HTMLInputElement>("input[type=text]")!,
            value,
          );
          await key(
            row().querySelector<HTMLInputElement>("input[type=text]")!,
            "Enter",
          );
        }
        await choose(rowSelects(row())[1]!, emptyOperator);
        return { modal, row };
      };

      const toggled = await prepare();
      await choose(rowSelects(toggled.row())[1]!, "containsAll");
      expect(
        [
          ...toggled.row().querySelectorAll("[data-chip-input] span > span"),
        ].map((chip) => chip.textContent),
      ).toEqual([...values]);
      await choose(rowSelects(toggled.row())[1]!, emptyOperator);
      await click(
        toggle(toggled.row(), m.settings_profile_match_edit_as_expression()),
      );
      expect(editor(toggled.row()).state.doc.toString()).toBe(expression);

      const saved = await prepare();
      await click(buttonNamed(saved.modal, m.settings_profile_match_save()));
      await expect(saved.modal.result).resolves.toMatchObject({
        match: { and: [expression] },
      });
    },
  );

  it("offers ordered Collection operators, defaults to is inside, and uses one row selector", async () => {
    using modalContext = context({
      libraryScope: { libraries: [myLibrary, team] },
    });
    const modal = await open(modalContext);
    const row = conditionRows(modal)[0]!;
    await choose(rowSelects(row)[0]!, "collections");
    const operator = rowSelects(row)[1]!;
    expect(row.querySelector("[data-condition-row]")).not.toBeNull();
    expect(operator.value).toBe("within");
    expect(options(operator)).toEqual([
      { value: "within", label: m.settings_profile_match_collection_within() },
      {
        value: "not-within",
        label: m.settings_profile_match_collection_not_within(),
      },
      {
        value: "contains",
        label: m.settings_profile_match_collection_contains(),
      },
      {
        value: "not-contains",
        label: m.settings_profile_match_collection_not_contains(),
      },
      {
        value: "containsAny",
        label: m.settings_profile_match_collection_contains_any(),
      },
      {
        value: "containsAll",
        label: m.settings_profile_match_collection_contains_all(),
      },
      {
        value: "isEmpty",
        label: m.settings_profile_match_collection_is_empty(),
      },
      {
        value: "is-not-empty",
        label: m.settings_profile_match_collection_is_not_empty(),
      },
    ]);
    expect(rowSelects(row)).toHaveLength(2);
    expect(row.querySelectorAll("input[type=text]")).toHaveLength(1);
  });

  it.each([
    ["within", ["Project/Drafts"], 'collections.within("Project/Drafts")'],
    ["not-within", ["Project/Drafts"], '!collections.within("Project/Drafts")'],
    ["contains", ["Project/Drafts"], 'collections.contains("Project/Drafts")'],
    [
      "not-contains",
      ["Project/Drafts"],
      '!collections.contains("Project/Drafts")',
    ],
    [
      "containsAny",
      ["Project", "Project/Drafts"],
      'collections.containsAny("Project", "Project/Drafts")',
    ],
    [
      "containsAll",
      ["Project", "Project/Drafts"],
      'collections.containsAll("Project", "Project/Drafts")',
    ],
    ["isEmpty", [], "collections.isEmpty()"],
    ["is-not-empty", [], "!collections.isEmpty()"],
  ] as const)(
    "saves and reopens Collection operator %s",
    async (operator, values, expression) => {
      using ctx = context({ libraryScope: { libraries: [myLibrary, team] } });
      const modal = await open(ctx);
      const row = () => conditionRows(modal)[0]!;
      await choose(rowSelects(row())[0]!, "collections");
      await choose(rowSelects(row())[1]!, operator);
      for (const value of values) {
        await type(
          row().querySelector<HTMLInputElement>("input[type=text]")!,
          value,
        );
        if (values.length > 1)
          await key(
            row().querySelector<HTMLInputElement>("input[type=text]")!,
            "Enter",
          );
      }
      await click(buttonNamed(modal, m.settings_profile_match_save()));
      const saved = await modal.result;
      expect(saved?.match).toEqual({ and: [expression] });

      const reopened = await open(ctx, saved!);
      const reopenedRow = conditionRows(reopened)[0]!;
      expect(rowSelects(reopenedRow).map((select) => select.value)).toEqual([
        "collections",
        operator,
      ]);
    },
  );

  it("shares sorted, deduplicated Collection suggestions and accepts unknown paths", async () => {
    using modalContext = context({
      libraryScope: { libraries: [myLibrary, team] },
    });
    const modal = await open(modalContext);
    const row = () => conditionRows(modal)[0]!;
    await choose(rowSelects(row())[0]!, "collections");
    const suggestions = () =>
      [...row().querySelectorAll<HTMLOptionElement>("datalist option")].map(
        (option) => option.value,
      );
    expect(suggestions()).toEqual(["Project", "Project/Drafts"]);
    await type(
      row().querySelector<HTMLInputElement>("input[type=text]")!,
      "Future/Research",
    );
    expect(row().textContent).toContain(
      m.settings_profile_match_collection_not_found(),
    );
    expect(saveEnabled(modal)).toBe(true);
    await choose(rowSelects(row())[1]!, "containsAny");
    expect(suggestions()).toEqual(["Project", "Project/Drafts"]);
    expect(row().textContent).toContain(
      m.settings_profile_match_collection_not_found(),
    );
    await click(buttonNamed(modal, m.settings_profile_match_save()));
    await expect(modal.result).resolves.toMatchObject({
      match: { and: ['collections.containsAny("Future/Research")'] },
    });
  });

  it("round-trips labelled Collection text and preserves negated any/all expressions", async () => {
    using ctx = context({ libraryScope: { libraries: [myLibrary, team] } });
    const labelled = await open(ctx, {
      match: 'collections.within("Project/Drafts")',
    });
    const row = () => conditionRows(labelled)[0]!;
    await click(toggle(row(), m.settings_profile_match_edit_as_expression()));
    expect(editor(row()).state.doc.toString()).toBe(
      'collections.within("Project/Drafts")',
    );
    await click(toggle(row(), m.settings_profile_match_edit_visually()));
    expect(rowSelects(row()).map((select) => select.value)).toEqual([
      "collections",
      "within",
    ]);

    for (const expression of [
      '!collections.containsAny("Project", "Other")',
      '!collections.containsAll("Project", "Other")',
    ]) {
      const modal = await open(ctx, {
        match: expression,
      });
      const expressionRow = conditionRows(modal)[0]!;
      expect(rowSelects(expressionRow)).toEqual([]);
      expect(editor(expressionRow).state.doc.toString()).toBe(expression);
      await click(buttonNamed(modal, m.settings_profile_match_save()));
      await expect(modal.result).resolves.toMatchObject({
        match: { and: [expression] },
      });
    }
  });

  it("saves a Tag condition as typed and refuses an empty name", async () => {
    using modalContext = context();
    const modal = await open(modalContext);
    const row = () => conditionRows(modal)[0]!;
    await choose(rowSelects(row())[0]!, "tags");
    expect(rowError(row())).toBe(m.settings_profile_match_tag_empty());
    expect(saveEnabled(modal)).toBe(false);
    await type(
      row().querySelector<HTMLInputElement>("input[type=text]")!,
      "Read Later",
    );
    expect(rowError(row())).toBeNull();
    expect(saveEnabled(modal)).toBe(true);
    await click(buttonNamed(modal, m.settings_profile_match_save()));
    await expect(modal.result).resolves.toMatchObject({
      match: { and: ['tags.contains("Read Later")'] },
    });
  });

  it("pins Save and Cancel in the modal's button container, outside the content", async () => {
    using modalContext = context();
    const modal = await open(modalContext);
    const footer = modal.modalEl.querySelector(".zt-profile-match-footer")!;
    expect(modal.modalEl.classList.contains("zt-profile-match-modal")).toBe(
      true,
    );
    expect(modal.contentEl.contains(footer)).toBe(false);
    expect(
      [...footer.querySelectorAll("button")].map(
        (button) => button.textContent,
      ),
    ).toEqual([m.settings_profile_match_save(), m.modal_cancel()]);
  });

  it("offers all three footer actions and permits removal of an invalid expression", async () => {
    using modalContext = context();
    const modal = await open(modalContext, { match: 'title == "Zotero"' });
    const footer = modal.modalEl.querySelector(".zt-profile-match-footer")!;
    expect(
      [...footer.querySelectorAll("button")].map(
        (button) => button.textContent,
      ),
    ).toEqual([
      m.settings_profile_match_remove(),
      m.settings_profile_match_save(),
      m.modal_cancel(),
    ]);
    expect(saveEnabled(modal)).toBe(false);
    await click(buttonNamed(modal, m.settings_profile_match_remove()));
    await expect(modal.result).resolves.toEqual({ action: "remove" });
  });

  it("resolves undefined on cancel", async () => {
    using modalContext = context();
    const modal = await open(modalContext);
    await click(buttonNamed(modal, m.modal_cancel()));
    await expect(modal.result).resolves.toBeUndefined();
  });
});
