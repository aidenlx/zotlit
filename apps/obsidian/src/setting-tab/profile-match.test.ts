// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";

import type { ProfileId } from "@/lib/profile-stamp";
import { openProfileEditor } from "@/views/profile-editor/register";

import type { SettingTabContext } from "./context";
import { editProfileMatch } from "./profile-match";
vi.mock("@/views/profile-editor/register", () => ({
  openProfileEditor: vi.fn(),
}));
it("opens the Profile document's Match tab from settings", async () => {
  const id = "Bk3Qn7XvT2Lp" as ProfileId;
  const file = { path: "profiles/books.md" };
  const close = vi.fn();
  const ctx = {
    app: { setting: { close }, vault: { getFileByPath: () => file } },
    profile: { ready: Promise.resolve(), profiles: [{ id, path: file.path }] },
  } as unknown as SettingTabContext;
  await editProfileMatch(ctx, id);
  expect(close).toHaveBeenCalledOnce();
  expect(openProfileEditor).toHaveBeenCalledWith(ctx.app, file, {
    tab: "match",
  });
});
