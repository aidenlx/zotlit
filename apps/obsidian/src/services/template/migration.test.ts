import { it } from "@effect/vitest";
import { Context, Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import { TFile } from "obsidian";
import type { App, Events } from "obsidian";
import { afterEach, beforeEach, describe, expect, vi } from "vitest";

import { citekeysToCiteTemplateData } from "@zotlit/db";
import { LegacyTemplateConversionError } from "@zotlit/templates/facade";

import { MockVault, PluginStub } from "@/lib/__fixtures__/obsidian-host";
import { layerHost } from "@/lib/__fixtures__/obsidian-host-app";
import { MemoryWorkspace } from "@/lib/__fixtures__/obsidian-workspace";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { effectBridge } from "@/lib/effect-bridge";
import { buildRuntime } from "@/lib/effect-layer";
import { buildSettings } from "@/services/settings/__fixtures__";
import { defaults } from "@/services/settings/schema";
import type { Settings } from "@/services/settings/schema";
import type { PluginSettings } from "@/services/settings/service";
import type { SettingsPatch } from "@/services/settings/service";

import { buildTemplate, templateSettings } from "./__fixtures__";
import { layerTemplateMigration, TemplateMigration } from "./migration";
import type { TemplateMigrationOptions } from "./migration";
import { Template, templateFailure } from "./service";
import type {
  ConvertedLegacyProfileDocument,
  LegacyTemplateDocuments,
} from "./service";

type EventSource = Pick<Events, "on" | "offref">;
type EventCallback = (...args: never[]) => unknown;

function eventMethods(source: EventSource) {
  return {
    on: (name: string, callback: EventCallback) =>
      source.on(name, (...args: unknown[]) =>
        Reflect.apply(callback, undefined, args),
      ),
    offref: (ref: Parameters<EventSource["offref"]>[0]) => source.offref(ref),
  };
}

function workspaceOf(workspace: MemoryWorkspace): App["workspace"] {
  return stubService<App["workspace"]>("Workspace", {
    ...eventMethods(workspace),
    onLayoutReady: (callback) => workspace.onLayoutReady(callback),
    getActiveFile: () => workspace.getActiveFile(),
    getActiveViewOfType: (type) => workspace.getActiveViewOfType(type),
  });
}

async function makeHarness(
  options?: {
    pending?: boolean;
    defaultDocument?: string;
    ejectedAnnotation?: boolean;
    verificationAnnotation?: object | null;
    /**
     * The 2.1.x documents the folder holds. Supplying them makes this a vault
     * with no Legacy Template File slots at all, which the prompt still arms
     * for: a `cite` or a bare partial is a legacy file like any other.
     */
    legacyDocuments?: LegacyTemplateDocuments;
  },
  context = Context.empty(),
) {
  const documentsOnly = options?.legacyDocuments !== undefined;
  const state = {
    "note.default-profile": {
      ...defaults["note.default-profile"],
    },
    "note.template-conversion-pending": options?.pending ?? false,
    "note.template-conversion-result": null as {
      document: string | null;
      trashed: number;
      pendingCleanup: string[];
    } | null,
    "template.folder": "templates",
  };
  const legacyPaths = documentsOnly
    ? (options.legacyDocuments?.partials ?? []).map(({ path }) => path)
    : [
        "templates/zotlit-note.liquid.md",
        "templates/zotlit-content.liquid.md",
        "templates/zotlit-filename.liquid.md",
      ];
  if (options?.ejectedAnnotation) {
    legacyPaths.push("templates/zotlit-annotation.liquid.md");
  }
  const fileAt = (path: string) => {
    const file = new TFile();
    file.path = path;
    return file;
  };
  const files = new Map(legacyPaths.map((path) => [path, fileAt(path)]));
  if (options?.defaultDocument)
    files.set(
      "templates/zotlit-profile.default.md",
      fileAt("templates/zotlit-profile.default.md"),
    );
  const workspace = new MemoryWorkspace();
  const create = vi.fn(async (path: string, _source: string) => {
    const file = fileAt(path);
    files.set(path, file);
    return file;
  });
  const trashFile = vi.fn(async (file: TFile) => {
    files.delete(file.path);
  });
  const snapshot = (): Settings => ({ ...defaults, ...state });
  const update = vi.fn(
    (patch: SettingsPatch | ((current: Readonly<Settings>) => SettingsPatch)) =>
      Effect.sync(() => {
        Object.assign(
          state,
          typeof patch === "function" ? patch(snapshot()) : patch,
        );
        return snapshot();
      }),
  );
  /** Called once per run of the `flush` Effect, so a test orders the flushes. */
  const flushRuns = vi.fn(() => Effect.void);
  // `update` stays the spy, so a case reads its calls.
  const settings = Object.assign(
    stubService<PluginSettings["Service"]>("PluginSettings", {
      current: Effect.sync(snapshot),
      update,
      flush: Effect.suspend(flushRuns),
    }),
    { update },
  );
  const bridge = { runSync: Effect.runSync, runPromise: Effect.runPromise };
  const template = {
    refresh: vi.fn(async () => {}),
    getLegacyLiteratureNoteTemplateFiles: vi.fn(() =>
      documentsOnly
        ? []
        : [
            "templates/zotlit-filename.liquid.md",
            "templates/zotlit-note.liquid.md",
            ...(options?.ejectedAnnotation
              ? ["templates/zotlit-annotation.liquid.md"]
              : []),
            "templates/zotlit-content.liquid.md",
          ],
    ),
    convertLegacyLiteratureNoteTemplates: vi.fn(async (_data?: unknown) =>
      stubService<ConvertedLegacyProfileDocument>(
        "ConvertedLegacyProfileDocument",
        {
          source: "converted source",
          legacyFiles: [
            "templates/zotlit-filename.liquid.md",
            "templates/zotlit-note.liquid.md",
            ...(options?.ejectedAnnotation
              ? ["templates/zotlit-annotation.liquid.md"]
              : []),
            "templates/zotlit-content.liquid.md",
          ],
        },
      ),
    ),
    getLegacyTemplateDocuments: vi.fn(
      (): LegacyTemplateDocuments =>
        options?.legacyDocuments ?? { citation: [], partials: [] },
    ),
    convertLegacyTemplateDocuments: vi.fn(async (_refs?: unknown) => ({
      documents: [] as { path: string; source: string }[],
      trashed: [] as string[],
      kept: [] as string[],
    })),
  };
  const openPrompt = vi.fn();
  const service = await buildMigration(
    {
      app: stubService<App>("App", {
        vault: stubService<App["vault"]>("Vault", {
          ...eventMethods(new MemoryWorkspace()),
          getAbstractFileByPath: (path: string) => files.get(path) ?? null,
          getFileByPath: (path: string) => files.get(path) ?? null,
          create,
        }),
        fileManager: stubService<App["fileManager"]>("FileManager", {
          trashFile,
        }),
        workspace: workspaceOf(workspace),
      }),
      settings,
      bridge,
      template: stubService<Template["Service"]>("Template", {
        refresh: Effect.promise(() => template.refresh()),
        getLegacyLiteratureNoteTemplateFiles: Effect.sync(() =>
          template.getLegacyLiteratureNoteTemplateFiles(),
        ),
        getLegacyTemplateDocuments: Effect.sync(() =>
          template.getLegacyTemplateDocuments(),
        ),
        convertLegacyLiteratureNoteTemplates: (data) =>
          Effect.tryPromise({
            try: () => template.convertLegacyLiteratureNoteTemplates(data),
            catch: templateFailure,
          }),
        convertLegacyTemplateDocuments: (refs) =>
          Effect.tryPromise({
            try: () => template.convertLegacyTemplateDocuments(refs),
            catch: templateFailure,
          }),
      }),
      loadVerificationData: () =>
        Effect.succeed({
          note: { title: "Paper" },
          filename: { citationKey: "doePaper" },
          annotation:
            options && "verificationAnnotation" in options
              ? (options.verificationAnnotation ?? null)
              : options?.ejectedAnnotation
                ? { text: "Excerpt" }
                : null,
          citation: [{ citationKey: "smith2024" }],
        }),
      openPrompt,
    },
    context,
  );
  return {
    create,
    files,
    layoutReady: async () => {
      workspace.layoutReady();
      await service.bridge.runPromise(service.whenSettled);
    },
    openPrompt,
    bridge,
    service,
    settings,
    flushRuns,
    template,
    trashFile,
  };
}

it.effect(
  "#1705: closing a migration fixture scope disables late layout callbacks",
  () =>
    Effect.gen(function* () {
      const context = yield* Effect.context<never>();
      const harness = yield* Effect.scoped(
        Effect.gen(function* () {
          const fixture = yield* Effect.promise(() =>
            makeHarness(undefined, context),
          );
          yield* Effect.acquireDisposable(
            Effect.tryPromise(async () => fixture.service),
          );
          return fixture;
        }),
      );
      yield* Effect.promise(() => harness.layoutReady());
      expect(harness.openPrompt).not.toHaveBeenCalled();
    }),
);

describe("LiteratureNoteTemplateMigrationService", () => {
  it.effect("durably arms the prompt without changing legacy files", () =>
    Effect.gen(function* () {
      const context = yield* Effect.context<never>();
      const harness = yield* Effect.promise(() =>
        makeHarness(undefined, context),
      );
      yield* Effect.acquireDisposable(
        Effect.tryPromise(async () => harness.service),
      );
      const paths = [...harness.files.keys()];

      yield* Effect.promise(() => harness.layoutReady());

      expect(harness.settings.update).toHaveBeenCalledWith({
        "note.template-conversion-pending": true,
      });
      expect(harness.openPrompt).toHaveBeenCalledOnce();
      expect([...harness.files.keys()]).toEqual(paths);
      expect(harness.create).not.toHaveBeenCalled();
      expect(harness.trashFile).not.toHaveBeenCalled();
    }),
  );

  it.effect(
    "arms the prompt for a vault whose only legacy files are 2.1.x documents",
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const harness = yield* Effect.promise(() =>
          makeHarness(
            {
              legacyDocuments: {
                citation: [],
                partials: [
                  {
                    name: "venue",
                    path: "templates/zotlit-venue.liquid.md",
                    language: "liquid",
                    inert: false,
                    shadowed: [],
                  },
                ],
              },
            },
            context,
          ),
        );
        yield* Effect.acquireDisposable(
          Effect.tryPromise(async () => harness.service),
        );

        yield* Effect.promise(() => harness.layoutReady());

        expect(harness.settings.update).toHaveBeenCalledWith({
          "note.template-conversion-pending": true,
        });
        expect(harness.openPrompt).toHaveBeenCalledOnce();
      }),
  );

  it.effect(
    "writes the verified document before persisting and trashing legacy files",
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const harness = yield* Effect.promise(() =>
          makeHarness({ pending: true }, context),
        );
        yield* Effect.acquireDisposable(
          Effect.tryPromise(async () => harness.service),
        );

        const result = yield* Effect.promise(() =>
          harness.service.bridge.runPromise(harness.service.convert),
        );

        expect(result).toEqual({
          outcome: "converted",
          document: "zotlit-profile.default.md",
          trashed: [
            "templates/zotlit-filename.liquid.md",
            "templates/zotlit-note.liquid.md",
            "templates/zotlit-content.liquid.md",
          ],
          pendingCleanup: [],
          kept: [],
        });
        expect(harness.create).toHaveBeenCalledWith(
          "templates/zotlit-profile.default.md",
          "converted source",
          undefined,
        );
        expect(
          harness.bridge.runSync(harness.settings.current)[
            "note.default-profile"
          ],
        ).not.toHaveProperty("document");
        expect(harness.settings.update).toHaveBeenCalledWith({
          "note.template-conversion-pending": false,
        });
        expect(harness.flushRuns).toHaveBeenCalledBefore(harness.trashFile);
        expect(harness.trashFile).toHaveBeenCalledTimes(3);
        expect(harness.files.has("templates/zotlit-profile.default.md")).toBe(
          true,
        );
        expect(
          harness.bridge.runSync(harness.settings.current)[
            "note.template-conversion-result"
          ],
        ).toEqual({
          document: "templates/zotlit-profile.default.md",
          trashed: 3,
          pendingCleanup: [],
        });
        expect(
          harness.flushRuns.mock.invocationCallOrder.at(-1),
        ).toBeGreaterThan(harness.trashFile.mock.invocationCallOrder.at(-1)!);
      }),
  );

  it.effect(
    "finishes a conversion that unload reaches during its document write",
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const harness = yield* Effect.promise(() =>
          makeHarness({ pending: true }, context),
        );
        const write = harness.create.getMockImplementation()!;
        const started = Promise.withResolvers<void>();
        const held = Promise.withResolvers<void>();
        harness.create.mockImplementationOnce(async (path, source) => {
          started.resolve();
          await held.promise;
          return write(path, source);
        });

        // A flush that yields runs past unload's start, as a real save does.
        harness.flushRuns.mockImplementation(() => Effect.yieldNow);

        // Unload stops the waiting caller; the conversion itself finishes.
        const converting = expect(
          harness.service.bridge.runPromise(harness.service.convert),
        ).rejects.toMatchObject({ name: "AbortError" });
        yield* Effect.promise(() => started.promise);
        const unloading = harness.service[Symbol.asyncDispose]();
        held.resolve();
        yield* Effect.promise(() => unloading);
        yield* Effect.promise(() => converting);

        // The document stands, the legacy files are gone, and the result is
        // recorded, so no retry meets a half-done conversion.
        expect(harness.files.has("templates/zotlit-profile.default.md")).toBe(
          true,
        );
        expect(harness.trashFile).toHaveBeenCalledTimes(3);
        expect(
          harness.bridge.runSync(harness.settings.current)[
            "note.template-conversion-result"
          ],
        ).toEqual({
          document: "templates/zotlit-profile.default.md",
          trashed: 3,
          pendingCleanup: [],
        });
        // The settings flush is the conversion's last step; unload waits for it.
        expect(
          harness.flushRuns.mock.invocationCallOrder.at(-1),
        ).toBeGreaterThan(harness.trashFile.mock.invocationCallOrder.at(-1)!);
      }),
  );

  it.effect("records only files actually trashed", () =>
    Effect.gen(function* () {
      const context = yield* Effect.context<never>();
      const harness = yield* Effect.promise(() =>
        makeHarness({ pending: true, ejectedAnnotation: true }, context),
      );
      const service = yield* Effect.acquireDisposable(
        Effect.tryPromise(async () => harness.service),
      );
      harness.files.delete("templates/zotlit-content.liquid.md");
      yield* Effect.promise(() => service.bridge.runPromise(service.convert));
      expect(
        harness.bridge.runSync(harness.settings.current)[
          "note.template-conversion-result"
        ],
      ).toEqual({
        document: "templates/zotlit-profile.default.md",
        trashed: 3,
        pendingCleanup: [],
      });
    }),
  );

  it.effect(
    "keeps the conversion active and records the file when trash fails",
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const failed = yield* Effect.promise(() =>
          makeHarness({ pending: true }, context),
        );
        const service = yield* Effect.acquireDisposable(
          Effect.tryPromise(async () => failed.service),
        );
        failed.trashFile.mockRejectedValueOnce(new Error("Trash unavailable"));

        const result = yield* Effect.promise(() =>
          service.bridge.runPromise(service.convert),
        );

        expect(result).toMatchObject({
          outcome: "converted",
          pendingCleanup: ["templates/zotlit-filename.liquid.md"],
        });
        // The documents stay active and the file that resisted is recorded.
        expect(
          failed.bridge.runSync(failed.settings.current)[
            "note.template-conversion-pending"
          ],
        ).toBe(false);
        expect(failed.files.has("templates/zotlit-profile.default.md")).toBe(
          true,
        );
        expect(failed.files.has("templates/zotlit-filename.liquid.md")).toBe(
          true,
        );
        expect(
          failed.bridge.runSync(failed.settings.current)[
            "note.template-conversion-result"
          ],
        ).toMatchObject({
          document: "templates/zotlit-profile.default.md",
          trashed: 2,
          pendingCleanup: ["templates/zotlit-filename.liquid.md"],
        });
      }),
  );

  it.effect(
    "retries retained files and clears the list once the fault is gone",
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const failed = yield* Effect.promise(() =>
          makeHarness({ pending: true }, context),
        );
        const service = yield* Effect.acquireDisposable(
          Effect.tryPromise(async () => failed.service),
        );
        failed.trashFile.mockRejectedValueOnce(new Error("Trash unavailable"));
        yield* Effect.promise(() => service.bridge.runPromise(service.convert));

        const retried = yield* Effect.promise(() =>
          service.bridge.runPromise(service.retryCleanup),
        );

        expect(retried).toMatchObject({
          outcome: "converted",
          trashed: ["templates/zotlit-filename.liquid.md"],
          pendingCleanup: [],
        });
        expect(failed.files.has("templates/zotlit-filename.liquid.md")).toBe(
          false,
        );
        expect(
          failed.bridge.runSync(failed.settings.current)[
            "note.template-conversion-result"
          ],
        ).toMatchObject({
          document: "templates/zotlit-profile.default.md",
          trashed: 3,
          pendingCleanup: [],
        });
      }),
  );

  it.effect(
    "takes back the documents it created when a later write fails",
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const harness = yield* Effect.promise(() =>
          makeHarness({ pending: true }, context),
        );
        const service = yield* Effect.acquireDisposable(
          Effect.tryPromise(async () => harness.service),
        );
        harness.template.getLegacyTemplateDocuments.mockReturnValue({
          citation: [
            {
              name: "cite",
              path: "templates/zotlit-cite.liquid.md",
              language: "liquid",
              inert: false,
              shadowed: [],
            },
          ],
          partials: [],
        });
        harness.template.convertLegacyTemplateDocuments.mockResolvedValueOnce({
          documents: [
            { path: "templates/zotlit-citation.md", source: "citation source" },
          ],
          trashed: ["templates/zotlit-cite.liquid.md"],
          kept: [],
        });
        let writes = 0;
        harness.create.mockImplementation(
          async (path: string, _source: string) => {
            writes += 1;
            if (writes === 2) throw new Error("Disk full");
            const file = new TFile();
            file.path = path;
            harness.files.set(path, file);
            return file;
          },
        );

        yield* Effect.promise(() =>
          expect(service.bridge.runPromise(service.convert)).rejects.toThrow(
            "Disk full",
          ),
        );

        // Only the document this pass created goes back; every legacy file stays.
        expect(harness.trashFile).toHaveBeenCalledTimes(1);
        expect(harness.files.has("templates/zotlit-profile.default.md")).toBe(
          false,
        );
        expect(harness.files.has("templates/zotlit-note.liquid.md")).toBe(true);
        expect(
          harness.bridge.runSync(harness.settings.current)[
            "note.template-conversion-pending"
          ],
        ).toBe(true);
        expect(
          harness.bridge.runSync(harness.settings.current)[
            "note.template-conversion-result"
          ],
        ).toBeNull();
      }),
  );

  it.effect(
    "does not infer a completed conversion from an existing Default document",
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const harness = yield* Effect.promise(() =>
          makeHarness({ pending: true, defaultDocument: "existing" }, context),
        );
        const _service = yield* Effect.acquireDisposable(
          Effect.tryPromise(async () => harness.service),
        );
        expect(
          harness.bridge.runSync(harness.settings.current)[
            "note.template-conversion-result"
          ],
        ).toBeNull();
        expect(
          harness.bridge.runSync(harness.settings.current)[
            "note.template-conversion-pending"
          ],
        ).toBe(false);
      }),
  );

  it.effect(
    "leaves the vault and settings untouched when parity verification fails",
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const harness = yield* Effect.promise(() =>
          makeHarness({ pending: true }, context),
        );
        yield* Effect.acquireDisposable(
          Effect.tryPromise(async () => harness.service),
        );
        harness.template.convertLegacyLiteratureNoteTemplates.mockRejectedValueOnce(
          new LegacyTemplateConversionError(
            "legacy-render-mismatch",
            "Converted create output differs at byte 10",
            {
              difference: "create output",
              recovery: "Keep the legacy files unchanged.",
            },
          ),
        );
        harness.settings.update.mockClear();

        const result = yield* Effect.promise(() =>
          harness.service.bridge.runPromise(harness.service.convert),
        );

        expect(result).toEqual({
          outcome: "refused",
          diagnostic: {
            code: "legacy-render-mismatch",
            difference: "create output",
            message: "Converted create output differs at byte 10",
            hint: "Keep the legacy files unchanged.",
            files: [
              "templates/zotlit-filename.liquid.md",
              "templates/zotlit-note.liquid.md",
              "templates/zotlit-content.liquid.md",
            ],
          },
        });
        expect(harness.create).not.toHaveBeenCalled();
        expect(harness.trashFile).not.toHaveBeenCalled();
        expect(harness.settings.update).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    "returns affected fields and leaves the vault untouched when the dry run fails",
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const harness = yield* Effect.promise(() =>
          makeHarness({ pending: true }, context),
        );
        yield* Effect.acquireDisposable(
          Effect.tryPromise(async () => harness.service),
        );
        harness.template.convertLegacyLiteratureNoteTemplates.mockRejectedValueOnce(
          new LegacyTemplateConversionError(
            "legacy-frontmatter-evaluation",
            "Converted Managed Frontmatter failed for: tags, creators",
            {
              difference: "Managed Frontmatter evaluation",
              recovery: "Correct these fields, then retry conversion.",
              fields: ["tags", "creators"],
            },
          ),
        );

        const result = yield* Effect.promise(() =>
          harness.service.bridge.runPromise(harness.service.convert),
        );

        expect(result).toEqual({
          outcome: "refused",
          diagnostic: {
            code: "legacy-frontmatter-evaluation",
            difference: "Managed Frontmatter evaluation",
            message: "Converted Managed Frontmatter failed for: tags, creators",
            hint: "Correct these fields, then retry conversion.",
            fields: ["tags", "creators"],
          },
        });
        expect(harness.create).not.toHaveBeenCalled();
        expect(harness.trashFile).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    "trashes an ejected annotation template after the verified document write",
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const harness = yield* Effect.promise(() =>
          makeHarness({ pending: true, ejectedAnnotation: true }, context),
        );
        yield* Effect.acquireDisposable(
          Effect.tryPromise(async () => harness.service),
        );

        const result = yield* Effect.promise(() =>
          harness.service.bridge.runPromise(harness.service.convert),
        );

        expect(result).toMatchObject({
          outcome: "converted",
          trashed: expect.arrayContaining([
            "templates/zotlit-annotation.liquid.md",
          ]),
        });
        expect(
          harness.template.convertLegacyLiteratureNoteTemplates,
        ).toHaveBeenCalledWith({
          note: { title: "Paper" },
          filename: { citationKey: "doePaper" },
          annotation: { text: "Excerpt" },
        });
        expect(harness.flushRuns).toHaveBeenCalledBefore(harness.trashFile);
      }),
  );

  it.effect("names the missing verification annotation and its recovery", () =>
    Effect.gen(function* () {
      const context = yield* Effect.context<never>();
      const harness = yield* Effect.promise(() =>
        makeHarness(
          {
            pending: true,
            ejectedAnnotation: true,
            verificationAnnotation: null,
          },
          context,
        ),
      );
      yield* Effect.acquireDisposable(
        Effect.tryPromise(async () => harness.service),
      );

      const result = yield* Effect.promise(() =>
        harness.service.bridge.runPromise(harness.service.convert),
      );

      expect(result).toEqual({
        outcome: "refused",
        diagnostic: {
          code: "no-verification-annotation",
          message:
            "No Zotero annotation is available for conversion verification",
          hint: "Add an annotation to a Zotero item, then retry conversion.",
        },
      });
      expect(harness.create).not.toHaveBeenCalled();
      expect(harness.trashFile).not.toHaveBeenCalled();
    }),
  );
});

const CITE_LIQUID = "<{{ zt.citations | pandoc_cite }}>\n";
const CITE2_LIQUID =
  "{{ zt.citations | pandoc_cite: 'prefer-author-in-text' }}!\n";
const AUTHORS_LIQUID = "{{ zt.creators | join: ', ' }}\n";
const SUMMARY_LIQUID = "> {{ zt.abstract }}\n";

/**
 * The migration service over a real {@link TemplateService} and a fixture
 * vault, so the pass runs its own byte verification and writes real files.
 */
async function makeVaultHarness(
  files: Record<string, string>,
  options?: { javascriptTemplates?: boolean; storedSettings?: unknown },
  context = Context.empty(),
) {
  const vault = new MockVault();
  for (const [path, content] of Object.entries(files)) {
    vault.addFile(path, content);
  }
  const localStorage = new Map<string, unknown>(
    options?.javascriptTemplates ? [["zotlit-javascript-templates", "1"]] : [],
  );
  const workspace = new MemoryWorkspace();
  const trashFile = vi.fn(async (file: TFile) => {
    vault.deleteFile(file.path);
  });
  const app = stubService<App>("App", {
    vault: stubService<App["vault"]>("Vault", {
      ...eventMethods(vault),
      read: (file) => vault.read(file),
      cachedRead: (file) => vault.cachedRead(file),
      process: (file, fn) => vault.process(file, fn),
      create: (path, data) => vault.create(path, data),
      trash: async (file) => vault.deleteFile(file.path),
      getFileByPath: (path) => vault.getFileByPath(path),
      getFolderByPath: (path) => vault.getFolderByPath(path),
      getAbstractFileByPath: (path) => vault.getAbstractFileByPath(path),
      getRoot: () => vault.getRoot(),
      getMarkdownFiles: () => vault.getMarkdownFiles(),
    }),
    workspace: workspaceOf(
      Object.assign(workspace, { updateOptions: vi.fn() }),
    ),
    fileManager: stubService<App["fileManager"]>("FileManager", {
      trashFile,
    }),
    loadLocalStorage: (key: string) => localStorage.get(key) ?? null,
    saveLocalStorage: (key: string, data: unknown) => {
      if (data === null) localStorage.delete(key);
      else localStorage.set(key, data);
    },
  });
  const plugin = new PluginStub(
    app,
    options?.storedSettings ?? { __VERSION__: 1 },
  );
  const noMigration = (raw: unknown) => raw;
  // Each service is owned from the moment it is constructed, so a startup that
  // fails halfway still disposes what it already built.
  await using stack = new AsyncDisposableStack();
  const settings = stack.use(
    await buildSettings({
      plugin,
      migrateLegacy: noMigration,
      migrateV1: noMigration,
      migrateV2: noMigration,
      migrateV3: noMigration,
      migrateV4: noMigration,
      migrateV5: noMigration,
      migrateV6: noMigration,
      migrateV7: noMigration,
      migrateV8: noMigration,
      migrateV9: noMigration,
    }),
  );
  await settings.bridge.runPromise(settings.loaded);
  const template = stack.use(await buildTemplate({ app, settings }, context));
  const openPrompt = vi.fn();
  const service = stack.use(
    await buildMigration(
      {
        app,
        settings,
        bridge: settings.bridge,
        template,
        loadVerificationData: () =>
          Effect.succeed({
            note: { title: "Paper" },
            filename: { citationKey: "smith2024" },
            annotation: null,
            citation: [{ citationKey: "smith2024" }],
          }),
        openPrompt,
      },
      context,
    ),
  );
  const owned = stack.move();
  return {
    layoutReady: async () => {
      workspace.layoutReady();
      await service.bridge.runPromise(service.whenSettled);
    },
    openPrompt,
    service,
    settings,
    bridge: settings.bridge,
    template,
    vault,
    trashFile,
    storedSettings: () => structuredClone(plugin.data),
    [Symbol.asyncDispose]: () => owned[Symbol.asyncDispose](),
  };
}

describe("one-pass conversion of the 2.1.x cite and partial files", () => {
  beforeEach(() => {});
  afterEach(() => {});

  it.effect(
    "folds cite and cite2 into one Citation Template and renames each partial",
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const harness = yield* Effect.acquireDisposable(
          Effect.tryPromise(() =>
            makeVaultHarness(
              {
                "templates/zotlit-cite.liquid.md": CITE_LIQUID,
                "templates/zotlit-cite2.liquid.md": CITE2_LIQUID,
                "templates/zotlit-authors.liquid.md": AUTHORS_LIQUID,
                "templates/zotlit-summary.liquid.md": SUMMARY_LIQUID,
              },
              undefined,
              context,
            ),
          ),
        );

        const result = yield* Effect.promise(() =>
          harness.service.bridge.runPromise(harness.service.convert),
        );

        expect(result).toEqual({
          outcome: "converted",
          document: null,
          trashed: [
            "templates/zotlit-cite.liquid.md",
            "templates/zotlit-cite2.liquid.md",
            "templates/zotlit-authors.liquid.md",
            "templates/zotlit-summary.liquid.md",
          ],
          pendingCleanup: [],
          kept: [],
        });
        expect(harness.vault.contents.get("templates/zotlit-citation.md")).toBe(
          `---
language: liquid
---
{% if zt.variant == "alt" %}
  {{ zt.citations | pandoc_cite: 'prefer-author-in-text' }}!
{% else %}
  <{{ zt.citations | pandoc_cite }}>
{% endif %}
`,
        );
        expect(
          harness.vault.contents.get("templates/zotlit-partial.authors.md"),
        ).toBe(`---\nlanguage: liquid\n---\n${AUTHORS_LIQUID}`);
        expect(
          harness.vault.contents.get("templates/zotlit-partial.summary.md"),
        ).toBe(`---\nlanguage: liquid\n---\n${SUMMARY_LIQUID}`);
        expect(harness.vault.files.has("templates/zotlit-cite.liquid.md")).toBe(
          false,
        );
        expect(
          harness.vault.files.has("templates/zotlit-authors.liquid.md"),
        ).toBe(false);
      }),
  );

  it.effect(
    "keeps both gestures rendering what their legacy file rendered",
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const harness = yield* Effect.acquireDisposable(
          Effect.tryPromise(() =>
            makeVaultHarness(
              {
                "templates/zotlit-cite.liquid.md": CITE_LIQUID,
                "templates/zotlit-cite2.liquid.md": CITE2_LIQUID,
              },
              undefined,
              context,
            ),
          ),
        );
        const refs = [{ citationKey: "smith2024" }];
        const before = {
          main: harness.template.bridge.runSync(
            harness.template.render(
              "cite",
              citekeysToCiteTemplateData(refs, "main"),
            ),
          ),
          alt: harness.template.bridge.runSync(
            harness.template.render(
              "cite2",
              citekeysToCiteTemplateData(refs, "alt"),
            ),
          ),
        };

        yield* Effect.promise(() =>
          harness.service.bridge.runPromise(harness.service.convert),
        );
        yield* TestClock.adjust(500);

        expect(before).toEqual({
          main: "<[@smith2024]>\n",
          alt: "@smith2024!\n",
        });
        expect(
          harness.template.bridge.runSync(
            harness.template.renderCitation(refs, "main"),
          ),
        ).toBe("<[@smith2024]>");
        expect(
          harness.template.bridge.runSync(
            harness.template.renderCitation(refs, "alt"),
          ),
        ).toBe("@smith2024!");
      }),
  );

  it.effect("carries an Eta partial's language into its manifest", () =>
    Effect.gen(function* () {
      const context = yield* Effect.context<never>();
      const harness = yield* Effect.acquireDisposable(
        Effect.tryPromise(() =>
          makeVaultHarness(
            {
              "templates/zotlit-authors.eta.md":
                "<%= zt.creators.join(', ') %>\n",
            },
            undefined,
            context,
          ),
        ),
      );

      const result = yield* Effect.promise(() =>
        harness.service.bridge.runPromise(harness.service.convert),
      );

      expect(result).toMatchObject({ document: null, kept: [] });
      expect(
        harness.vault.contents.get("templates/zotlit-partial.authors.md"),
      ).toBe("---\nlanguage: eta\n---\n<%= zt.creators.join(', ') %>\n");
    }),
  );

  it.effect(
    "folds a mixed-language pair as Liquid and leaves the Eta file in place",
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const harness = yield* Effect.acquireDisposable(
          Effect.tryPromise(() =>
            makeVaultHarness(
              {
                "templates/zotlit-cite.liquid.md": CITE_LIQUID,
                "templates/zotlit-cite2.eta.md":
                  '<%= pandocCite(zt.citations, "prefer-author-in-text") %>?\n',
              },
              undefined,
              context,
            ),
          ),
        );

        const result = yield* Effect.promise(() =>
          harness.service.bridge.runPromise(harness.service.convert),
        );

        expect(result).toMatchObject({
          outcome: "converted",
          trashed: ["templates/zotlit-cite.liquid.md"],
          kept: ["templates/zotlit-cite2.eta.md"],
        });
        expect(harness.vault.files.has("templates/zotlit-cite2.eta.md")).toBe(
          true,
        );
        expect(harness.vault.contents.get("templates/zotlit-citation.md")).toBe(
          `---
language: liquid
---
{% if zt.variant == "alt" %}
  {{ zt.citations | pandoc_cite: "prefer-author-in-text" }}
{% else %}
  <{{ zt.citations | pandoc_cite }}>
{% endif %}
`,
        );
      }),
  );

  it.effect(
    "refuses a fold whose branch renders a legacy name the pass trashes",
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const harness = yield* Effect.acquireDisposable(
          Effect.tryPromise(() =>
            makeVaultHarness(
              {
                "templates/zotlit-cite.liquid.md": CITE_LIQUID,
                "templates/zotlit-cite2.liquid.md":
                  '{% render "cite" with zt as zt %}!\n',
              },
              undefined,
              context,
            ),
          ),
        );

        const result = yield* Effect.promise(() =>
          harness.service.bridge.runPromise(harness.service.convert),
        );

        expect(result).toMatchObject({
          outcome: "refused",
          diagnostic: { code: "unsupported-legacy-template" },
        });
        expect(harness.vault.files.has("templates/zotlit-citation.md")).toBe(
          false,
        );
      }),
  );

  it.effect(
    "prompts once for a vault holding both note slots and cite files",
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const harness = yield* Effect.acquireDisposable(
          Effect.tryPromise(() =>
            makeVaultHarness(
              {
                "templates/zotlit-note.liquid.md": "# {{ zt.title }}\n",
                "templates/zotlit-cite.liquid.md": CITE_LIQUID,
              },
              undefined,
              context,
            ),
          ),
        );

        yield* Effect.promise(() => harness.layoutReady());

        expect(harness.openPrompt).toHaveBeenCalledOnce();
        expect(
          harness.bridge.runSync(harness.settings.current)?.[
            "note.template-conversion-pending"
          ],
        ).toBe(true);
      }),
  );

  it.effect("prompts for a vault holding only zotlit-cite.liquid.md", () =>
    Effect.gen(function* () {
      const context = yield* Effect.context<never>();
      const harness = yield* Effect.acquireDisposable(
        Effect.tryPromise(() =>
          makeVaultHarness(
            {
              "templates/zotlit-cite.liquid.md": CITE_LIQUID,
            },
            undefined,
            context,
          ),
        ),
      );

      yield* Effect.promise(() => harness.layoutReady());

      expect(harness.openPrompt).toHaveBeenCalledOnce();
    }),
  );

  it.effect("leaves a vault with no legacy file unprompted", () =>
    Effect.gen(function* () {
      const context = yield* Effect.context<never>();
      const harness = yield* Effect.acquireDisposable(
        Effect.tryPromise(() =>
          makeVaultHarness(
            {
              "templates/zotlit-citation.md":
                "{{ zt.citations | pandoc_cite }}\n",
            },
            undefined,
            context,
          ),
        ),
      );

      yield* Effect.promise(() => harness.layoutReady());

      expect(harness.openPrompt).not.toHaveBeenCalled();
      expect(
        yield* Effect.promise(() =>
          harness.service.bridge.runPromise(harness.service.convert),
        ),
      ).toMatchObject({
        outcome: "refused",
        diagnostic: { code: "no-legacy-templates" },
      });
    }),
  );

  it.effect(
    "writes nothing when the Citation Template document already exists",
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const harness = yield* Effect.acquireDisposable(
          Effect.tryPromise(() =>
            makeVaultHarness(
              {
                "templates/zotlit-cite.liquid.md": CITE_LIQUID,
                "templates/zotlit-citation.md":
                  "{{ zt.citations | pandoc_cite }}\n",
              },
              undefined,
              context,
            ),
          ),
        );

        const result = yield* Effect.promise(() =>
          harness.service.bridge.runPromise(harness.service.convert),
        );

        expect(result).toEqual({
          outcome: "refused",
          diagnostic: {
            code: "converted-document-exists",
            message:
              "Converted document already exists at templates/zotlit-citation.md",
            hint: "Rename or remove that document, then retry conversion.",
          },
        });
        expect(harness.vault.files.has("templates/zotlit-cite.liquid.md")).toBe(
          true,
        );
      }),
  );

  it.effect(
    "refuses an Eta citation fold while JavaScript Templates are off",
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const harness = yield* Effect.acquireDisposable(
          Effect.tryPromise(() =>
            makeVaultHarness(
              {
                "templates/zotlit-cite.eta.md":
                  "<%= pandocCite(zt.citations) %>\n",
              },
              undefined,
              context,
            ),
          ),
        );

        const result = yield* Effect.promise(() =>
          harness.service.bridge.runPromise(harness.service.convert),
        );

        expect(result).toMatchObject({
          outcome: "refused",
          diagnostic: { code: "unsupported-legacy-template" },
        });
        expect(harness.vault.files.has("templates/zotlit-citation.md")).toBe(
          false,
        );
        expect(harness.vault.files.has("templates/zotlit-cite.eta.md")).toBe(
          true,
        );
      }),
  );
});

describe("the one-shot conversion aborts before any write", () => {
  it.effect(
    "leaves the vault untouched when a citation variant fails verification",
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const harness = yield* Effect.promise(() =>
          makeHarness(
            {
              pending: true,
              legacyDocuments: {
                citation: [
                  {
                    name: "cite",
                    path: "templates/zotlit-cite.liquid.md",
                    language: "liquid",
                    inert: false,
                    shadowed: [],
                  },
                ],
                partials: [],
              },
            },
            context,
          ),
        );
        yield* Effect.acquireDisposable(
          Effect.tryPromise(async () => harness.service),
        );
        harness.template.convertLegacyTemplateDocuments.mockRejectedValueOnce(
          new LegacyTemplateConversionError(
            "legacy-render-mismatch",
            "Converted alternate citation output differs from the legacy render at byte 4",
            {
              difference: "alternate citation output",
              recovery: "Keep the legacy files unchanged.",
            },
          ),
        );
        harness.settings.update.mockClear();

        const result = yield* Effect.promise(() =>
          harness.service.bridge.runPromise(harness.service.convert),
        );

        expect(result).toEqual({
          outcome: "refused",
          diagnostic: {
            code: "legacy-render-mismatch",
            difference: "alternate citation output",
            message:
              "Converted alternate citation output differs from the legacy render at byte 4",
            hint: "Keep the legacy files unchanged.",
            files: ["templates/zotlit-cite.liquid.md"],
          },
        });
        expect(harness.create).not.toHaveBeenCalled();
        expect(harness.trashFile).not.toHaveBeenCalled();
        expect(harness.settings.update).not.toHaveBeenCalled();
      }),
  );
});

describe("layout-ready legacy conversion detection", () => {
  const original = {
    "templates/zotlit-note.liquid.md":
      '# Late inventory {{ zt.title }}\n{% render "content" with zt as zt %}',
    "templates/zotlit-cite.liquid.md": CITE_LIQUID,
  };

  it.effect(
    "arms the prompt from the layout-ready scan when startup preceded the inventory",
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const harness = yield* Effect.acquireDisposable(
          Effect.tryPromise(() => makeVaultHarness({}, undefined, context)),
        );
        expect(
          harness.bridge.runSync(harness.settings.current)[
            "note.template-conversion-pending"
          ],
        ).toBe(false);
        // Obsidian populates its initial inventory without create events.
        for (const [path, source] of Object.entries(original))
          harness.vault.addFile(path, source);

        yield* Effect.promise(() => harness.layoutReady());

        expect(harness.openPrompt).toHaveBeenCalledOnce();
        expect(
          harness.bridge.runSync(harness.settings.current)[
            "note.template-conversion-pending"
          ],
        ).toBe(true);
        expect(Object.fromEntries(harness.vault.contents)).toEqual(original);
      }),
  );

  it.effect(
    "keeps a postponed conversion postponed when the inventory arrives late after restart",
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const resumed = yield* Effect.acquireDisposable(
          Effect.tryPromise(() =>
            makeVaultHarness(
              {},
              {
                storedSettings: {
                  __VERSION__: 1,
                  "note.template-conversion-pending": true,
                },
              },
              context,
            ),
          ),
        );
        for (const [path, source] of Object.entries(original))
          resumed.vault.addFile(path, source);

        yield* Effect.promise(() => resumed.layoutReady());

        expect(resumed.openPrompt).not.toHaveBeenCalled();
        expect(
          resumed.bridge.runSync(resumed.settings.current)[
            "note.template-conversion-pending"
          ],
        ).toBe(true);
        // The late inventory still renders through the legacy files.
        expect(
          resumed.template.bridge.runSync(
            resumed.template.render(
              "cite",
              citekeysToCiteTemplateData(
                [{ citationKey: "smith2024" }],
                "main",
              ),
            ),
          ),
        ).toBe("<[@smith2024]>\n");
        expect(Object.fromEntries(resumed.vault.contents)).toEqual(original);
      }),
  );
});

describe("repair and retry after a refusal", () => {
  it.effect(
    "names the Literature Note slots a layout refusal needs edited and converts once they are fixed",
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const harness = yield* Effect.acquireDisposable(
          Effect.tryPromise(() =>
            makeVaultHarness(
              {
                "templates/zotlit-note.liquid.md":
                  "# No content {{ zt.title }}\n",
                "templates/zotlit-cite.liquid.md": CITE_LIQUID,
              },
              undefined,
              context,
            ),
          ),
        );

        const refused = yield* Effect.promise(() =>
          harness.service.bridge.runPromise(harness.service.convert),
        );

        expect(refused).toMatchObject({
          outcome: "refused",
          diagnostic: {
            code: "unsupported-legacy-template",
            files: ["templates/zotlit-note.liquid.md"],
          },
        });
        expect(
          harness.vault.files.has("templates/zotlit-profile.default.md"),
        ).toBe(false);

        harness.vault.modifyFile(
          "templates/zotlit-note.liquid.md",
          '# Fixed {{ zt.title }}\n{% render "content" with zt as zt %}',
        );
        yield* TestClock.adjust(500);

        const retried = yield* Effect.promise(() =>
          harness.service.bridge.runPromise(harness.service.convert),
        );

        expect(retried).toMatchObject({
          outcome: "converted",
          pendingCleanup: [],
        });
        expect(
          harness.vault.files.has("templates/zotlit-profile.default.md"),
        ).toBe(true);
        expect(harness.vault.files.has("templates/zotlit-note.liquid.md")).toBe(
          false,
        );
      }),
  );
});

describe("cleanup retry across restart", () => {
  it.effect(
    "records the file trash refused and clears it when a later session retries",
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        let storedSettings: unknown;
        {
          const first = yield* Effect.acquireDisposable(
            Effect.tryPromise(() =>
              makeVaultHarness(
                {
                  "templates/zotlit-cite.liquid.md": CITE_LIQUID,
                  "templates/zotlit-cite2.liquid.md": CITE2_LIQUID,
                },
                undefined,
                context,
              ),
            ),
          );
          first.trashFile.mockRejectedValueOnce(new Error("Trash unavailable"));

          const converted = yield* Effect.promise(() =>
            first.service.bridge.runPromise(first.service.convert),
          );

          expect(converted).toMatchObject({
            outcome: "converted",
            trashed: ["templates/zotlit-cite2.liquid.md"],
            pendingCleanup: ["templates/zotlit-cite.liquid.md"],
          });
          expect(first.vault.files.has("templates/zotlit-citation.md")).toBe(
            true,
          );
          expect(first.vault.files.has("templates/zotlit-cite.liquid.md")).toBe(
            true,
          );
          storedSettings = first.storedSettings();
        }
        const resumed = yield* Effect.acquireDisposable(
          Effect.tryPromise(() =>
            makeVaultHarness(
              { "templates/zotlit-cite.liquid.md": CITE_LIQUID },
              { storedSettings },
              context,
            ),
          ),
        );
        expect(
          resumed.bridge.runSync(resumed.settings.current)[
            "note.template-conversion-result"
          ],
        ).toMatchObject({
          pendingCleanup: ["templates/zotlit-cite.liquid.md"],
        });
        expect(resumed.openPrompt).not.toHaveBeenCalled();

        const retried = yield* Effect.promise(() =>
          resumed.service.bridge.runPromise(resumed.service.retryCleanup),
        );

        expect(retried).toMatchObject({
          trashed: ["templates/zotlit-cite.liquid.md"],
          pendingCleanup: [],
        });
        expect(resumed.vault.files.has("templates/zotlit-cite.liquid.md")).toBe(
          false,
        );
        expect(resumed.storedSettings()).toMatchObject({
          "note.template-conversion-result": { trashed: 2, pendingCleanup: [] },
        });
      }),
  );
});

async function buildMigration(
  options: TemplateMigrationOptions & {
    app: App;
    settings: PluginSettings["Service"];
    bridge: Pick<import("@/lib/effect-bridge").EffectBridge, "runSync">;
    template: Pick<
      Template["Service"],
      | "refresh"
      | "getLegacyLiteratureNoteTemplateFiles"
      | "getLegacyTemplateDocuments"
      | "convertLegacyTemplateDocuments"
      | "convertLegacyLiteratureNoteTemplates"
    >;
  },
  context = Context.empty(),
) {
  await using stack = new AsyncDisposableStack();
  const template = options.template;
  const runtime = buildRuntime(
    layerTemplateMigration(options).pipe(
      Layer.provide(
        layerHost({
          vault: options.app.vault,
          fileManager: options.app.fileManager,
          workspace: options.app.workspace,
        }),
      ),
      Layer.provide(templateSettings(options.settings)),
      Layer.provide(
        Layer.succeed(
          Template,
          stubService<Template["Service"]>("Template", template),
        ),
      ),
      Layer.provideMerge(Layer.succeedContext(context)),
    ),
    stack,
  );
  await runtime.context();
  const service = Object.assign(runtime.runSync(TemplateMigration), {
    bridge: effectBridge(runtime),
  });
  const lifetime = stack.move();
  return Object.assign(service, {
    [Symbol.asyncDispose]: () => lifetime.disposeAsync(),
  });
}
