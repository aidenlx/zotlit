// @vitest-environment happy-dom
import { ButtonComponent } from "@mock/obsidian";
import type {
  Setting,
  SettingDefinitionItem,
  SettingDefinitionList,
} from "obsidian";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as m from "@/lib/i18n/generated/messages";
import type { ProfileId } from "@/lib/profile-stamp";
import { profileServiceFixture } from "@/services/profile/__fixtures__/service";

import type { SettingTabContext } from "./context";
import { ProfileMatchModal } from "./profile-match-modal";
import { profilesPage } from "./profiles";

vi.mock("zustand", () => import("../views/__fixtures__/zustand"));

const BOOKS = "Bk3Qn7XvT2Lp" as ProfileId;
const path = "templates/zotlit-profile.books.md";
const source = `---
# Keep this order
name :  Books  # Hand-written spacing
match: 'tags.contains("Read")'
id: ${BOOKS}
version: "1.0.0"
contract: 2
filename: '{{ zt.title }}'
---
{% managed %}Body{% endmanaged %}
--- zotlit:annotation ---
Annotation`;

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

function profileRows(ctx: SettingTabContext): SettingDefinitionList {
  return profilesPage(ctx).items!.find(
    (row) => "type" in row && row.type === "list",
  ) as SettingDefinitionList;
}

function status(ctx: SettingTabContext): string | null {
  return (profileRows(ctx).items![0] as { desc: DocumentFragment }).desc
    .firstElementChild!.textContent;
}

function rowButtons(row: SettingDefinitionItem): ButtonComponent[] {
  const buttons: ButtonComponent[] = [];
  if (!("render" in row) || !row.render)
    throw new Error("Expected a Profile row");
  row.render(
    {
      addButton: (make: (button: ButtonComponent) => unknown) => {
        const button = new ButtonComponent(document.createElement("div"));
        make(button);
        buttons.push(button);
      },
      addExtraButton: () => {},
    } as unknown as Setting,
    {} as never,
  );
  return buttons;
}

function mockModalOpen() {
  return vi
    .spyOn(ProfileMatchModal.prototype, "open")
    .mockImplementation(function (this: ProfileMatchModal) {
      this.modalEl = document.createElement("div");
      this.contentEl = document.createElement("div");
      this.modalEl.append(this.contentEl);
      document.body.append(this.modalEl);
      this.onOpen();
    });
}

function openedModal(contexts: readonly unknown[]): ProfileMatchModal {
  const modal = contexts.at(-1);
  if (!(modal instanceof ProfileMatchModal))
    throw new Error("Expected a Match editor");
  return modal;
}

function modalButton(
  modal: ProfileMatchModal,
  text: string,
): HTMLButtonElement {
  return [...modal.modalEl.querySelectorAll("button")].find(
    (button) => button.textContent === text,
  )!;
}

describe("Profile row Match action", () => {
  it("loads the current file, saves and removes only match bytes, and refreshes the actual row diagnostic", async () => {
    vi.useFakeTimers();
    await using f = await profileServiceFixture({ [path]: source });
    const ctx = {
      ...f,
      db: { state: "closed" },
      requestUpdate: vi.fn(),
    } as unknown as SettingTabContext;
    const initialRow = profileRows(ctx).items![0]!;
    expect(rowButtons(initialRow).map((button) => button.text)).toEqual([
      m.settings_profile_match_action(),
    ]);
    expect(
      rowButtons(profilesPage(ctx).items![0]!).map((button) => button.text),
    ).not.toContain(m.settings_profile_match_action());

    using open = mockModalOpen();
    // Keep the rendered row; a hand edit after rendering must be authoritative.
    const current = source
      .replace('tags.contains("Read")', 'itemType == "thesis"')
      .replace("Body", "Current body");
    f.vault.modifyFile(path, current);
    await act(async () => {
      rowButtons(initialRow)[0]!.click();
      await vi.advanceTimersByTimeAsync(500);
    });
    const modal = openedModal(open.mock.contexts);
    expect(
      [...modal.contentEl.querySelectorAll("select")].map(
        (select) => select.value,
      ),
    ).toEqual(["all", "item-type", "is", "thesis"]);
    await act(() => {
      const itemType = modal.contentEl.querySelectorAll("select")[3]!;
      itemType.value = "book";
      itemType.dispatchEvent(new Event("change", { bubbles: true }));
      modalButton(modal, m.settings_profile_match_save()).click();
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(f.vault.contents.get(path)).toBe(
      current.replace(
        "match: 'itemType == \"thesis\"'",
        'match: {"and":["itemType == \\"book\\""]}',
      ),
    );
    expect(ctx.requestUpdate).toHaveBeenCalledOnce();
    expect(status(ctx)).toBe(
      m.settings_profile_match_status({ state: "evaluable" }),
    );
    await act(() => modal.onClose());

    const invalid = current.replace('itemType == "thesis"', 'title == "Books"');
    f.vault.modifyFile(path, invalid);
    await vi.advanceTimersByTimeAsync(500);
    expect(status(ctx)).toBe(
      m.settings_profile_match_status({ state: "unevaluable" }),
    );
    await act(async () => {
      rowButtons(profileRows(ctx).items![0]!)[0]!.click();
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(
      modalButton(
        openedModal(open.mock.contexts),
        m.settings_profile_match_save(),
      ).disabled,
    ).toBe(true);
    expect(openedModal(open.mock.contexts).contentEl.textContent).toContain(
      m.profile_rule_problem_unsupported({ text: 'title == "Books"' }),
    );
    await act(() =>
      modalButton(
        openedModal(open.mock.contexts),
        m.settings_profile_match_remove(),
      ).click(),
    );
    await vi.advanceTimersByTimeAsync(500);
    expect(f.vault.contents.get(path)).toBe(
      invalid.replace("match: 'title == \"Books\"'\n", ""),
    );
    expect(ctx.requestUpdate).toHaveBeenCalledTimes(2);
    expect(status(ctx)).toBe(
      m.settings_profile_match_status({ state: "absent" }),
    );
    await act(() => openedModal(open.mock.contexts).onClose());
  });

  it("Cancel leaves the current document unchanged", async () => {
    await using f = await profileServiceFixture({ [path]: source });
    const ctx = {
      ...f,
      db: { state: "closed" },
      requestUpdate: vi.fn(),
    } as unknown as SettingTabContext;
    using open = mockModalOpen();
    await act(async () => rowButtons(profileRows(ctx).items![0]!)[0]!.click());
    await vi.waitFor(() => expect(open).toHaveBeenCalledOnce());
    const modal = openedModal(open.mock.contexts);
    await act(() => modalButton(modal, m.modal_cancel()).click());
    await act(() => modal.onClose());
    expect(f.vault.contents.get(path)).toBe(source);
  });
});
