import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { it } from "@effect/vitest";
import { Effect, FileSystem, Fiber, Layer, SubscriptionRef } from "effect";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { FileSystemAdapter } from "obsidian";
import type { TFile } from "obsidian";
import { expect, vi } from "vitest";

import type { Annotation } from "@zotlit/db";
import { createClient } from "@zotlit/db/client/node";
import { createFixtureSchema } from "@zotlit/db/test-utils";
import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";
import annotationTemplate from "@zotlit/templates/defaults/annotation.liquid?raw";
import { TemplateFacade } from "@zotlit/templates/facade";

import { layerHost } from "@/lib/__fixtures__/obsidian-host-app";
import { MemoryVault } from "@/lib/__fixtures__/obsidian-vault";
import { stubService } from "@/lib/__fixtures__/service-stub";
import type { FileManagerSource } from "@/lib/obsidian-file-manager";
import type { AnnotationRecord } from "@/services/annotation-repository/service";
import { availableOutcome } from "@/services/excerpt-image/__fixtures__/outcome";
import { redPng } from "@/services/excerpt-image/__fixtures__/png";
import { PNG_FORMAT } from "@/services/excerpt-image/format";
import { ExcerptImages } from "@/services/excerpt-image/layer";
import { layerExcerptPreparation } from "@/services/excerpt-image/prepare";
import type {
  ExcerptOutcome,
  ExcerptRequest,
} from "@/services/excerpt-image/service";
import { NoteIndex } from "@/services/note-index/service";
import { profileReader } from "@/services/profile/__fixtures__/reader";
import { Profile, ProfileOperationError } from "@/services/profile/service";
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

import type { AnnotationInsertOptions } from "./insert-annotation";
import { prepareAnnotationInsert } from "./insert-annotation";

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

/**
 * The Node file system, except that the next temporary write, once armed,
 * waits for the test after it writes its bytes.
 */
function pausingFileSystem() {
  let pause: Effect.Effect<void> | undefined;
  const layer = Layer.effect(
    FileSystem.FileSystem,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      return FileSystem.FileSystem.of({
        ...fs,
        open: (path, options) =>
          Effect.map(fs.open(path, options), (file) => {
            const paused = pause;
            if (!paused || !path.endsWith(".tmp")) return file;
            pause = undefined;
            return {
              ...file,
              writeAll: (bytes: Uint8Array) =>
                Effect.andThen(file.writeAll(bytes), paused),
            };
          }),
      });
    }),
  ).pipe(Layer.provide(NodeFileSystem.layer));
  return {
    layer,
    arm: (paused: Effect.Effect<void>) => {
      pause = paused;
    },
  };
}

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
  const vault = new MemoryVault();
  const adapter = Object.assign(Object.create(FileSystemAdapter.prototype), {
    getFullPath: (path: string) => join(root, path),
    reconcileInternalFile: async (path: string) => {
      if (
        await readFile(join(root, path)).then(
          () => true,
          () => false,
        )
      )
        vault.add(path);
      else vault.remove(path);
    },
  }) as FileSystemAdapter;
  Object.assign(vault, { adapter });
  const fileManager = stubService<FileManagerSource>("FileManagerSource", {
    generateMarkdownLink: (file: TFile) => `[[${file.path}]]`,
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
  let profileFailure: ProfileOperationError | null = null;
  const zoteroPref = Effect.runSync(
    SubscriptionRef.make(zoteroPrefAt("/zotero")),
  );
  const pref = Layer.mock(ZoteroPref, {
    current: SubscriptionRef.get(zoteroPref),
    changes: SubscriptionRef.changes(zoteroPref),
  });
  const fileSystem = pausingFileSystem();
  const excerpts = layerExcerptPreparation.pipe(
    Layer.provide(
      Layer.mergeAll(
        layerHost({ vault, fileManager }),
        fileSystem.layer,
        pref,
        Layer.succeed(
          ExcerptImages,
          stubService<ExcerptImages["Service"]>("ExcerptImages", {
            resolve: (request) => resolver.resolve(request),
          }),
        ),
      ),
    ),
  );
  const layer = Layer.mergeAll(
    excerpts,
    Layer.mock(ZoteroReads, {
      reads: zoteroReads.reads,
      snapshot: zoteroReads.snapshot,
    }),
    pref,
    Layer.mock(PluginSettings, { current: Effect.succeed(settings) }),
    Layer.mock(Profile, {
      profileOf: (file) =>
        profileFailure
          ? Effect.fail(profileFailure)
          : Effect.sync(() => reader.profileOf(file)),
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
    adapter,
    options,
    resolver,
    render,
    zoteroPref,
    /** Pause the next temporary write after its bytes, on `paused`. */
    pauseTemporaryWrite: fileSystem.arm,
    /** The insert under test, over this fixture's services. */
    insert: () => prepareAnnotationInsert(options).pipe(Effect.provide(layer)),
    failProfile: (failure: ProfileOperationError) => {
      profileFailure = failure;
    },
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
      // The resolver stands in for a legacy Promise port, so it runs the
      // Effect that moves the data directory on the test's context.
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
      f.pauseTemporaryWrite(
        Effect.sync(() => started.resolve()).pipe(
          Effect.andThen(Effect.promise(() => release.promise)),
        ),
      );
      const pending = yield* f
        .insert()
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
      const register = f.adapter.reconcileInternalFile.bind(f.adapter);
      vi.spyOn(f.adapter, "reconcileInternalFile").mockImplementationOnce(
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

it.effect(
  "fails with the Profile store's typed error when it cannot read the note's Profile",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture("disabled");
      const failure = new ProfileOperationError({
        message: "The Profile registry is not readable",
        cause: new Error("The Profile registry is not readable"),
      });
      f.failProfile(failure);
      expect(yield* Effect.flip(f.insert())).toBe(failure);
      expect(f.render).not.toHaveBeenCalled();
    }).pipe(Effect.scoped),
);
