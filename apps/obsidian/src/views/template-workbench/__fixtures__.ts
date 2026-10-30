// Test host translating the old boundary fixtures to Effect service fakes.
import { Context, Effect, Layer, Stream } from "effect";
import type { App } from "obsidian";
import { onTestFinished } from "vitest";

import type { WorkbenchHost } from "@zotlit/workbench/ui";

import { testNotifier } from "@/lib/__fixtures__/notifier";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { layerUnreadViewServices } from "@/lib/__fixtures__/view-atoms";
import { buildRuntime } from "@/lib/effect-layer";
import type { SubscriptionRuntime } from "@/lib/effect-stream";
import { Notifier } from "@/lib/notifier";
import type { MetadataEvent } from "@/lib/obsidian-metadata-cache";
import { MetadataCache } from "@/lib/obsidian-metadata-cache";
import { Vault } from "@/lib/obsidian-vault";
import { Workspace } from "@/lib/obsidian-workspace";
import { vaultError } from "@/lib/vault-errors";
import type { ViewServices } from "@/lib/view-atoms";
import { makeViewRegistry } from "@/lib/view-atoms";
import { ItemLookup } from "@/services/item-lookup/service";
import type { SearchOptions } from "@/services/item-lookup/service";
import type { QueryHandle } from "@/services/item-query/handle";
import { QueryService } from "@/services/item-query/service";
import { Customize } from "@/services/local-bridge/customize";
import { NoteWriteAborted } from "@/services/note-feature/errors";
import type { NoteFeatureHandle } from "@/services/note-feature/operations";
import { NoteFeature } from "@/services/note-feature/service";
import { Profile } from "@/services/profile/service";
import { defaults } from "@/services/settings/schema";
import { PluginSettings } from "@/services/settings/service";
import type { TemplateDataDeps } from "@/services/template-workbench/data";
import type { TemplateOperations } from "@/services/template/service";
import { Template } from "@/services/template/service";
import type { ZoteroPrefSnapshot } from "@/services/zotero-pref/service";
import { ZoteroPref } from "@/services/zotero-pref/service";
import { ZoteroReads } from "@/services/zotero-reads/service";
import type {
  ZoteroReadLease,
  ZoteroReadsState,
} from "@/services/zotero-reads/service";
import type { NativeRenderDeps } from "@/views/note-preview/render";
import type { ExplorerViewDeps } from "@/views/template-data-explorer/view";

import type { WorkbenchActionServices } from "./actions";
import type { TemplateWorkbenchDeps } from "./view";
type TemplateFixture = TemplateOperations & {
  readonly "compile-status-changed": Stream.Stream<void>;
};
type ZoteroReadsFixture = {
  state: ZoteroReadsState["state"];
  reads: ZoteroReads["Service"]["reads"];
  acquireRead(): Promise<ZoteroReadLease>;
  changed: Stream.Stream<void>;
  degraded: Stream.Stream<unknown>;
  "refresh-failed": Stream.Stream<unknown>;
  refreshing: Stream.Stream<boolean>;
  "db-file-missing": Stream.Stream<void>;
  "refresh-requested": Stream.Stream<void>;
};

export type WorkbenchHostDeps = Omit<
  ExplorerViewDeps,
  "pluginVersion" | "registry"
> &
  TemplateDataDeps & {
    services?: {
      template?: Template["Service"];
      profile?: Profile["Service"];
      zoteroReads?: ZoteroReads["Service"];
    };
    app?: App;
    runtime: SubscriptionRuntime;
    zoteroReads: Pick<
      ZoteroReadsFixture,
      | "state"
      | "reads"
      | "changed"
      | "degraded"
      | "refresh-failed"
      | "refreshing"
      | "db-file-missing"
      | "refresh-requested"
      | "acquireRead"
    >;
  } & {
    zoteroPref: Pick<ZoteroPrefSnapshot, "dataDir">;
    noteFeature?: Pick<NoteFeatureHandle, "updateNote">;
    /**
     * ZotLit Query, which tests the Match of a Profile on a real Item and names
     * the custom fields a condition reads.
     */
    query?: Pick<QueryHandle, "run" | "customFieldNames">;
    render?: WorkbenchHost["render"];
    nativePreview?: NativeRenderDeps;
    pluginVersion?: string;
    templates: Pick<TemplateFixture, "javascriptTemplatesEnabled"> &
      Pick<
        TemplateFixture,
        | "waitUntilSettled"
        | "loaded"
        | "compile-status-changed"
        | "materializeCitationTemplate"
        | "getPartialDocument"
        | "getPartialDocuments"
        | "getPartialNames"
        | "createPartial"
        | "planPartialUnpack"
        | "unpackPartials"
      >;
    profile?: Pick<
      Profile["Service"],
      | "profiles"
      | "getSource"
      | "profileOf"
      | "getBuiltInSource"
      | "materializeDefault"
      | "restoreDefault"
      | "defaultDocumentPath"
    >;
  };

/**
 * The services a Workbench launch runs with: `notifier`, and a vault, a
 * workspace, the Customize flow and the Profile service whose members each
 * test supplies when its launch reads them.
 */
export function workbenchActionContext(
  notifier: Notifier["Service"] = testNotifier().service,
  services: {
    vault?: Partial<Vault["Service"]>;
    workspace?: Partial<Workspace["Service"]>;
    customize?: Partial<Customize["Service"]>;
    profile?: Partial<Profile["Service"]>;
  } = {},
): Context.Context<WorkbenchActionServices> {
  return Context.make(Notifier, notifier).pipe(
    Context.add(
      Vault,
      stubService<Vault["Service"]>("Vault", services.vault ?? {}),
    ),
    Context.add(
      Workspace,
      stubService<Workspace["Service"]>("Workspace", services.workspace ?? {}),
    ),
    Context.add(
      Customize,
      stubService<Customize["Service"]>("Customize", services.customize ?? {}),
    ),
    Context.add(
      Profile,
      stubService<Profile["Service"]>("Profile", services.profile ?? {}),
    ),
  );
}

export function makeWorkbenchHost(
  input: Partial<WorkbenchHostDeps> = {},
  options: { metadata?: Stream.Stream<MetadataEvent> } = {},
) {
  const deps = stubService<WorkbenchHostDeps>("WorkbenchHostDeps", {
    settings: { current: Effect.succeed(defaults), changes: Stream.empty },
    app: undefined,
    services: undefined,
    profile: undefined,
    noteFeature: undefined,
    nativePreview: undefined,
    render: undefined,
    pluginVersion: undefined,
    query: undefined,
    itemLookup: stubService<WorkbenchHostDeps["itemLookup"]>("ItemLookup", {}),
    bridge: stubService<WorkbenchHostDeps["bridge"]>("EffectBridge", {}),
    zoteroPref: { dataDir: "/Zotero" },
    zoteroReads: stubService<WorkbenchHostDeps["zoteroReads"]>("ZoteroReads", {
      state: "ready",
    }),
    templates: stubService<WorkbenchHostDeps["templates"]>("Template", {
      loaded: true,
      javascriptTemplatesEnabled: false,
      getPartialNames: () => [],
      getPartialDocuments: () => [],
      "compile-status-changed": Stream.empty,
    }),
    ...input,
  });
  const template = stubService<Template["Service"]>("Template", {
    javascriptTemplatesEnabled: Effect.sync(
      () => deps.templates.javascriptTemplatesEnabled,
    ),
    status: Effect.sync(() => ({
      state: deps.templates.loaded ? "loaded" : "loading",
      compileErrors: new Map(),
    })),
    changes: Stream.suspend(() =>
      Stream.make({
        state: deps.templates.loaded ? "loaded" : "loading",
        compileErrors: new Map(),
      }),
    ),
    compileEvents: Stream.suspend(() =>
      "compile-status-changed" in deps.templates
        ? deps.templates["compile-status-changed"]
        : Stream.empty,
    ),
    getPartialNames: Effect.sync(() => deps.templates.getPartialNames()),
    getPartialDocuments: Effect.sync(() =>
      deps.templates.getPartialDocuments(),
    ),
    getPartialDocument: (name) =>
      Effect.sync(() => deps.templates.getPartialDocument(name)),
    waitUntilSettled: (timeout) =>
      Effect.promise((signal) => {
        signal.throwIfAborted();
        return deps.templates.waitUntilSettled(timeout);
      }),
    materializeCitationTemplate: Effect.promise((signal) => {
      signal.throwIfAborted();
      return deps.templates.materializeCitationTemplate();
    }),
    planPartialUnpack: (bundled) =>
      Effect.sync(() => deps.templates.planPartialUnpack(bundled)),
    unpackPartials: (plan) =>
      Effect.promise((signal) => {
        signal.throwIfAborted();
        return deps.templates.unpackPartials(plan);
      }),
    createPartial: (name, options) =>
      Effect.promise((signal) => {
        signal.throwIfAborted();
        return deps.templates.createPartial(name, options);
      }),
  });
  const profileState = Effect.gen(function* () {
    return {
      loaded: true,
      profiles:
        deps.profile && "profiles" in deps.profile
          ? yield* deps.profile.profiles
          : [],
      diagnostics: [],
      defaultDocumentPath:
        deps.profile && "defaultDocumentPath" in deps.profile
          ? yield* deps.profile.defaultDocumentPath
          : "templates/zotlit-profile.default.md",
      templateStatus: { state: "loaded" as const, compileErrors: new Map() },
    };
  });
  const profile = stubService<Profile["Service"]>("Profile", {
    state: profileState,
    changes: Stream.fromEffect(profileState),
    profileOf: (file) => Effect.suspend(() => deps.profile!.profileOf(file)),
    getBuiltInSource: Effect.suspend(() => deps.profile!.getBuiltInSource),
    getSource: (selector) =>
      Effect.suspend(() => deps.profile!.getSource(selector)),
    materializeDefault: Effect.suspend(() => deps.profile!.materializeDefault),
    restoreDefault: Effect.suspend(() => deps.profile!.restoreDefault),
  });
  const dbState = () => ({
    state: deps.zoteroReads.state,
    error: null,
    moved: false,
    dbFileMissing: false,
    activeReadMode: null,
  });
  const context = Context.make(
    PluginSettings,
    stubService<PluginSettings["Service"]>("PluginSettings", {
      current: deps.settings?.current ?? Effect.succeed(defaults),
      changes: Stream.concat(
        Stream.fromEffect(deps.settings?.current ?? Effect.succeed(defaults)),
        "changes" in deps.settings ? deps.settings.changes : Stream.empty,
      ),
    }),
  ).pipe(
    Context.add(Template, deps.services?.template ?? template),
    Context.add(Notifier, testNotifier().service),
    // The Item search over the test's lookup handle.
    Context.add(
      ItemLookup,
      stubService<ItemLookup["Service"]>("ItemLookup", {
        search: (query, opts) =>
          Effect.promise(() => deps.itemLookup.search(query, opts)),
        openSession: Effect.map(
          Effect.acquireDisposable(
            Effect.sync(() => deps.itemLookup.openSession()),
          ),
          (session) => ({
            search: (query: string, opts?: SearchOptions) =>
              Effect.promise(() => session.search(query, opts)),
          }),
        ),
      }),
    ),
    Context.add(Profile, deps.services?.profile ?? profile),
    Context.add(
      ZoteroReads,
      deps.services?.zoteroReads ??
        stubService<ZoteroReads["Service"]>("ZoteroReads", {
          current: Effect.sync(dbState),
          changes: Stream.suspend(() => Stream.make(dbState())),
          events: Stream.suspend(() =>
            Stream.map(
              "changed" in deps.zoteroReads
                ? deps.zoteroReads.changed
                : Stream.empty,
              () => ({ _tag: "changed" as const }),
            ),
          ),
          reads: stubService<ZoteroReads["Service"]["reads"]>(
            "ZoteroReadsApi",
            {
              ItemsByIndexedKeys: (request) =>
                deps.zoteroReads.reads.ItemsByIndexedKeys(request),
            },
          ),
          snapshot: Effect.map(
            Effect.acquireDisposable(
              Effect.promise((signal) => {
                signal.throwIfAborted();
                return deps.zoteroReads.acquireRead();
              }),
            ),
            (lease) => lease.reads,
          ),
        }),
    ),
    Context.add(
      ZoteroPref,
      stubService<ZoteroPref["Service"]>("ZoteroPref", {
        current: Effect.sync(() =>
          stubService<
            import("@/services/zotero-pref/service").ZoteroPrefSnapshot
          >("ZoteroPrefSnapshot", { dataDir: deps.zoteroPref.dataDir }),
        ),
      }),
    ),
    Context.add(
      QueryService,
      stubService<QueryService["Service"]>("QueryService", {
        run: (request) =>
          Effect.promise((signal) => deps.query!.run(request, signal)),
        customFieldNames: Effect.promise(
          (signal) =>
            deps.query?.customFieldNames(signal) ?? Promise.resolve([]),
        ),
      }),
    ),
    Context.add(
      MetadataCache,
      stubService<MetadataCache["Service"]>("MetadataCache", {
        changes: options.metadata ?? Stream.empty,
      }),
    ),
    Context.add(
      Vault,
      stubService<Vault["Service"]>("Vault", {
        getFileByPath: (path) =>
          Effect.sync(() => deps.app!.vault.getFileByPath(path)),
        read: (file) =>
          Effect.tryPromise({
            try: () => deps.app!.vault.read(file),
            catch: vaultError("read", file.path),
          }),
      }),
    ),
    Context.add(
      NoteFeature,
      stubService<NoteFeature["Service"]>("NoteFeature", {
        // The service's write runs to its end once started; a rejection is
        // what the note operation's write stopped on.
        updateNote: (file, options) =>
          Effect.uninterruptible(
            Effect.tryPromise({
              try: () => deps.noteFeature!.updateNote(file, options),
              catch: (cause) =>
                new NoteWriteAborted({ path: file.path, cause }),
            }),
          ),
      }),
    ),
    Context.add(
      Workspace,
      stubService<Workspace["Service"]>("Workspace", {
        getLeaf: (pane) => Effect.sync(() => deps.app!.workspace.getLeaf(pane)),
      }),
    ),
  );
  const stack = new AsyncDisposableStack();
  const runtime = buildRuntime(
    Layer.mergeAll(layerUnreadViewServices, Layer.succeedContext(context)),
    stack,
  );
  const registry = makeViewRegistry(
    runtime.runSync(Effect.context<ViewServices>()),
    { idleTTL: 0 },
  );
  const owners: (() => void | Promise<void>)[] = [];
  onTestFinished(async () => {
    for (const close of owners.reverse()) await close();
    registry.dispose();
    await stack.disposeAsync();
  });
  return {
    registry,
    own: (close: () => void | Promise<void>) => owners.push(close),
    deps: {
      registry,
      nativePreview: deps.nativePreview,
      render: deps.render,
      pluginVersion: deps.pluginVersion,
      itemLookup: deps.itemLookup,
      settings: deps.settings,
      bridge: deps.bridge,
    } satisfies TemplateWorkbenchDeps,
  };
}
