import { describe, expect, it, vi } from "vitest";

import { subscribeWorkbenchSaved, workbenchSavedNotice } from "./notices";
import type { LocalBridgeService } from "./service";

describe("workbenchSavedNotice", () => {
  it("carries the approved copy and runs Update all notes through its action", () => {
    const updateAll = vi.fn();
    const notice = workbenchSavedNotice(updateAll);

    expect(notice).toMatchObject({
      title: "Template document saved from the web Workbench.",
      action: "Update all notes",
    });

    notice.updateAll();
    expect(updateAll).toHaveBeenCalledOnce();
  });
});

describe("subscribeWorkbenchSaved", () => {
  it("shows one Notice per Save that landed and drops its subscription at the end", () => {
    const listeners = new Set<(profileId: string) => void>();
    const localBridge = {
      on: (_event: "profile-saved", callback: (profileId: string) => void) => {
        listeners.add(callback);
        return () => listeners.delete(callback);
      },
    } as unknown as Pick<LocalBridgeService, "on">;
    const showNotice = vi.fn();

    const dispose = subscribeWorkbenchSaved(localBridge, showNotice);
    for (const listener of listeners) listener("default");
    for (const listener of listeners) listener("Bk7Qm2Xr9Tz4");
    expect(showNotice).toHaveBeenCalledTimes(2);

    dispose();
    expect(listeners.size).toBe(0);
  });
});
