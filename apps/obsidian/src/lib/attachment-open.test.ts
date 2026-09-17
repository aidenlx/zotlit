import { Keymap, Menu, TFile } from "@mock/obsidian";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { App } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ObsidianOpenableAttachment } from "@/services/attachment-open/resolve";

import {
  createObsidianAttachmentReader,
  openAttachments,
} from "./attachment-open";
import type {
  AttachmentOpenClickEvent,
  AttachmentReader,
} from "./attachment-open";

interface Row {
  label: string;
}

function fakeReactMouseEvent(
  overrides: Partial<{
    detail: number;
    nativeEvent: MouseEvent;
    currentTarget: { getBoundingClientRect: () => DOMRect };
  }> = {},
) {
  return {
    detail: 1,
    nativeEvent: {} as MouseEvent,
    currentTarget: {
      getBoundingClientRect: () => ({ left: 0, bottom: 0 }) as DOMRect,
    },
    ...overrides,
  } as unknown as AttachmentOpenClickEvent;
}

function fakeReader(): AttachmentReader<Row> & {
  calls: [Row, unknown][];
  emptyCalls: number;
} {
  const calls: [Row, unknown][] = [];
  let emptyCalls = 0;
  return {
    icon: "paperclip",
    calls,
    get emptyCalls() {
      return emptyCalls;
    },
    onEmpty: () => {
      emptyCalls++;
    },
    open: (attachment, pane) => {
      calls.push([attachment, pane]);
    },
  };
}

describe("openAttachments", () => {
  beforeEach(() => {
    Menu.instances.length = 0;
  });

  it("defers to the reader's onEmpty when there are no Attachments", () => {
    const reader = fakeReader();
    openAttachments([], { reader, event: fakeReactMouseEvent() });
    expect(reader.calls).toStrictEqual([]);
    expect(reader.emptyCalls).toBe(1);
  });

  it("opens a single Attachment straight away, without a picker", () => {
    const reader = fakeReader();
    const attachment = { label: "Doe 2024.pdf" };
    openAttachments([attachment], { reader, event: fakeReactMouseEvent() });
    expect(reader.calls).toStrictEqual([[attachment, false]]);
    expect(Menu.instances).toHaveLength(0);
  });

  it("forwards a Mod-click's new-pane request for a single Attachment", () => {
    using _isModEvent = vi.spyOn(Keymap, "isModEvent").mockReturnValue(true);
    const reader = fakeReader();
    const attachment = { label: "Doe 2024.pdf" };
    openAttachments([attachment], { reader, event: fakeReactMouseEvent() });
    expect(reader.calls).toStrictEqual([[attachment, true]]);
  });

  it("opens a single Attachment with no event and no modifier, for an event-less invocation", () => {
    const reader = fakeReader();
    const attachment = { label: "Doe 2024.pdf" };
    openAttachments([attachment], { reader, app: {} as App });
    expect(reader.calls).toStrictEqual([[attachment, false]]);
  });

  it("shows a Menu for several Attachments when a pointer event is given", () => {
    const reader = fakeReader();
    const a = { label: "Alpha.pdf" };
    const b = { label: "Beta.pdf" };
    openAttachments([a, b], { reader, event: fakeReactMouseEvent() });

    expect(Menu.instances).toHaveLength(1);
    const menu = Menu.instances[0]!;
    expect(menu.items.map((item) => item.title)).toStrictEqual([
      "Alpha.pdf",
      "Beta.pdf",
    ]);

    menu.items[1]!.click();
    expect(reader.calls).toStrictEqual([[b, false]]);
  });
});

describe("createObsidianAttachmentReader", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "zotlit-attachment-open-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function fakeApp(getFile: (path: string) => TFile | null): {
    app: App;
    openFile: ReturnType<typeof vi.fn>;
  } {
    const openFile = vi.fn();
    const app = {
      vault: { getFileByPath: getFile },
      workspace: {
        getLeaf: () => ({ openFile }),
      },
    } as unknown as App;
    return { app, openFile };
  }

  it("opens the resolved vault file once the disk file is confirmed", async () => {
    const absolutePath = join(dir, "Doe 2024.pdf");
    await writeFile(absolutePath, "");
    const file = new TFile();
    const { app, openFile } = fakeApp((path) =>
      path === "papers/Doe 2024.pdf" ? file : null,
    );
    const reader = createObsidianAttachmentReader(app);
    const attachment: ObsidianOpenableAttachment = {
      indexedKey: "ATCH2345",
      label: "Doe 2024.pdf",
      openPath: "papers/Doe 2024.pdf",
      absolutePath,
    };

    await reader.open(attachment, false);

    expect(openFile).toHaveBeenCalledWith(file);
  });

  it("does not open when Obsidian resolves no file for the open path — the missing-file signal, whether the path never existed or Zotero moved it away since the read", async () => {
    const absolutePath = join(dir, "Doe 2024.pdf");
    await writeFile(absolutePath, "");
    const { app, openFile } = fakeApp(() => null);
    const reader = createObsidianAttachmentReader(app);
    const attachment: ObsidianOpenableAttachment = {
      indexedKey: "ATCH2345",
      label: "Doe 2024.pdf",
      openPath: "papers/Doe 2024.pdf",
      absolutePath,
    };

    await reader.open(attachment, false);

    expect(openFile).not.toHaveBeenCalled();
  });
});
