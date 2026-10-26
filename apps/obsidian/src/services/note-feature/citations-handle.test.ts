// The views' edge to the citation renders and the annotation insert.
import { it } from "@effect/vitest";
import { Effect, Layer, Stream } from "effect";
import { expect, vi } from "vitest";

import type { CiteRef } from "@zotlit/db";

import { stubService } from "@/lib/__fixtures__/service-stub";
import { effectBridge } from "@/lib/effect-bridge";
import { buildRuntime } from "@/lib/effect-layer";
import type { AnnotationRecord } from "@/services/annotation-repository/service";
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
import { layerZoteroReads } from "@/services/zotero-reads/service";
import {
  inProcessClient,
  memoryOpener,
} from "@/services/zotero-reads/test-utils";

import { bindNoteCitations } from "./citations-handle";
import type { NoteCitationServices } from "./citations-handle";
import type { AnnotationInsertOptions } from "./insert-annotation";

/** My Library, which holds no item. */
const SEED = `
  insert into version (schema, version) values ('userdata', 129);
  insert into libraries (libraryID, type, version, clientVersion)
    values (1, 'user', 1, 1);
`;

const pref = stubService<ZoteroPrefSnapshot>("ZoteroPrefSnapshot", {
  dataDir: "/zotero",
  baseAttachmentPath: null,
});

/** An insert the caller already gave up: it settles before any read. */
const staleInsert: AnnotationInsertOptions = {
  annotation: stubService<AnnotationRecord>("AnnotationRecord", {
    parentKey: "ATCH2345",
  }),
  source: { kind: "zotero-local-api", serverID: "SERVER000001" },
  sourceScope: "/zotero",
  notePath: "Target.md",
  signal: new AbortController().signal,
  valid: () => false,
};

/** The handle on a plugin-like runtime, with a Citation Template that runs `render`. */
async function openHandle(render: (refs: readonly CiteRef[]) => string) {
  const stack = new AsyncDisposableStack();
  const runtime = buildRuntime(
    Layer.mergeAll(
      layerZoteroReads(
        inProcessClient(layerRcRef(memoryOpener(() => SEED).open)),
      ),
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
  const singleExcerpt = vi.fn(() =>
    Promise.reject(new Error("This test prepares no excerpt.")),
  );
  const citations = bindNoteCitations(
    effectBridge(runtime),
    runtime.runSync(Effect.context<NoteCitationServices>()),
    { singleExcerpt },
  );
  return { citations, singleExcerpt, dispose: () => stack.disposeAsync() };
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
    const handle = await openHandle(() => "");
    try {
      await expect(
        handle.citations.renderAnnotationCitation("MISS2345"),
      ).resolves.toEqual({ kind: "not-in-database" });
      await expect(
        handle.citations.prepareAnnotationInsert(staleInsert),
      ).resolves.toBeNull();
      expect(handle.singleExcerpt).not.toHaveBeenCalled();
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
      citations.prepareAnnotationInsert(staleInsert),
    ).rejects.toBeInstanceOf(DbUnavailable);
  }),
);
