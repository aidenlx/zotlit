// @vitest-environment happy-dom
import { controlsOf, TextComponent } from "@mock/obsidian";
import { expect, it, vi } from "vitest";

import * as m from "@/lib/i18n/generated/messages";
import type { PreparedProfileCreation } from "@/services/profile/service";

import { ProfileDestinationModal } from "./profile-destination-modal";

it("presents an initial requirement as a hint and validates an edited name", async () => {
  const prepareCreate = vi.fn(
    async () =>
      ({
        constraint: { kind: "no-difference", message: "full form requirement" },
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
  await vi.waitFor(() =>
    expect(status().textContent).toBe(
      m.settings_profile_destination_choose_folder(),
    ),
  );
  expect(status().classList.contains("zt:text-(--text-error)")).toBe(false);
  prepareCreate.mockResolvedValueOnce({
    constraint: { kind: "invalid-name", message: "Name already used" },
  } as PreparedProfileCreation);
  const label = [...modal.contentEl.querySelectorAll("label")].find(
    (el) => el.firstChild?.textContent === m.settings_profile_name_name(),
  )!;
  const name = controlsOf(label.lastElementChild as HTMLElement).find(
    (control) => control instanceof TextComponent,
  )!;
  name.type("Books");
  await vi.waitFor(() =>
    expect(status().textContent).toBe("Name already used"),
  );
  expect(status().classList.contains("zt:text-(--text-error)")).toBe(true);
  modal.onClose();
});
