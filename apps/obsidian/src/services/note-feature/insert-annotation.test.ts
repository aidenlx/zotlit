import { it } from "@effect/vitest";
import { Effect, Fiber, Layer, SubscriptionRef } from "effect";
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { FileSystemAdapter, TFile, TFolder } from "obsidian";
import type { App, FileManager, Vault } from "obsidian";
import { expect, vi } from "vitest";

import type { Annotation } from "@zotlit/db";
import { createClient } from "@zotlit/db/client/node";
import { createFixtureSchema } from "@zotlit/db/test-utils";
import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";
import annotationTemplate from "@zotlit/templates/defaults/annotation.liquid?raw";
import { TemplateFacade } from "@zotlit/templates/facade";

import { stubService } from "@/lib/__fixtures__/service-stub";
import type { AnnotationRecord } from "@/services/annotation-repository/service";
import { availableOutcome } from "@/services/excerpt-image/__fixtures__/outcome";
import { redPng } from "@/services/excerpt-image/__fixtures__/png";
import { PNG_FORMAT } from "@/services/excerpt-image/format";
import { prepareSingleExcerpt } from "@/services/excerpt-image/prepare-single";
import type {
  ExcerptOutcome,
  ExcerptRequest,
} from "@/services/excerpt-image/service";
import { NoteIndex } from "@/services/note-index/service";
import { profileReader } from "@/services/profile/__fixtures__/reader";
import { Profile } from "@/services/profile/service";
import { defaults } from "@/services/settings/schema";
import { PluginSettings } from "@/services/settings/service";
import { Template, templateFailure } from "@/services/template/service";
import { ZoteroPref } from "@/services/zotero-pref/service";
import type { ZoteroPrefSnapshot } from "@/services/zotero-pref/service";
import { ZoteroReads } from "@/services/zotero-reads/service";
import {
  inProcessReadsService,
  sharedClientOpener,
} from "@/services/zotero-reads/test-utils";

import type {
  AnnotationInsertOptions,
  SingleExcerpt,
} from "./insert-annotation";
import { prepareAnnotationInsert } from "./insert-annotation";

vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return { ...fs, open: vi.fn(fs.open) };
});

const card: AnnotationRecord = {
  key: "FDRFQ7C2",
  parentKey: "RGRPDF24",
  type: "image",
  color: "#ffd400",
  comment: null,
  text: null,
  pageLabel: "3",
  sortIndex: "00000|000000|00000",
  tags: ["api-tag"],
  version: 9,
  lock: null,
  position: { kind: "pdf-rects", pageIndex: 2, rects: [[1, 2, 30, 40]] },
};

/** The link Zotero itself writes for {@link card}: attachment, key, page label. */
const DURABLE_LINK =
  "zotero://open/library/items/RGRPDF24?annotation=FDRFQ7C2&page=3";

const zoteroPrefAt = (dataDir: string) =>
  stubService<ZoteroPrefSnapshot>("ZoteroPrefSnapshot", {
    dataDir,
    baseAttachmentPath: null,
  });

async function openFixture(mode: string) {
  const parent = join(
    await getWorkspaceRoot(import.meta.dirname),
    ".scratch/insert-tests",
  );
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(`${parent}/vault-`);
  const client = createClient(":memory:");
  createFixtureSchema(client.$client);
  client.$client.exec(`
    insert into libraries (libraryID, type) values (1, 'user');
    insert into settings (setting,key,value) values ('localAPI','serverID','SERVER000001');
    insert into items (itemID,itemTypeID,dateAdded,dateModified,libraryID,key) values
      (1,1,'2025-01-01 00:00:00','2025-01-01 00:00:00',1,'RUGIER24'),
      (2,2,'2025-01-01 00:00:00','2025-01-01 00:00:00',1,'RGRPDF24');
    insert into itemAttachments (itemID,parentItemID,linkMode,contentType,path) values (2,1,0,'application/pdf','storage:paper.pdf');
  `);
  const zoteroReads = inProcessReadsService(sharedClientOpener(client));
  const settings = {
    ...defaults,
    "attachment.import": mode !== "disabled",
    "attachment.folder-path": "Images",
  };
  const registered = new Map<string, TFile>();
  const app = stubService<App>("App", {
    vault: stubService<Vault>("Vault", {
      adapter: Object.assign(Object.create(FileSystemAdapter.prototype), {
        getFullPath: (path: string) => join(root, path),
        reconcileInternalFile: async (path: string) => {
          if (
            await readFile(join(root, path)).then(
              () => true,
              () => false,
            )
          )
            registered.set(path, Object.assign(new TFile(), { path }));
          else registered.delete(path);
        },
      }),
      getAbstractFileByPath: () => null,
      getFileByPath: (path: string) => registered.get(path) ?? null,
      createFolder: async (path: string) => {
        await mkdir(join(root, path), { recursive: true });
        return Object.assign(new TFolder(), { path });
      },
    }),
    fileManager: stubService<FileManager>("FileManager", {
      generateMarkdownLink: (file: { path: string }) => `[[${file.path}]]`,
    }),
  });
  const resolver = {
    resolve: vi.fn(
      async (_request: ExcerptRequest): Promise<ExcerptOutcome> => {
        if (mode === "throw") throw new Error("renderer failed");
        if (mode === "unavailable") return { kind: "unavailable" };
        return availableOutcome({
          bytes: redPng,
          format: PNG_FORMAT,
          provenance: mode === "fallback" ? "zotero" : "rendered",
          freshness: "checked",
        });
      },
    ),
  };
  const facade = new TemplateFacade();
  const render = vi.fn((data: object) =>
    facade.render("annotation", data, {
      source: annotationTemplate,
      language: "liquid",
    }),
  );
  const reader = profileReader(settings);
  const zoteroPref = Effect.runSync(
    SubscriptionRef.make(zoteroPrefAt("/zotero")),
  );
  const layer = Layer.mergeAll(
    Layer.mock(ZoteroReads, {
      reads: zoteroReads.reads,
      snapshot: zoteroReads.snapshot,
    }),
    Layer.mock(ZoteroPref, {
      current: SubscriptionRef.get(zoteroPref),
      changes: SubscriptionRef.changes(zoteroPref),
    }),
    Layer.mock(PluginSettings, { current: Effect.succeed(settings) }),
    Layer.mock(Profile, {
      profileOf: (file) => Effect.sync(() => reader.profileOf(file)),
    }),
    Layer.mock(NoteIndex, { getNotesByItemKey: () => Effect.succeed([]) }),
    Layer.mock(Template, {
      renderProfileAnnotation: (data) =>
        Effect.try({ try: () => render(data), catch: templateFailure }),
      renderCitation: () => Effect.succeed(""),
    }),
  );
  let valid = true;
  const options: AnnotationInsertOptions = {
    annotation: card,
    source: { kind: "zotero-local-api", serverID: "SERVER000001" },
    sourceScope: "/zotero",
    notePath: "Target.md",
    valid: () => valid,
  };
  if (mode === "write-failure")
    await writeFile(join(root, "Images"), "occupied");
  return {
    root,
    app,
    options,
    resolver,
    render,
    zoteroPref,
    /** The insert under test, over this fixture's services. */
    insert: (
      singleExcerpt: SingleExcerpt = (excerpt) =>
        prepareSingleExcerpt({ ...excerpt, app, resolver }),
    ) =>
      prepareAnnotationInsert(singleExcerpt, options).pipe(
        Effect.provide(layer),
      ),
    invalidate: () => {
      valid = false;
    },
    async close() {
      await zoteroReads[Symbol.asyncDispose]();
      client.$client.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

/** The test's fixture, closed with its scope. */
const fixture = (mode: string) =>
  Effect.acquireRelease(
    Effect.promise(() => openFixture(mode)),
    (f) => Effect.promise(() => f.close()),
  );

const read = <A>(evaluate: () => Promise<A>) =>
  Effect.promise(() => evaluate());

it.effect.each([
  ["success", 0],
  ["fallback", 1],
] as const)(
  "renders the API-ahead card once after preparation and embeds the saved excerpt (%s)",
  ([mode, zotero]) =>
    Effect.gen(function* () {
      const f = yield* fixture(mode);
      const result = yield* f.insert();
      expect(f.render).toHaveBeenCalledTimes(1);
      const names = yield* read(() => readdir(join(f.root, "Images")));
      expect(names).toHaveLength(1);
      expect(result?.text).toContain(`![[Images/${names[0]}]]`);
      expect(result?.text).toContain(`Page [3](${DURABLE_LINK})`);
      expect(result?.text).not.toContain("file://");
      expect(
        yield* read(() => readFile(join(f.root, "Images", names[0]!))),
      ).toEqual(redPng);
      expect(result?.summary).toEqual({ zotero, unchecked: 0, unavailable: 0 });
      expect(
        f.resolver.resolve.mock.calls.map(([request]) => request.annotation),
      ).toEqual([card]);
    }).pipe(Effect.scoped),
);

it.effect.each([
  ["disabled", []],
  ["unavailable", [card]],
  ["throw", [card]],
  ["write-failure", [card]],
] as const)(
  "renders the API-ahead card once after preparation and leaves the excerpt unavailable (%s)",
  ([mode, resolved]) =>
    Effect.gen(function* () {
      const f = yield* fixture(mode);
      const result = yield* f.insert();
      expect(f.render).toHaveBeenCalledTimes(1);
      // Both the page label and the unavailable excerpt's source link name the
      // Annotation durably; nothing in the note is a path on this computer.
      expect(result?.text).toContain(`Page [3](${DURABLE_LINK})`);
      expect(result?.text).toContain(`[Zotero](${DURABLE_LINK})`);
      expect(result?.text).not.toContain("file://");
      expect(result?.text).not.toContain("![[");
      expect(result?.summary.unavailable).toBe(1);
      expect(
        f.resolver.resolve.mock.calls.map(([request]) => request.annotation),
      ).toEqual(resolved);
    }).pipe(Effect.scoped),
);

it.effect("cancels between resolution and materialization", () =>
  Effect.gen(function* () {
    const f = yield* fixture("success");
    f.resolver.resolve.mockImplementation(async () => {
      f.invalidate();
      return availableOutcome({
        bytes: new Uint8Array([1]),
        format: PNG_FORMAT,
        provenance: "rendered",
        freshness: "checked",
      });
    });
    expect(yield* f.insert()).toBeNull();
    expect(yield* read(() => readdir(f.root))).toEqual([]);
    expect(f.render).not.toHaveBeenCalled();
  }).pipe(Effect.scoped),
);

it.effect(
  "cancels when the Zotero data directory moves between resolution and materialization",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture("success");
      const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
      f.resolver.resolve.mockImplementation(async () => {
        await runPromise(
          SubscriptionRef.set(f.zoteroPref, zoteroPrefAt("/moved")),
        );
        return availableOutcome({
          bytes: new Uint8Array([1]),
          format: PNG_FORMAT,
          provenance: "rendered",
          freshness: "checked",
        });
      });
      expect(yield* f.insert()).toBeNull();
      expect(yield* read(() => readdir(f.root))).toEqual([]);
      expect(f.render).not.toHaveBeenCalled();
    }).pipe(Effect.scoped),
);

it.effect(
  "preserves text-only insertion without resolving or writing an image",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture("success");
      f.options.annotation = {
        ...card,
        type: "highlight",
        text: "Captured text from the card",
      };
      const result = yield* f.insert();
      expect(result?.text).toContain("Captured text from the card");
      expect(f.render).toHaveBeenCalledTimes(1);
      expect(f.resolver.resolve).not.toHaveBeenCalled();
      expect(yield* read(() => readdir(f.root))).toEqual([]);
    }).pipe(Effect.scoped),
);

it.effect(
  "preserves manual and automatic tags in the actual annotation template",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture("disabled");
      f.options.annotation = {
        ...card,
        tags: ["review", "imported"],
        templateMetadata: {
          dateAdded: null,
          dateModified: null,
          authorName: null,
          isExternal: null,
          tags: [
            { name: "review", type: "manual" },
            { name: "imported", type: "auto" },
          ],
        },
      };
      const facade = new TemplateFacade();
      f.render.mockImplementation((data) =>
        facade.render("annotation", data, {
          source:
            "{% for tag in zt.tags %}{{ tag.name }}={{ tag.type }};{% endfor %}",
          language: "liquid",
        }),
      );
      expect((yield* f.insert())?.text).toBe("review=manual;imported=auto;");
    }).pipe(Effect.scoped),
);

it.effect.each(["interrupt", "target"])(
  "cancels during the temporary write (%s)",
  (mode) =>
    Effect.gen(function* () {
      const f = yield* fixture("success");
      const started = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const fs = yield* read(() =>
        vi.importActual<typeof import("node:fs/promises")>("node:fs/promises"),
      );
      vi.mocked(open).mockImplementationOnce(async (...args) => {
        const file = await fs.open(...args);
        const write = file.writeFile.bind(file);
        vi.spyOn(file, "writeFile").mockImplementationOnce(
          async (...writeArgs) => {
            await write(...writeArgs);
            started.resolve();
            await release.promise;
          },
        );
        return file;
      });
      // An interrupt does not wait for the legacy port: the test waits for it
      // to clean up its temporary file.
      let preparation: Promise<unknown> = Promise.resolve();
      const pending = yield* f
        .insert((excerpt) => {
          const prepared = prepareSingleExcerpt({
            ...excerpt,
            app: f.app,
            resolver: f.resolver,
          });
          preparation = prepared.catch(() => undefined);
          return prepared;
        })
        .pipe(Effect.forkChild({ startImmediately: true }));
      yield* read(() => started.promise).pipe(
        Effect.andThen(
          read(() => readdir(join(f.root, "Images"))).pipe(
            Effect.map((names) => names.every((name) => name.endsWith(".tmp"))),
          ),
        ),
        Effect.tap((temporary) =>
          Effect.sync(() => expect(temporary).toBe(true)),
        ),
        Effect.andThen(
          mode === "interrupt"
            ? Fiber.interrupt(pending)
            : Effect.sync(() => f.invalidate()),
        ),
        Effect.ensuring(Effect.sync(() => release.resolve())),
      );
      if (mode === "target") expect(yield* Fiber.join(pending)).toBeNull();
      yield* read(() => preparation);
      expect(yield* read(() => readdir(join(f.root, "Images")))).toEqual([]);
      expect(f.render).not.toHaveBeenCalled();
    }).pipe(Effect.scoped),
);

it.effect.each([false, true])(
  "cancels during registration and preserves pre-existing assets (%s)",
  (existing) =>
    Effect.gen(function* () {
      const f = yield* fixture("success");
      if (existing) yield* f.insert();
      f.render.mockClear();
      const reconcile = f.app.vault.adapter as FileSystemAdapter;
      const register = reconcile.reconcileInternalFile.bind(reconcile);
      vi.spyOn(reconcile, "reconcileInternalFile").mockImplementationOnce(
        async (path) => {
          await register(path);
          f.invalidate();
        },
      );
      expect(yield* f.insert()).toBeNull();
      expect(yield* read(() => readdir(join(f.root, "Images")))).toHaveLength(
        existing ? 1 : 0,
      );
      expect(f.render).not.toHaveBeenCalled();
    }).pipe(Effect.scoped),
);

it.effect(
  "reads truthful metadata and reports a missing required fact only on access",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture("disabled");
      f.render.mockImplementation((data) =>
        String(
          (data as { dateModified: Annotation["dateModified"] }).dateModified,
        ),
      );
      const missing = yield* Effect.flip(f.insert());
      expect(missing.message).toBe(
        "Annotation source did not supply dateModified",
      );
      f.options.annotation = {
        ...card,
        templateMetadata: {
          dateAdded: "2025-01-01T00:00:00Z",
          dateModified: "2026-09-20T01:02:03Z",
          authorName: "Known author",
          isExternal: true,
        },
      };
      expect((yield* f.insert())?.text).toBe("2026-09-20T01:02:03Z");
    }).pipe(Effect.scoped),
);

it.effect("fails with the preparation's rejection, its message kept", () =>
  Effect.gen(function* () {
    const f = yield* fixture("success");
    const failure = yield* Effect.flip(
      f.insert(() => Promise.reject(new Error("disk full"))),
    );
    expect(failure).toMatchObject({
      _tag: "LegacyPortError",
      step: "single-excerpt",
      message: "disk full",
    });
    expect(f.render).not.toHaveBeenCalled();
  }).pipe(Effect.scoped),
);
