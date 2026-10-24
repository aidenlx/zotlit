import { describe, expect, it, vi } from "vitest";

import { testEvent } from "@/lib/__fixtures__/event-stream";
import { testRuntime } from "@/lib/__fixtures__/runtime";
import { Stream } from "@/lib/effect";

import {
  citationStyleMissingNotice,
  subscribeCitationStyleMissing,
} from "./notices";

function styleEvents(existing = false) {
  const event = testEvent<string>();
  const style = "http://www.zotero.org/styles/missing";
  return {
    cache: {
      missingStyle: existing
        ? event.stream.pipe(Stream.prepend([style]))
        : event.stream,
    },
    emit: () => event.emit(style),
    hasListener: () => event.subscribers > 0,
  };
}

describe("citationStyleMissingNotice", () => {
  it("carries the approved copy and opens settings through its action", () => {
    const openSettings = vi.fn();
    const notice = citationStyleMissingNotice(openSettings);

    expect(notice).toMatchObject({
      title:
        "The selected citation and references style isn’t installed in Zotero.",
      action: "Open settings",
    });

    notice.openSettings();
    expect(openSettings).toHaveBeenCalledOnce();
  });
});

describe("subscribeCitationStyleMissing", () => {
  it("shows a notice when the missing style was found before subscription", () => {
    const events = styleEvents(true);
    const hide = vi.fn();
    const showNotice = vi.fn(() => ({ hide }));

    const dispose = subscribeCitationStyleMissing(
      testRuntime(),
      events.cache as never,
      showNotice,
    );

    expect(showNotice).toHaveBeenCalledOnce();
    dispose();
    expect(hide).toHaveBeenCalledOnce();
    expect(events.hasListener()).toBe(false);
  });

  it("subscribes for the plugin lifecycle and hides the active notice at its end", () => {
    const events = styleEvents();
    const hide = vi.fn();
    const showNotice = vi.fn(() => ({ hide }));
    const dispose = subscribeCitationStyleMissing(
      testRuntime(),
      events.cache as never,
      showNotice,
    );

    events.emit();
    expect(showNotice).toHaveBeenCalledOnce();

    dispose();
    expect(hide).toHaveBeenCalledOnce();
    expect(events.hasListener()).toBe(false);
  });
});
