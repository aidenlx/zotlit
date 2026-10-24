import { describe, expect, it, vi } from "vitest";

import { testEvent } from "@/lib/__fixtures__/event-stream";
import { testRuntime } from "@/lib/__fixtures__/runtime";
import { Stream } from "@/lib/effect";

import {
  libraryScopeInvalidNotice,
  subscribeLibraryScopeInvalid,
} from "./notices";
import type { PlainLibraryScope } from "./plain";

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
    testRuntime(),
    scope as unknown as Pick<
      PlainLibraryScope,
      "invalid" | "changed" | "libraries-changed"
    >,
    showNotice,
  );
  return { dispose, showNotice, hide };
}

function fakeScope(invalid: boolean) {
  const event = testEvent<null>();
  return {
    invalid,
    changed: event.stream,
    "libraries-changed": Stream.empty,
    emitChanged() {
      event.emit(null);
    },
    setInvalid(value: boolean) {
      this.invalid = value;
      event.emit(null);
    },
    hasListener: () => event.subscribers > 0,
  };
}
