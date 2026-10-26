// The Note Feature's edge handle: Promise answers over the plugin runtime.
// The members are Promise edges on purpose, so these cases stay plain.
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import type { Item } from "@zotlit/db";

import { MemoryFileManager } from "@/lib/__fixtures__/obsidian-file-manager";
import { createObsidianHost } from "@/lib/__fixtures__/obsidian-host";
import { stubService } from "@/lib/__fixtures__/service-stub";
import type { ProfileId } from "@/lib/profile-stamp";
import type { AttachmentImportHandle } from "@/services/attachment-import/handle";
import type { ExcerptSummary } from "@/services/excerpt-image/prepare";
import { profileReader } from "@/services/profile/__fixtures__/reader";
import { defaults } from "@/services/settings/schema";
import { readsAnswering } from "@/services/zotero-reads/__fixtures__";

import { noteFeatureHandle } from "./__fixtures__/note-feature";
import { ItemNotFound } from "./errors";
import { NoteFeature } from "./service";

const PAPERS = "Rz9Wm4YfH6Kd" as ProfileId;
const ITEM = stubService<Item>("Item", { itemID: 1, indexedKey: "ABCD2345" });

/** The handle over a runtime that holds the Note Feature and its services. */
function harness() {
  const stack = new AsyncDisposableStack();
  const settings = { ...defaults, profiles: [{ id: PAPERS, label: "Papers" }] };
  const reads = readsAnswering({
    ItemsByIndexedKeys: () =>
      Effect.succeed(new Map([[ITEM.indexedKey, ITEM]])),
    // The Snapshot lost the Item between the preview and its create.
    NoteSource: () => Effect.succeed(null),
  });
  const host = createObsidianHost();
  const { handle, runtime } = noteFeatureHandle(
    {
      profile: profileReader(settings),
      noteIndex: {
        whenIndexed: async () => {},
        getNotesByItemKey: () => [],
        getImportedNoteByNoteKey: () => [],
      },
      zoteroReads: { reads, snapshot: Effect.succeed(reads) },
      template: {
        render: () => "",
        renderManagedContent: () => "",
        renderFilename: () => "",
        getLiteratureNoteTemplate: () => undefined,
        frontmatterFields: [],
      },
      app: {
        ...host.app,
        fileManager: new MemoryFileManager(),
      },
      settings: {
        current: Effect.succeed(settings),
        update: () => Effect.succeed(settings),
      },
      zoteroPref: { dataDir: "/zotero", baseAttachmentPath: null },
      attachmentImport: stubService<Pick<AttachmentImportHandle, "prepare">>(
        "AttachmentImport",
        {},
      ),
    },
    stack,
  );
  return {
    handle,
    settings,
    /** Report `summary` on the Note Feature's changes, as a batch does. */
    report: (summary: ExcerptSummary) =>
      runtime.runPromise(
        Effect.flatMap(NoteFeature, (feature) =>
          feature.reportExcerptImages(summary),
        ),
      ),
    [Symbol.asyncDispose]: () => stack.disposeAsync(),
    dispose: () => stack.disposeAsync(),
  };
}

describe("bindNoteFeature", () => {
  it("resolves with the member's result", async () => {
    await using h = harness();
    await expect(
      h.handle.resolveCreationProfile({ headless: PAPERS }),
    ).resolves.toEqual({
      selector: PAPERS,
      source: "headless",
      shouldAsk: true,
    });
  });

  it("settles as the bridge does once the runtime is disposed", async () => {
    const h = harness();
    await h.dispose();
    // A read answers from the services the bridge captured.
    await expect(h.handle.resolveCreationProfile()).resolves.toEqual({
      selector: "default",
      source: "bound",
      shouldAsk: true,
    });
    // A write runs on the captured services too, and fails as it would before.
    await expect(h.handle.createNote(ITEM)).rejects.toBeInstanceOf(
      ItemNotFound,
    );
  });

  it("calls an event listener until it unsubscribes", async () => {
    await using h = harness();
    const heard = vi.fn();
    const stop = h.handle.on("excerpt-images-reported", heard);
    const summary = { zotero: 1, unchecked: 0, unavailable: 0 };
    await h.report(summary);
    await vi.waitFor(() => expect(heard).toHaveBeenCalledWith(summary));
    stop();
    await h.report(summary);
    expect(heard).toHaveBeenCalledTimes(1);
  });
});
