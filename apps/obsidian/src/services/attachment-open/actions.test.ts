import { Effect } from "effect";
import { TFile } from "obsidian";
import type {
  App,
  CachedMetadata,
  Command,
  MetadataCache,
  Workspace,
} from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";
import {
  createObsidianAttachmentReader,
  openAttachments,
} from "@/lib/attachment-open";
import { defaults } from "@/services/settings/schema";
import { activateAnnotView } from "@/views/annot-view/register";

import { addAttachmentOpenActions, createPdfReader } from "./actions";
import type { AttachmentOpenDeps, PdfReaderDeps } from "./actions";
import type { LiteratureNoteAttachmentsHandle } from "./handle";
import type { TargetOpener } from "./open-target";
import type { ObsidianOpenableAttachment } from "./resolve";

vi.mock("@/views/annot-view/register", () => ({
  activateAnnotView: vi.fn(),
}));

vi.mock("@/lib/attachment-open", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/attachment-open")>()),
  openAttachments: vi.fn(),
  createObsidianAttachmentReader: vi.fn(() => ({
    icon: "file-text",
    open: vi.fn(),
  })),
}));

beforeEach(() => {
  vi.mocked(openAttachments).mockReset();
  vi.mocked(createObsidianAttachmentReader).mockClear();
  vi.mocked(activateAnnotView).mockClear();
});

/** The Attachments Item ABCD2345 resolves to. */
const OPENABLE_FIXTURE: ObsidianOpenableAttachment[] = [
  {
    indexedKey: "ATCH2345",
    label: "Doe 2024.pdf",
    openPath: "file:/data/storage/ATCH2345/Doe 2024.pdf",
    absolutePath: "/data/storage/ATCH2345/Doe 2024.pdf",
  },
];

/** A lookup that resolves ABCD2345 to {@link OPENABLE_FIXTURE}, and every other key to none. */
const fixtureAttachments: LiteratureNoteAttachmentsHandle = {
  literatureNoteAttachments: (indexedKey) =>
    Promise.resolve(indexedKey === "ABCD2345" ? OPENABLE_FIXTURE : []),
};

/**
 * An App whose workspace has `active` open and whose metadata cache answers
 * `cache` for it.
 */
function appWith(
  active: TFile | null = null,
  cache: CachedMetadata | null = null,
): App {
  return stubService<App>("App", {
    workspace: stubService<Workspace>("Workspace", {
      getActiveFile: () => active,
    }),
    metadataCache: stubService<MetadataCache>("MetadataCache", {
      getFileCache: () => cache,
    }),
  });
}

/** A lookup a case leaves unread: reading one throws. */
const unreadAttachments = stubService<LiteratureNoteAttachmentsHandle>(
  "LiteratureNoteAttachments",
  {},
);

/** An opener a case leaves unused: the picker it builds is mocked. */
const unusedOpener = stubService<Pick<TargetOpener, "open">>(
  "TargetOpener",
  {},
);

function lookupDeps(
  attachments: LiteratureNoteAttachmentsHandle,
  overrides: Partial<AttachmentOpenDeps & PdfReaderDeps> = {},
): AttachmentOpenDeps & PdfReaderDeps {
  return {
    app: appWith(),
    attachments,
    settings: { current: Effect.succeed(defaults) },
    bridge: { runSync: Effect.runSync },
    opener: unusedOpener,
    ...overrides,
  };
}

describe("open-pdf command", () => {
  function register(deps: AttachmentOpenDeps): Command {
    let command: Command | undefined;
    addAttachmentOpenActions(
      {
        addCommand(value) {
          command = value;
          return value;
        },
      },
      deps,
    );
    if (!command) throw new Error("Command was not registered");
    return command;
  }

  it("is unavailable without an active file", () => {
    const deps = lookupDeps(unreadAttachments);
    expect(register(deps).checkCallback?.(true)).toBe(false);
  });

  it("is unavailable when the active file carries no item key", () => {
    const file = new TFile();
    const deps = lookupDeps(unreadAttachments, {
      app: appWith(file, { frontmatter: {} }),
    });
    expect(register(deps).checkCallback?.(true)).toBe(false);
  });

  it("opens the resolved Attachments through the Suggest modal picker once run", async () => {
    const file = new TFile();

    const app = appWith(file, { frontmatter: { "zotero-key": "ABCD2345" } });
    const deps = lookupDeps(fixtureAttachments, { app });

    const command = register(deps);
    expect(command.checkCallback?.(true)).toBe(true);
    command.checkCallback?.(false);

    await vi.waitFor(() =>
      expect(openAttachments).toHaveBeenCalledExactlyOnceWith(
        OPENABLE_FIXTURE,
        {
          reader: expect.anything(),
          app,
        },
      ),
    );
  });

  it("calls openAttachments with an empty list when nothing resolves, deferring the notice to the reader", async () => {
    const file = new TFile();

    const app = appWith(file, { frontmatter: { "zotero-key": "ZZZZ2345" } });
    const deps = lookupDeps(fixtureAttachments, { app });

    const command = register(deps);
    command.checkCallback?.(false);

    await vi.waitFor(() =>
      expect(openAttachments).toHaveBeenCalledExactlyOnceWith([], {
        reader: expect.anything(),
        app,
      }),
    );
  });
});

describe("createPdfReader", () => {
  /** The hook the reader hands back to its caller once a file is on screen. */
  function onOpenedOf(deps: PdfReaderDeps): () => void {
    createPdfReader(deps);
    const [, options] = vi.mocked(createObsidianAttachmentReader).mock
      .calls[0]!;
    const onOpened = options?.onOpened;
    if (!onOpened) throw new Error("the reader was built with no onOpened");
    return onOpened;
  }

  it("brings the annotation view forward beside the PDF by default", () => {
    const deps = lookupDeps(unreadAttachments);

    onOpenedOf(deps)();

    expect(activateAnnotView).toHaveBeenCalledWith(deps.app);
  });

  it("leaves the sidebar alone once the user turns the reveal off", () => {
    onOpenedOf(
      lookupDeps(unreadAttachments, {
        settings: {
          current: Effect.succeed({
            ...defaults,
            "reader.focus-annot-view": false,
          }),
        },
      }),
    )();

    expect(activateAnnotView).not.toHaveBeenCalled();
  });
});
