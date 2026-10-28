import { Layer } from "effect";
import type { PartialPreviewSelection, RenderRequest } from "@zotlit/workbench/render";
import { runOnView } from "@/lib/__fixtures__/view-runner";
import { makeNativeRenderer } from "@/views/note-preview/render";
import type { NativeRenderDeps, NativeRenderResult } from "@/views/note-preview/render";
import { buildRuntime } from "@/lib/effect-layer";
import { layerHostApp } from "@/lib/__fixtures__/obsidian-host-app";
import { layerUnreadViewServices } from "@/lib/__fixtures__/view-atoms";
import { makeViewRegistry } from "@/lib/view-atoms";
import { CitationLookup } from "@/services/citation-index/lookup-service";
import { CitationParse } from "@/services/citation-parse/service";
import { BibliographyRender } from "@/services/pandoc/render-cache";
import { Profile } from "@/services/profile/service";
import { PluginSettings } from "@/services/settings/service";
import { NoteIndex } from "@/services/note-index/service";
import { ZoteroPref } from "@/services/zotero-pref/service";
import { DEFAULT_PROFILE_SOURCE } from "@zotlit/workbench/render";
import type { EffectBridge } from "@/lib/effect-bridge";
import type { SubscriptionRuntime } from "@/lib/effect-stream";
import type { TemplateDataDeps } from "@/services/template-workbench/data";
import type { findExistingLitNote } from "@/services/template/inert-resolver-host";
import type { ParseClient } from "@/services/citation-parse/client";
import type { CitationLookupRequest, CitationLookupAnswer } from "@/services/citation-index/lookup";
import type { EffectivePresentation } from "@/services/pandoc/document-presentation";

type PromiseMethods<T> = {
  [K in keyof T]: T[K] extends (...args: infer P) => Effect.Effect<infer A, infer _E, infer _R>
    ? (...args: P) => Promise<A> : never;
};

/** The old Promise boundaries that existing behavior tests drive through the host. */
interface PreviewHostDeps extends TemplateDataDeps {
  runtime: SubscriptionRuntime;
  app: App;
  settings: Pick<PluginSettings["Service"], "current">;
  noteIndex: Parameters<typeof findExistingLitNote>[0];
  bridge: Pick<EffectBridge, "runSync">;
  zoteroReads: Pick<ReturnType<typeof inProcessReadsService>, "acquireRead" | "events">;
  templates: Pick<Template["Service"], "render" | "renderCitation" | "renderCitationSource" | "renderPartialSource" | "prepareLiteratureNoteTemplateSource" | "frontmatterFields" | "javascriptTemplatesEnabled" | "compileEvents">;
  profile: Pick<Profile["Service"], "resolveProfile" | "getBuiltInSource" | "profiles">;
  citationParse: Pick<ParseClient, "parse">;
  citationLookup: { read(request: CitationLookupRequest): Promise<CitationLookupAnswer> };
  bibliographyRender: Pick<PromiseMethods<BibliographyRender["Service"]>, "renderCitations" | "readCitations" | "readBibliography"> & {
    readonly vaultPresentation: EffectivePresentation;
    readonly changed: Stream.Stream<never>;
    readonly settled: Stream.Stream<never>;
    readonly invalidated: Stream.Stream<void>;
    readonly "style-missing": Stream.Stream<never>;
  };
}
import { Stream } from "effect";
import { buildSettings } from "@/services/settings/__fixtures__";
import { inProcessParseClient } from "@/services/citation-parse/in-process";
import { lookupAnswer } from "@/services/citation-index/__fixtures__/lookup";
// Live database and TemplateService boundaries for native preview tests.
import type { DatabaseSync } from "node:sqlite";
import type { App, Events } from "obsidian";
import { Effect } from "effect";
import { expect, vi } from "vitest";
import { createClient } from "@zotlit/db/client/node";
import { createFixtureSchema } from "@zotlit/db/test-utils";
import { exportItemSnapshot } from "@zotlit/workbench/snapshot";
import type { RenderedCitation } from "@/services/pandoc/engine";

import { buildTemplate } from "@/services/template/__fixtures__";
import { createObsidianHost, PluginStub } from "@/lib/__fixtures__/obsidian-host";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { inProcessReadsService, sharedClientOpener } from "@/services/zotero-reads/test-utils";
import { templateDataHandle } from "@/services/template-workbench/__fixtures__";
import { Template } from "@/services/template/service";
import { ZoteroReads } from "@/services/zotero-reads/service";

type EventSource = Pick<Events, "on" | "offref">;

function eventMethods(source: EventSource) {
  return {
    on: (name: string, callback: (...args: never[]) => unknown) =>
      source.on(name, (...args: unknown[]) =>
        Reflect.apply(callback, undefined, args),
      ),
    offref: (ref: Parameters<EventSource["offref"]>[0]) => source.offref(ref),
  };
}

export const PROFILE_SOURCE = `---
id: paper
name: Paper
version: 1.0.0
contract: 5
filename: '{{ zt.title }}'
citationStyle: numeric
frontmatter:
  - key: title
    merge: replace
    expr: zt.title
  - key: tags
    merge: append
    value: [review]
---
# {{ zt.title }}

{% managed %}Managed {{ zt.title }}.
{% for annotation in zt.annotations %}{% render 'annotation' with annotation as zt %}{% endfor %}{% endmanaged %}

Personal space.
--- zotlit:annotation ---
> [!quote]
> {{ zt.text }}
`;
export const SAVED_NOTE = `---
title: Old title
private: Keep this
number: 7
tags: [mine]
---
Personal introduction.

%%zt-managed%%
Old generated body.
%%/zt-managed%%

Personal conclusion.
`;

export async function createRenderFixture(options: { existing?: string; javascript?: boolean; wikilinks?: boolean; defaultStyle?: string; partials?: Record<string, string> } = {}) {
  const client = createClient(":memory:");
  const sqlite = client.$client as DatabaseSync;
  createFixtureSchema(sqlite);
  sqlite.exec(`
    insert into libraries (libraryID, type, editable, filesEditable) values (1, 'user', 1, 1);
    insert into itemTypes (itemTypeID, typeName) values (1, 'journalArticle'), (2, 'attachment'), (3, 'annotation');
    insert into fieldsCombined (fieldID, fieldName, custom) values (1, 'title', 0), (2, 'citationKey', 0);
    insert into itemDataValues (valueID, value) values (1, 'Better figures'), (2, 'figures2014');
    insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key) values
      (1, 1, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'MAIN2345'),
      (2, 2, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'ATCH2345'),
      (3, 3, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'ANNA2345');
    insert into itemData (itemID, fieldID, valueID) values (1, 1, 1), (1, 2, 2);
    insert into itemAttachments (itemID, parentItemID, linkMode, contentType, path) values (2, 1, 0, 'application/pdf', 'storage:paper.pdf');
    insert into itemAnnotations (itemID, parentItemID, type, authorName, text, comment, color, pageLabel, sortIndex, position, isExternal)
      values (3, 2, 1, null, 'Use readable figures.', null, '#ffd400', '2', '00000|000001|00000', '{"pageIndex":1,"rects":[]}', 0);
  `);
  const host = createObsidianHost();
  const { vault } = host;
  const file = options.existing === undefined ? null : vault.addFile("notes/paper.md", options.existing);
  // Registered before `TemplateService` starts, so its initial folder scan
  // discovers the Shared Partial the way a saved vault would.
  for (const [name, source] of Object.entries(options.partials ?? {}))
    vault.addFile(`templates/zotlit-partial.${name}.md`, source);
  const memory = new Map<string, unknown>(options.javascript ? [["zotlit-javascript-templates", "1"]] : []);
  const requestSaveLayout: App["workspace"]["requestSaveLayout"] =
    Object.assign(vi.fn(() => requestSaveLayout), {
      cancel: () => requestSaveLayout,
      run: () => undefined,
    });
  const app = stubService<App>("App", {
    scope: stubService<App["scope"]>("Scope", {}),
    vault: stubService<App["vault"]>("Vault", {
      ...eventMethods(vault),
      read: (file) => vault.read(file),
      cachedRead: (file) => vault.cachedRead(file),
      process: (file, fn) => vault.process(file, fn),
      create: (path, data) => vault.create(path, data),
      trash: async (file) => vault.deleteFile(file.path),
      getConfig: () => false,
      getFileByPath: (path) => vault.getFileByPath(path),
      getFolderByPath: (path) => vault.getFolderByPath(path),
      getAbstractFileByPath: (path) => vault.getAbstractFileByPath(path),
      getRoot: () => vault.getRoot(),
      getMarkdownFiles: () => vault.getMarkdownFiles(),
    }),
    fileManager: stubService<App["fileManager"]>("FileManager", {
      getAvailablePathForAttachment: async () => "notes/preview.png",
      generateMarkdownLink: (target: { path: string }) =>
        `[[${target.path}]]`,
    }),
    workspace: stubService<App["workspace"]>("Workspace", {
      ...eventMethods(host.workspace),
      onLayoutReady: (callback) => host.workspace.onLayoutReady(callback),
      getActiveFile: () => host.workspace.getActiveFile(),
      getActiveViewOfType: (type) => host.workspace.getActiveViewOfType(type),
      updateOptions: () => host.workspace.updateOptions(),
      iterateAllLeaves: (callback) => host.workspace.iterateAllLeaves(callback),
      requestSaveLayout,
    }),
    metadataCache: stubService<App["metadataCache"]>("MetadataCache", {
      ...eventMethods(host.metadataCache),
      getFirstLinkpathDest: (path: string) => path === "notes/paper.md" ? file : null,
      getFileCache: () => ({ frontmatter: { "zotero-key": "MAIN2345" } }),
      onCleanCache: (callback) => host.metadataCache.onCleanCache(callback),
    }),
    loadLocalStorage: (key: string) => memory.get(key) ?? null,
    saveLocalStorage: (key: string, value: unknown) => memory.set(key, value),
  });
  const plugin = new PluginStub(app, { __VERSION__: 1, "note.template-conversion-pending": true, "citation.wikilink-citations": options.wikilinks ?? false });
  const identity = (raw: unknown) => raw;
  const settings = await buildSettings({ plugin, migrateLegacy: identity, migrateV1: identity, migrateV2: identity, migrateV3: identity, migrateV4: identity, migrateV5: identity, migrateV6: identity, migrateV7: identity, migrateV8: identity, migrateV9: identity });
  await settings.bridge.runPromise(settings.loaded);
  if (options.defaultStyle)
    settings.bridge.runSync(
      settings.updateDefaultLiteratureNoteProfileBindings({
        "citation.references-style": options.defaultStyle,
      }),
    );
  const templates = await buildTemplate({ app, settings });
    const renderCitations = vi.fn<PreviewHostDeps["bibliographyRender"]["renderCitations"]>(async (sources, _items, presentation) => {
    const content = presentation?.styleId === "numeric" ? "[1]" : "(Rougier 2014)";
    const value: RenderedCitation[] = sources.map(() => ({ content: [{ t: "Str", c: content }], citations: [{ id: "MAIN2345", mode: "normal" }] }));
    return { kind: "held", key: "fixture", record: { value, status: "fresh", settled: Promise.resolve(value) } };
  });
  const readCitations = vi.fn<PreviewHostDeps["bibliographyRender"]["readCitations"]>(async (sources, items, options) => {
    const outcome = await renderCitations(sources, items, options?.presentation);
    return outcome.kind === "held" ? outcome.record.value : null;
  });
  const zoteroReads = inProcessReadsService(sharedClientOpener(client));
  // The plugin's worker opens the database at start; open it here too, so its
  // first `changed` lands before a view subscribes.
  await Effect.runPromise(zoteroReads.reads.Libraries({}));
  await vi.waitFor(() => expect(zoteroReads.bridge.runSync(zoteroReads.current).state).toBe("ready"));
  const notesOf = (key: string) => (file && key === "MAIN2345" ? [file] : []);
  const handles = new AsyncDisposableStack();
  const templateData = templateDataHandle(handles, {
    app,
    zoteroReads: zoteroReads.runtime.runSync(ZoteroReads),
    template: templates.runtime.runSync(Template),
    settings,
    noteIndex: { getNotesByItemKey: (key) => Effect.succeed(notesOf(key)), getImportedNoteByNoteKey: () => Effect.succeed([]), whenIndexed: Effect.void },
    zoteroPref: { dataDir: "/Zotero", baseAttachmentPath: null },
  });
  const deps = { runtime: settings.runtime, bridge: settings.bridge,
    citationParse: inProcessParseClient,
    app, settings, templates, templateData,
    profile: stubService<PreviewHostDeps["profile"]>("Profile", { resolveProfile: () => Effect.succeed(undefined), getBuiltInSource: Effect.succeed(DEFAULT_PROFILE_SOURCE), profiles: Effect.succeed([]) }),
    zoteroReads,
    noteIndex: { getNotesByItemKey: notesOf },
    citationLookup: {
      read: async ({citekeys = [], indexedKeys = []}) => lookupAnswer(
        Object.fromEntries(citekeys.map((key) => [key, key === "figures2014" ? { kind: "unique", item: { itemID: 1, libraryID: 1, key: "MAIN2345", indexedKey: "MAIN2345" } } : {kind: "missing"}])),
        Object.fromEntries(indexedKeys.map((key) => [key, key === "MAIN2345" ? "figures2014" : null])),
      ),
    },
    bibliographyRender: { changed: Stream.empty, settled: Stream.empty, invalidated: Stream.empty, "style-missing": Stream.empty, renderCitations, readCitations, readBibliography: (async () => null) as PreviewHostDeps["bibliographyRender"]["readBibliography"], vaultPresentation: { styleId: null, locale: null } },
  } satisfies PreviewHostDeps;
  const cancelled: number[] = [];
  const service = zoteroReads.runtime.runSync(ZoteroReads);
  const template = templates.runtime.runSync(Template);
  const runtime = buildRuntime(Layer.mergeAll(
    layerUnreadViewServices,
    layerHostApp(app),
    Layer.succeed(PluginSettings, settings),
    Layer.mock(NoteIndex, { getNotesByItemKey: (key) => Effect.sync(() => deps.noteIndex.getNotesByItemKey(key)), getImportedNoteByNoteKey: () => Effect.succeed([]), whenIndexed: Effect.void }),
    Layer.mock(ZoteroPref, { current: Effect.succeed(stubService<ZoteroPref["Service"]["current"] extends Effect.Effect<infer A, unknown, unknown> ? A : never>("ZoteroPrefSnapshot", { dataDir: "/Zotero", baseAttachmentPath: null })) }),
    Layer.succeed(ZoteroReads, { ...service,
      snapshot: Effect.map(Effect.acquireDisposable(Effect.promise((signal) => { signal.addEventListener("abort", () => cancelled.push(cancelled.length + 1)); return deps.zoteroReads.acquireRead(); }).pipe(Effect.interruptible)), (lease) => lease.reads),
      events: Stream.suspend(() => deps.zoteroReads.events),
    }),
    Layer.succeed(Template, { ...template,
      render: (name, data) => Effect.suspend(() => deps.templates.render(name, data)),
      renderPartialSource: (source, data, options) => Effect.suspend(() => deps.templates.renderPartialSource(source, data, options)),
      renderCitationSource: (source, data) => Effect.suspend(() => deps.templates.renderCitationSource(source, data)),
      prepareLiteratureNoteTemplateSource: (source) => Effect.suspend(() => deps.templates.prepareLiteratureNoteTemplateSource(source)),
      compileEvents: Stream.unwrap(Effect.sync(() => deps.templates.compileEvents)),
    }),
    Layer.mock(Profile, { resolveProfile: (selector) => Effect.suspend(() => deps.profile.resolveProfile(selector)), getBuiltInSource: Effect.suspend(() => deps.profile.getBuiltInSource), changes: Stream.unwrap(Effect.suspend(() => Effect.map(deps.profile.profiles, (profiles) => Stream.make({ loaded: true, profiles, diagnostics: [], defaultDocumentPath: "", templateStatus: templates.bridge.runSync(templates.status) })))) }),
    Layer.mock(CitationParse, { parse: (request) => Effect.suspend(() => deps.citationParse.parse(request)) }),
    Layer.mock(CitationLookup, { read: (request) => Effect.tryPromise(() => deps.citationLookup.read(request)).pipe(Effect.orDie) }),
    Layer.mock(BibliographyRender, {
      state: Effect.sync(() => ({ missingStyle: null, vaultPresentation: deps.bibliographyRender.vaultPresentation })),
      events: Stream.unwrap(Effect.sync(() => Stream.map(deps.bibliographyRender.invalidated, () => ({ _tag: "invalidated" as const })))),
      renderCitations: (...args) => Effect.tryPromise(() => deps.bibliographyRender.renderCitations(...args)),
      readCitations: (...args) => Effect.tryPromise(() => deps.bibliographyRender.readCitations(...args)),
      readBibliography: (...args) => Effect.tryPromise(() => deps.bibliographyRender.readBibliography(...args)),
    }),
  ), handles);
  const registry = makeViewRegistry(await runtime.context(), { idleTTL: 0 });
  handles.defer(() => registry.dispose());
  const previewDeps = Object.assign(deps, { registry });
  const writes = { create: vi.spyOn(vault, "create"), process: vi.spyOn(vault, "process"), modify: vi.spyOn(vault, "modifyFile") };
  const snapshot = exportItemSnapshot(client, { key: "MAIN2345", library: { type: "personal" } }, { provenance: { kind: "connected", installationId: "fixture", vault: "preview" } });
  return { cancelled, deps: previewDeps, settings, templates, client, snapshot, host, vault, zoteroReads, renderCitations, writes, async [Symbol.asyncDispose]() { await handles.disposeAsync(); await templates[Symbol.asyncDispose](); await settings[Symbol.asyncDispose](); await zoteroReads[Symbol.asyncDispose](); sqlite.close(); } };
}

/** One native render, run on a view runner the render alone owns. */
export function renderNativeTemplate(deps: NativeRenderDeps, request: RenderRequest): Promise<NativeRenderResult> {
  return runOnView(deps.registry, makeNativeRenderer(deps).render(request));
}
export const renderNativeProfile = renderNativeTemplate;
/** One registered Shared Partial render, run as {@link renderNativeTemplate} runs. */
export function renderRegisteredPartial(deps: NativeRenderDeps, request: RenderRequest, partial: PartialPreviewSelection): Promise<string> {
  return runOnView(deps.registry, makeNativeRenderer(deps).partial(request, partial));
}
