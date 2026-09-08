import { describe, expect, it, vi } from "vitest";

import { DEFAULT_PROFILE_SOURCE, SAMPLE_ITEMS } from "@zotlit/workbench/render";

// @vitest-environment happy-dom
// Browser draft storage, refused web inputs, and file download behavior.
import { m } from "@/paraglide/messages.js";

import {
  KEY,
  KEPT,
  ETA,
  open,
  importFile,
  rendered,
  keep,
  title,
  shownItem,
} from "./page-test-host";

describe("the kept draft on the next visit", () => {
  it("holds the last visit's work back until the prompt is accepted", () => {
    keep(KEPT, SAMPLE_ITEMS[1]!);
    using page = open();

    // The prompt stands over the document a fresh visit opens on.
    expect(page.host.textContent).toContain(m.workbench_restore_heading());
    expect(title(page.host)).toBe("Default");
    expect(shownItem(page.host)).toBe(SAMPLE_ITEMS[0]!.item.title);

    page.press(m.workbench_restore_accept());

    // Both halves come back together: the draft, and the paper it was shown
    // against.
    expect(title(page.host)).toBe("Kept work");
    expect(shownItem(page.host)).toBe(SAMPLE_ITEMS[1]!.item.title);
    expect(page.host.textContent).not.toContain(m.workbench_restore_heading());
  });

  it("drops the record when the reader starts clean", () => {
    keep(KEPT, SAMPLE_ITEMS[1]!);
    using page = open();

    page.press(m.workbench_restore_decline());

    expect(page.host.textContent).not.toContain(m.workbench_restore_heading());
    expect(title(page.host)).toBe("Default");
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("keeps what the reader changes before answering the prompt", async () => {
    keep(KEPT, SAMPLE_ITEMS[1]!);
    using page = open();

    await page.show(SAMPLE_ITEMS[2]!.item.key);

    // The change answers the prompt the way Start clean does, so the next
    // visit is offered the paper this one chose rather than the older draft.
    expect(page.host.textContent).not.toContain(m.workbench_restore_heading());
    await page.settle();
    expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({
      source: DEFAULT_PROFILE_SOURCE,
      snapshot: SAMPLE_ITEMS[2],
    });
  });

  it("offers nothing an untouched visit left, and clears what it found", async () => {
    localStorage.setItem(KEY, "kept before the snapshot contract moved on");
    using page = open();

    expect(page.host.textContent).not.toContain(m.workbench_restore_heading());
    await page.settle();

    expect(localStorage.getItem(KEY)).toBeNull();
  });
});

describe("a profile the web workbench refuses", () => {
  it("shows the handoff, and hands the refused source to no render", async () => {
    keep(ETA, SAMPLE_ITEMS[0]!);
    using page = open();

    page.press(m.workbench_restore_accept());

    expect(page.host.textContent).toContain(m.workbench_unsupported_heading());
    expect(page.host.textContent).toContain(m.workbench_unsupported_download());
    // None of the editing panes are reachable from this screen.
    expect(page.host.querySelector('[role="tablist"]')).toBeNull();
    await page.settle();
    expect(rendered()).not.toContain(ETA);
  });
});

describe("the document's way in and out", () => {
  it("opens an imported profile and hands its bytes back", async () => {
    using page = open();
    const blobs: Blob[] = [];
    const names: string[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      blobs.push(blob as Blob);
      return "blob:workbench";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      function (this: HTMLAnchorElement) {
        names.push(this.download);
      },
    );

    importFile(page.host, KEPT);
    await page.waitFor(() => expect(title(page.host)).toBe("Kept work"));

    page.press(m.workbench_download());

    expect(names).toEqual(["zotlit-profile.default.md"]);
    await expect(blobs[0]!.text()).resolves.toBe(KEPT);
  });
});
