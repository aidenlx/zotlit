// The tab service over a test's own services, for builders and the tab class.

import { Context, Effect, Exit, FileSystem, Layer, Queue, Scope } from "effect";
import { onTestFinished } from "vitest";

import { testNotifier } from "@/lib/__fixtures__/notifier";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { Notifier } from "@/lib/notifier";
import { FileManager } from "@/lib/obsidian-file-manager";
import { Vault } from "@/lib/obsidian-vault";
import { PluginHost } from "@/lib/plugin-host";
import { CapabilityNotices } from "@/services/annotation-repository/notices";
import { AnnotationRepository } from "@/services/annotation-repository/service";
import { AttachmentImport } from "@/services/attachment-import/service";
import { ChineseSegmenter } from "@/services/chinese-segmenter/service";
import { CitationIndex } from "@/services/citation-index/service";
import { ExcerptDisplays } from "@/services/excerpt-image/display";
import { ExcerptImages } from "@/services/excerpt-image/layer";
import { LanguagePack } from "@/services/language-pack/service";
import { LibraryScope } from "@/services/library-scope/service";
import { Customize } from "@/services/local-bridge/customize";
import { LocalBridge } from "@/services/local-bridge/service";
import { LocalServer } from "@/services/local-server/service";
import { NoteFeature } from "@/services/note-feature/service";
import { NoteIndex } from "@/services/note-index/service";
import { PandocEngine } from "@/services/pandoc/service";
import { Profile } from "@/services/profile/service";
import { Release } from "@/services/release/service";
import { PluginSettings } from "@/services/settings/service";
import { Template } from "@/services/template/service";
import { ZoteroLocalApi } from "@/services/zotero-local-api/service";
import { ZoteroPref } from "@/services/zotero-pref/service";
import { ZoteroReads } from "@/services/zotero-reads/service";
import type { ZoteroReadsApi } from "@/services/zotero-reads/service";

import { makeSettingTab } from "./effect-tab";
import type { SettingTabShape } from "./effect-tab";

/**
 * Every service the tab reads, with no member implemented: a test's own
 * services replace these, and a member no test gave fails that Effect with an
 * unimplemented defect.
 */
export const unimplementedTabServices = Layer.mergeAll(
  Layer.mock(PluginSettings)({}),
  Layer.mock(Profile)({}),
  Layer.mock(Template)({}),
  Layer.mock(ZoteroPref)({}),
  Layer.mock(ZoteroReads)({
    reads: stubService<ZoteroReadsApi>("ZoteroReads.reads", {}),
  }),
  Layer.mock(LibraryScope)({}),
  Layer.mock(LocalServer)({}),
  Layer.mock(Release)({ version: "0.0.0" }),
  Layer.mock(AnnotationRepository)({}),
  Layer.mock(ZoteroLocalApi)({}),
  Layer.mock(CapabilityNotices)({}),
  Layer.mock(CitationIndex)({}),
  Layer.mock(PandocEngine)({}),
  Layer.mock(ChineseSegmenter)({}),
  Layer.mock(AttachmentImport)({}),
  Layer.mock(LocalBridge)({}),
  Layer.mock(Customize)({}),
  // Services with plain members: a read of a member no test gave throws.
  Layer.succeed(
    LanguagePack,
    stubService<LanguagePack["Service"]>("LanguagePack", {}),
  ),
  Layer.succeed(
    ExcerptImages,
    stubService<ExcerptImages["Service"]>("ExcerptImages", {}),
  ),
  Layer.succeed(
    ExcerptDisplays,
    stubService<ExcerptDisplays["Service"]>("ExcerptDisplays", {}),
  ),
  Layer.mock(NoteFeature)({}),
  Layer.mock(NoteIndex)({}),
  Layer.mock(Vault)({}),
  Layer.mock(FileManager)({}),
  Layer.succeed(
    PluginHost,
    stubService<PluginHost["Service"]>("PluginHost", {}),
  ),
  Layer.succeed(
    FileSystem.FileSystem,
    stubService<FileSystem.FileSystem>("FileSystem", {}),
  ),
);

/**
 * A tab service whose Effects read `services`, with a recording Notifier
 * unless `services` brings one. Its fibers run in the current Scope, on the
 * current clock: under `it.effect`, TestClock drives a row's timers.
 */
export const scopedSettingTab = Effect.fnUntraced(function* (
  services: Context.Context<never> = Context.empty(),
  { update = () => {} }: { update?: () => void } = {},
) {
  const notifier = testNotifier();
  const tab: SettingTabShape = yield* makeSettingTab(update).pipe(
    Effect.provideContext(services),
    Effect.provideService(Notifier, notifier.service),
    Effect.provide(unimplementedTabServices),
  );
  return { tab, notices: notifier.notices };
});

/**
 * `scopedSettingTab` over the services `layer` builds, for a row whose actions
 * rebuild the tab or leave the settings window. `rebuilt` takes one element
 * per definition rebuild an action asks for; the settings window closes
 * through `close`.
 */
export const rebuildingSettingTab = Effect.fnUntraced(function* (
  layer: Layer.Layer<never>,
  { close = () => {} }: { close?: () => void } = {},
) {
  const services = yield* Layer.build(
    Layer.merge(
      layer,
      Layer.succeed(
        PluginHost,
        stubService<PluginHost["Service"]>("PluginHost", {
          closeSettings: Effect.sync(close),
        }),
      ),
    ),
  );
  const rebuilt = yield* Queue.unbounded<void>();
  const { tab, notices } = yield* scopedSettingTab(services, {
    update: () => Queue.offerUnsafe(rebuilt, undefined),
  });
  return { tab, notices, rebuilt };
});

/** `scopedSettingTab` for a plain test: its fibers end when the test finishes. */
export function testSettingTab(...args: Parameters<typeof scopedSettingTab>) {
  const scope = Scope.makeUnsafe();
  onTestFinished(() => Effect.runPromise(Scope.close(scope, Exit.void)));
  return Effect.runSync(
    scopedSettingTab(...args).pipe(Effect.provideService(Scope.Scope, scope)),
  );
}

/**
 * The Profile, Template and Vault reads of the Profile and Template rows:
 * a loaded registry with no Profile, no excluded document, no partial and no
 * saved Default document, unless a test overrides a member.
 */
export function profileRowServices(
  overrides: {
    profile?: Partial<Profile["Service"]>;
    template?: Partial<Template["Service"]>;
    vault?: Partial<Vault["Service"]>;
  } = {},
) {
  return Context.make(
    Profile,
    stubService<Profile["Service"]>("Profile", {
      loaded: Effect.succeed(true),
      profiles: Effect.succeed([]),
      diagnostics: Effect.succeed([]),
      defaultDocumentPath: Effect.succeed(
        "templates/zotlit-profile.default.md",
      ),
      ...overrides.profile,
    }),
  ).pipe(
    Context.add(
      Template,
      stubService<Template["Service"]>("Template", {
        loaded: Effect.succeed(true),
        javascriptTemplatesEnabled: Effect.succeed(false),
        getPartialDocuments: Effect.succeed([]),
        getReservedPartialFiles: Effect.succeed([]),
        getUnrecognizedFiles: Effect.succeed([]),
        ...overrides.template,
      }),
    ),
    Context.add(
      Vault,
      stubService<Vault["Service"]>("Vault", {
        getFileByPath: () => Effect.succeed(null),
        ...overrides.vault,
      }),
    ),
  );
}
