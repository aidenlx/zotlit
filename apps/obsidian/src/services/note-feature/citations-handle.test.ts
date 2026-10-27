// The views' edge to the citation renders and the annotation insert.
import { it } from "@effect/vitest";
import { Effect, Layer, Stream } from "effect";
import { expect, vi } from "vitest";

import type { CiteRef } from "@zotlit/db";

import { stubService } from "@/lib/__fixtures__/service-stub";
import { AbortError } from "@/lib/abort-error";
import { effectBridge } from "@/lib/effect-bridge";
import { buildRuntime } from "@/lib/effect-layer";
import type { AnnotationRecord } from "@/services/annotation-repository/service";
import { ExcerptPreparation } from "@/services/excerpt-image/prepare";
import { NoteIndex } from "@/services/note-index/service";
import { Profile } from "@/services/profile/service";
import { defaults } from "@/services/settings/schema";
import { PluginSettings } from "@/services/settings/service";
import {
  InertTemplateError,
  TemplateRenderError,
} from "@/services/template/errors";
import { Template } from "@/services/template/service";
import { ZoteroPref } from "@/services/zotero-pref/service";
import type { ZoteroPrefSnapshot } from "@/services/zotero-pref/service";
import { layerRcRef } from "@/services/zotero-reads/connection";
import { DbUnavailable } from "@/services/zotero-reads/rpc";
import { layerZoteroReads, ZoteroReads } from "@/services/zotero-reads/service";
import type { ZoteroReadsApi } from "@/services/zotero-reads/service";
import {
  inProcessClient,
  memoryOpener,
} from "@/services/zotero-reads/test-utils";

import { bindNoteCitations } from "./citations-handle";
import type {
  AnnotationInsertRequest,
  NoteCitationServices,
} from "./citations-handle";

/**
 * A journal article with the citation key `Hensher2011` and an attachment
 * that holds the highlight `ANNT2345` on page 62, in the personal library.
 */
const SEED = `
  insert into version (schema, version) values ('userdata', 129);
  insert into libraries (libraryID, type, version) values (1, 'user', 0);
  insert into itemTypes (itemTypeID, typeName)
    values (1, 'journalArticle'), (2, 'attachment'), (4, 'annotation');
  insert into fieldsCombined (fieldID, fieldName, custom)
    values (10, 'title', 0), (11, 'citationKey', 0);
  insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
    values
      (1, 1, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'MAIN2345'),
      (2, 2, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'ATCH2345'),
      (3, 4, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'ANNT2345');
  insert into itemDataValues (valueID, value)
    values (1, 'Travel demand'), (2, 'Hensher2011');
  insert into itemData (itemID, fieldID, valueID) values (1, 10, 1), (1, 11, 2);
  insert into itemAttachments (itemID, parentItemID, linkMode, contentType, path)
    values (2, 1, 0, 'application/pdf', 'storage:paper.pdf');
  insert into itemAnnotations (
    itemID, parentItemID, type, text, color, pageLabel, sortIndex, position
  )
    values (3, 2, 1, 'excerpt', '#ffd400', '62', '00000|000000|00000',
      '{"pageIndex":61,"rects":[[0,0,1,1]]}');
`;

const pref = stubService<ZoteroPrefSnapshot>("ZoteroPrefSnapshot", {
  dataDir: "/zotero",
  baseAttachmentPath: null,
});

/** An insert of a card into a note; `valid` says whether the editor still takes it. */
function insertRequest(
  options: { valid?: boolean; signal?: AbortSignal } = {},
): AnnotationInsertRequest {
  return {
    annotation: stubService<AnnotationRecord>("AnnotationRecord", {
      parentKey: "ATCH2345",
    }),
    source: { kind: "zotero-local-api", serverID: "SERVER000001" },
    sourceScope: "/zotero",
    notePath: "Target.md",
    signal: options.signal ?? new AbortController().signal,
    valid: () => options.valid ?? false,
  };
}

/** Reads whose Snapshot never opens. */
const pendingReads = Layer.mock(ZoteroReads, {
  reads: stubService<ZoteroReadsApi>("ZoteroReadsApi", {}),
  snapshot: Effect.never,
});

/** The handle on a plugin-like runtime, with a Citation Template that runs `render`. */
async function openHandle(
  render: (refs: readonly CiteRef[]) => string,
  reads: Layer.Layer<ZoteroReads> = layerZoteroReads(
    inProcessClient(layerRcRef(memoryOpener(() => SEED).open)),
  ),
) {
  const stack = new AsyncDisposableStack();
  const forCard = vi.fn(() => Effect.die("This test prepares no excerpt."));
  const runtime = buildRuntime(
    Layer.mergeAll(
      reads,
      Layer.mock(ExcerptPreparation, { forCard }),
      Layer.mock(Template, {
        loaded: Effect.succeed(true),
        renderCitation: (refs) =>
          Effect.try({
            try: () => render(refs),
            catch: (cause) =>
              cause instanceof InertTemplateError
                ? cause
                : new TemplateRenderError({ message: String(cause), cause }),
          }),
      }),
      Layer.mock(Profile, { loaded: Effect.succeed(true) }),
      Layer.mock(ZoteroPref, {
        current: Effect.succeed(pref),
        changes: Stream.make(pref),
      }),
      Layer.mock(PluginSettings, { current: Effect.succeed(defaults) }),
      Layer.mock(NoteIndex, { getNotesByItemKey: () => Effect.succeed([]) }),
    ),
    stack,
  );
  await runtime.context();
  const citations = bindNoteCitations(
    effectBridge(runtime),
    runtime.runSync(Effect.context<NoteCitationServices>()),
  );
  return { citations, forCard, dispose: () => stack.disposeAsync() };
}

it.effect(
  "renders a citation synchronously and throws what the Template threw",
  () =>
    Effect.promise(async () => {
      const inert = new InertTemplateError("The Citation Template is inert");
      const broken = new Error("engine failed");
      let fault: Error | null = null;
      const handle = await openHandle((refs) => {
        if (fault) throw fault;
        return `[@${refs[0]!.citationKey}]`;
      });
      try {
        const { citations } = handle;
        expect(
          citations.renderCitation([{ citationKey: "smith2024" }], "main"),
        ).toBe("[@smith2024]");
        fault = inert;
        expect(() =>
          citations.renderCitation([{ citationKey: "smith2024" }], "main"),
        ).toThrow(inert);
        fault = broken;
        expect(() =>
          citations.renderCitation([{ citationKey: "smith2024" }], "main"),
        ).toThrow(broken);
      } finally {
        await handle.dispose();
      }
    }),
);

it.effect("resolves the annotation reads with their results", () =>
  Effect.promise(async () => {
    const handle = await openHandle((refs) => `[@${refs[0]!.citationKey}]`);
    try {
      await expect(
        handle.citations.renderAnnotationCitation("ANNT2345"),
      ).resolves.toEqual({ kind: "citation", text: "[@Hensher2011]" });
      await expect(
        handle.citations.renderAnnotationCitation("MISS2345"),
      ).resolves.toEqual({ kind: "not-in-database" });
      await expect(
        handle.citations.prepareAnnotationInsert(insertRequest()),
      ).resolves.toBeNull();
      expect(handle.forCard).not.toHaveBeenCalled();
    } finally {
      await handle.dispose();
    }
  }),
);

it.effect("rejects Copy citation with what the Citation Template threw", () =>
  Effect.promise(async () => {
    // The annotation view shows an inert template's own message.
    const inert = new InertTemplateError("The Citation Template is inert");
    const handle = await openHandle(() => {
      throw inert;
    });
    try {
      await expect(
        handle.citations.renderAnnotationCitation("ANNT2345"),
      ).rejects.toBe(inert);
    } finally {
      await handle.dispose();
    }
  }),
);

it.effect("settles as the bridge does after the runtime is disposed", () =>
  Effect.promise(async () => {
    const handle = await openHandle((refs) => `[@${refs[0]!.citationKey}]`);
    await handle.dispose();
    const { citations } = handle;
    // The released Template still answers; the closed reads fail as closed.
    expect(
      citations.renderCitation([{ citationKey: "smith2024" }], "alt"),
    ).toBe("[@smith2024]");
    await expect(
      citations.renderAnnotationCitation("MISS2345"),
    ).rejects.toBeInstanceOf(DbUnavailable);
    await expect(
      citations.prepareAnnotationInsert(insertRequest()),
    ).rejects.toBeInstanceOf(DbUnavailable);
  }),
);

it.effect(
  "rejects a pending insert with an AbortError when the runtime is disposed",
  () =>
    Effect.promise(async () => {
      const handle = await openHandle(() => "", pendingReads);
      const pending = handle.citations.prepareAnnotationInsert(
        insertRequest({ valid: true }),
      );
      const settled = pending.then(
        () => "resolved",
        (error: unknown) => error,
      );
      await handle.dispose();
      // The view's insert reads an AbortError as unload, which shows nothing.
      expect(AbortError.test(await settled)).toBe(true);
    }),
);

it.effect("rejects a pending insert with the reason its caller aborted", () =>
  Effect.promise(async () => {
    const handle = await openHandle(() => "", pendingReads);
    try {
      const controller = new AbortController();
      const pending = handle.citations.prepareAnnotationInsert(
        insertRequest({ valid: true, signal: controller.signal }),
      );
      const reason = new Error("The card was dropped elsewhere");
      controller.abort(reason);
      await expect(pending).rejects.toBe(reason);
    } finally {
      await handle.dispose();
    }
  }),
);
