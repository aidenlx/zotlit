// The creation planning edge handle: Promise answers over the plugin runtime.
// The members are Promise edges on purpose, so these cases stay plain.
import { Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";

import type { Item, NoteTemplateContext } from "@zotlit/db";

import { stubService } from "@/lib/__fixtures__/service-stub";
import { effectBridge } from "@/lib/effect-bridge";
import { buildRuntime } from "@/lib/effect-layer";
import type { ProfileId } from "@/lib/profile-stamp";
import {
  profileReader,
  resolveProfile,
} from "@/services/profile/__fixtures__/reader";
import { defaults } from "@/services/settings/schema";
import type { ResolvedLiteratureNoteTemplate } from "@/services/template/service";
import { readsAnswering } from "@/services/zotero-reads/__fixtures__";

import { planningContext } from "./__fixtures__/planning-context";
import type { CreateAtGate } from "./creation-planning";
import { bindCreationPlanning } from "./creation-planning-handle";

const PAPERS = "Rz9Wm4YfH6Kd" as ProfileId;
const ITEM = stubService<Item>("Item", { indexedKey: "ABCD2345" });

/** The handle over a runtime that holds the planning services. */
async function harness(create: CreateAtGate = vi.fn()) {
  const stack = new AsyncDisposableStack();
  const settings = { ...defaults, profiles: [{ id: PAPERS, label: "Papers" }] };
  const reads = readsAnswering({
    ItemsByIndexedKeys: () =>
      Effect.succeed(new Map([[ITEM.indexedKey, ITEM]])),
  });
  const runtime = buildRuntime(
    Layer.succeedContext(
      planningContext({
        profile: profileReader(settings),
        noteIndex: {
          whenIndexed: async () => {},
          getNotesByItemKey: () => [],
          getImportedNoteByNoteKey: () => [],
        },
        zoteroReads: { reads, snapshot: Effect.succeed(reads) },
        template: {
          renderFilename: () => "",
          getLiteratureNoteTemplate: () => undefined,
          frontmatterFields: [],
        },
        app: {
          vault: { getAbstractFileByPath: () => null },
          metadataCache: { getFileCache: () => null },
        },
      }),
    ),
    stack,
  );
  const context = await runtime.context();
  return {
    handle: bindCreationPlanning(effectBridge(runtime), context, { create }),
    settings,
    [Symbol.asyncDispose]: () => stack.disposeAsync(),
    dispose: () => stack.disposeAsync(),
  };
}

describe("bindCreationPlanning", () => {
  it("resolves with the function's result", async () => {
    await using h = await harness();
    await expect(
      h.handle.resolveCreationProfile({ headless: PAPERS }),
    ).resolves.toEqual({
      selector: PAPERS,
      source: "headless",
      shouldAsk: true,
    });
  });

  it("rejects a plan with its signal's abort reason, before it reads", async () => {
    await using h = await harness();
    const reason = new Error("Stopped by the researcher");
    await expect(
      h.handle.planCreations(["ABCD2345"], {
        signal: AbortSignal.abort(reason),
      }),
    ).rejects.toBe(reason);
  });

  it("settles as the bridge does once the runtime is disposed", async () => {
    const h = await harness();
    await h.dispose();
    // A plan runs in the runtime's scope, which unload closed.
    await expect(h.handle.planCreations(["ABCD2345"])).rejects.toBeDefined();
    // A read answers from the services the bridge captured.
    await expect(h.handle.resolveCreationProfile()).resolves.toEqual({
      selector: "default",
      source: "bound",
      shouldAsk: true,
    });
  });

  it("rejects a Profile note's create with the create gate's own rejection", async () => {
    const refusal = new Error("File already exists.");
    const create = vi.fn<CreateAtGate>(async () => {
      throw refusal;
    });
    await using h = await harness(create);
    const preview = h.handle.prepareProfileNote({
      profile: resolveProfile(h.settings, "default"),
      document: stubService<ResolvedLiteratureNoteTemplate>("Document", {
        frontmatter: undefined,
        renderFilename: () => "Paper",
        renderForCreate: () => "Body",
      }),
      note: stubService<NoteTemplateContext>("NoteTemplateContext", {
        indexedKey: ITEM.indexedKey,
      }),
      filename: {},
    });
    expect(preview).toMatchObject({
      path: "literatures/Paper.md",
      body: "Body",
    });
    await expect(preview.create()).rejects.toBe(refusal);
    expect(create).toHaveBeenCalledWith(
      ITEM,
      expect.objectContaining({
        profile: "default",
        preparedPath: { path: "literatures/Paper.md" },
      }),
    );
  });
});
