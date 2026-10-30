// @vitest-environment happy-dom
import { ButtonComponent, controlsOf, TextComponent } from "@mock/obsidian";
import type { App } from "obsidian";
import { expect, it, vi } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";
import * as m from "@/lib/i18n/generated/messages";
import type { ResolvedProfile } from "@/services/profile/bindings";
import type { PreparedProfileCreation } from "@/services/profile/service";
import { defaults } from "@/services/settings/schema";

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
  const resolvedProfile = stubService<ResolvedProfile>("ResolvedProfile", {
    bindings: {
      ...defaults["note.default-profile"].bindings,
      "note.literature-folder": "Literature",
    },
  });
  const unconfirmedCreation: PreparedProfileCreation = {
    profile: resolvedProfile,
    source: "",
    inherited: [],
    create: async () => {
      throw new Error("creation is not confirmed");
    },
  };
  const invalidName = {
    ...unconfirmedCreation,
    constraint: {
      kind: "invalid-name" as const,
      message: "Enter a profile name",
    },
  };
  const prepareCreate = vi.fn<() => Promise<PreparedProfileCreation>>(
    async () => invalidName,
  );
  const modal = new ProfileDestinationModal({
    app: stubService<App>("App", {}),
    defaultFolder: "Literature",
    prepareCreate,
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
    ...unconfirmedCreation,
    constraint: { kind: "invalid-name", message: "Name already used" },
  });
  text(m.settings_profile_name_name()).type("Books");
  await vi.waitFor(() =>
    expect(status().textContent).toBe("Name already used"),
  );
  expect(status().classList.contains("zt:text-(--text-error)")).toBe(true);
  expect(addDisabled()).toBe(true);
  prepareCreate.mockResolvedValueOnce(unconfirmedCreation);
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
