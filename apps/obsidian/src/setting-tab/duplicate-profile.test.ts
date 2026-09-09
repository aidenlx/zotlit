// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

import type { ProfileSelector } from "@/lib/profile-stamp";

import type { SettingTabContext } from "./context";
import { duplicateProfileToWorkbench } from "./duplicate-profile";

describe("Duplicate Profile workbench handoff", () => {
  it.each(["default", "Bk3Qn7XvT2Lp"])(
    "opens the new copy from %s through the shared workbench flow",
    async (id) => {
      const close = vi.fn<() => void>();
      const customize = vi.fn<SettingTabContext["customize"]>(async () => {
        expect(close).toHaveBeenCalledOnce();
      });
      const duplicate = vi.fn(async () => ({
        id: "Jk6Lm8Np2Qr4",
        path: "templates/zotlit-profile.reading-copy.md",
      }));
      const ctx = {
        app: { setting: { close } },
        profile: { resolveProfile: () => ({ label: "Reading" }), duplicate },
        customize,
      } as unknown as Pick<SettingTabContext, "app" | "profile" | "customize">;

      await duplicateProfileToWorkbench(ctx, id as ProfileSelector);

      expect(duplicate).toHaveBeenCalledWith(id, {});
      expect(customize).toHaveBeenCalledExactlyOnceWith({
        profileId: "Jk6Lm8Np2Qr4",
      });
    },
  );
});
