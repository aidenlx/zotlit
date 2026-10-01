// @vitest-environment happy-dom
import { ButtonComponent, controlsOf, TextComponent } from "@mock/obsidian";
import { expect, it, vi } from "vitest";

import * as m from "@/lib/i18n/generated/messages";
import type { PreparedProfileCreation } from "@/services/profile/service";

import { ProfileDestinationModal } from "./profile-destination-modal";

it("asks for a name with a neutral hint, reports an edited invalid name, and accepts a name with an empty folder", async () => {
  using disabled = vi.spyOn(ButtonComponent.prototype, "setDisabled");
  const addDisabled = () =>
    disabled.mock.calls.findLast((_, index) => {
      const button = disabled.mock.instances[index];
      return (
        button instanceof ButtonComponent &&
        button.text === m.settings_profile_add()
      );
    })?.[0];
  const prepareCreate = vi.fn(
    async () =>
      ({
        constraint: { kind: "invalid-name", message: "Enter a profile name" },
      }) as PreparedProfileCreation,
  );
  const modal = new ProfileDestinationModal({
    app: {} as never,
    profile: {
      resolveProfile: () => ({
        bindings: { "note.literature-folder": "Literature" },
      }),
      prepareCreate,
    } as never,
  });
  modal.onOpen();
  const status = () => modal.contentEl.querySelector('[role="status"]')!;
  const text = (name: string) =>
    [...modal.contentEl.querySelectorAll("label")]
      .filter((el) => el.firstChild?.textContent === name)
      .flatMap((el) => controlsOf(el.lastElementChild as HTMLElement))
      .find((control) => control instanceof TextComponent)!;
  await vi.waitFor(() =>
    expect(status().textContent).toBe("Enter a profile name"),
  );
  expect(status().classList.contains("zt:text-(--text-error)")).toBe(false);
  expect(addDisabled()).toBe(true);
  expect(text(m.settings_profile_folder_name()).inputEl.placeholder).toBe(
    m.settings_profile_same_as_default({ value: "Literature" }),
  );
  prepareCreate.mockResolvedValueOnce({
    constraint: { kind: "invalid-name", message: "Name already used" },
  } as PreparedProfileCreation);
  text(m.settings_profile_name_name()).type("Books");
  await vi.waitFor(() =>
    expect(status().textContent).toBe("Name already used"),
  );
  expect(status().classList.contains("zt:text-(--text-error)")).toBe(true);
  expect(addDisabled()).toBe(true);
  prepareCreate.mockResolvedValueOnce({} as PreparedProfileCreation);
  text(m.settings_profile_name_name()).type("Reading");
  await vi.waitFor(() => expect(addDisabled()).toBe(false));
  expect(status().textContent).toBe("");
  expect(prepareCreate).toHaveBeenLastCalledWith({
    label: "Reading",
    look: "default",
    bindings: { folder: undefined },
  });
  modal.onClose();
});
