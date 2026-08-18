import { describe, expect, it, vi } from "vitest";

import {
  libraryScopeInvalidNotice,
  subscribeLibraryScopeInvalid,
} from "./notices";
import type { LibraryScopeService } from "./service";

describe("libraryScopeInvalidNotice", () => {
  it("carries the approved copy and opens settings through its action", () => {
    const openSettings = vi.fn();
    const notice = libraryScopeInvalidNotice(openSettings);

    expect(notice).toMatchObject({
      title: "Library scope is invalid",
      explanation:
        "ZotLit is using My Library until you select a library scope.",
      action: "Open settings",
    });

    notice.openSettings();
    expect(openSettings).toHaveBeenCalledOnce();
  });
});

describe("subscribeLibraryScopeInvalid", () => {
  it("warns once for a value that was already broken at subscription", () => {
    const scope = fakeScope(true);
    const { showNotice } = subscribe(scope);

    scope.emitChanged();
    scope.emitChanged();

    expect(showNotice).toHaveBeenCalledOnce();
  });

  it("stays quiet while the saved value is valid", () => {
    const scope = fakeScope(false);
    const { showNotice } = subscribe(scope);

    scope.emitChanged();

    expect(showNotice).not.toHaveBeenCalled();
  });

  it("clears the notice on repair and arms the next break", () => {
    const scope = fakeScope(false);
    const { showNotice, hide } = subscribe(scope);

    scope.setInvalid(true);
    expect(showNotice).toHaveBeenCalledOnce();

    scope.setInvalid(false);
    expect(hide).toHaveBeenCalledOnce();

    scope.setInvalid(true);
    expect(showNotice).toHaveBeenCalledTimes(2);
  });

  it("drops its subscription and its open notice at the plugin's end", () => {
    const scope = fakeScope(true);
    const { dispose, hide } = subscribe(scope);

    dispose();

    expect(hide).toHaveBeenCalledOnce();
    expect(scope.hasListener()).toBe(false);
  });
});

function subscribe(scope: ReturnType<typeof fakeScope>) {
  const hide = vi.fn();
  const showNotice = vi.fn(() => ({ hide }));
  const dispose = subscribeLibraryScopeInvalid(
    scope as unknown as Pick<LibraryScopeService, "invalid" | "on">,
    showNotice,
  );
  return { dispose, showNotice, hide };
}

function fakeScope(invalid: boolean) {
  let listener: (() => void) | null = null;
  return {
    invalid,
    on(_event: "changed", cb: () => void) {
      listener = cb;
      return () => {
        listener = null;
      };
    },
    emitChanged() {
      listener?.();
    },
    setInvalid(next: boolean) {
      this.invalid = next;
      listener?.();
    },
    hasListener() {
      return listener !== null;
    },
  };
}
