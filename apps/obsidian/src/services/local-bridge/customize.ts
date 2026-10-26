// The Customize flow every entry action shares: which template and paper a
// launch carries, the launch sheet that approves it, the Local Server it turns
// on when it has to, and the browser tab it finally opens.
//
// The sheet itself is a port (`confirmLaunch`), so the decision this module
// makes is testable apart from the modal that renders it.
import { Duration, Effect, Option, Schema, Stream } from "effect";
import type { Context } from "effect";
import type { CachedMetadata, TFile } from "obsidian";

import { DOCS_SITE_URL } from "@/lib/constants";
import type { EffectBridge } from "@/lib/effect-bridge";
import { withLogCategory } from "@/lib/effect-log";
import { awaitModal } from "@/lib/effect-modal";
import type { ClosableModal } from "@/lib/effect-modal";
import * as m from "@/lib/i18n/generated/messages";
import { Notifier } from "@/lib/notifier";
import { ObsidianEnv } from "@/lib/obsidian-env";
import { MetadataCache } from "@/lib/obsidian-metadata-cache";
import { Workspace } from "@/lib/obsidian-workspace";
import type { ProfileSelector } from "@/lib/profile-stamp";
import { LocalServer } from "@/services/local-server/service";
import { itemKeyFromFrontmatter } from "@/services/note-index/service";
import { Profile } from "@/services/profile/service";
import { PluginSettings } from "@/services/settings/service";
import { Template } from "@/services/template/service";
import type { ProfileCustomization } from "@/views/template-workbench/preferences";

import { profileDisplayName } from "./profile-name";
import { LocalBridge } from "./service";
import type { SelectedItemIdentity } from "./sessions";
import { unsupportedProfileSourceReason } from "./unsupported";

/** How long a launch waits for the listener it just turned on. */
const SERVER_START_TIMEOUT = Duration.seconds(10);

/** What an entry action asks Customize to open. */
export interface CustomizeRequest {
  readonly profileId: ProfileSelector;
  /** The note explicitly launching this session; preview selection is independent. */
  readonly originatingNote?: TFile;
  readonly destination?: Exclude<ProfileCustomization, "ask">;
  /**
   * The paper to show. Leave it out and the flow takes the active Literature
   * Note's paper, or a Sample Item when no Literature Note is active.
   */
  readonly item?: SelectedItemIdentity | null;
}

/** What the launch sheet names, so the shell renders what the flow decided. */
export interface LaunchSheetDetails {
  /** The website's host, as the plugin will open it. */
  readonly website: string;
  readonly vault: string;
  /** The paper's name, or `null` for a Sample Item. */
  readonly item: string | null;
  readonly template: string;
  /** The sheet leads with turning the Local Server on. */
  readonly turnServerOn: boolean;
  readonly turnWorkbenchOn: boolean;
}

/** What the researcher answered on the launch sheet. */
export interface LaunchConsent {
  readonly destination: "web" | "native";
  readonly remember: boolean;
}

/**
 * The sheet as the flow uses it: it opens the sheet and returns it, and
 * `settle` gets the answer. `null` means Cancel, and nothing happens.
 */
export type ConfirmLaunch = (
  details: LaunchSheetDetails,
  settle: (consent: LaunchConsent | null) => void,
) => ClosableModal;

/** What the flow reaches outside the services: the build, the UI and the device. */
export interface CustomizePorts {
  readonly webWorkbenchEnabled: boolean;
  /** This build's version, which a Profile's `minAppVersion` is read against. */
  readonly pluginVersion: string;
  readonly confirmLaunch: ConfirmLaunch;
  readonly openExternal: (url: string) => void;
  readonly openNative: (request: CustomizeRequest) => Promise<void>;
  /** The destination this device remembers (`views/template-workbench/preferences`). */
  readonly preference: () => ProfileCustomization;
  readonly rememberPreference: (
    value: Exclude<ProfileCustomization, "ask">,
  ) => void;
}

/** The services the flow reads. */
export type CustomizeServices =
  | PluginSettings
  | Profile
  | Template
  | LocalServer
  | LocalBridge
  | Notifier
  | Workspace
  | MetadataCache
  | ObsidianEnv;

/** A port the shell supplies rejected; `cause` is what it rejected with. */
export class CustomizePortError extends Schema.TaggedError<
  CustomizePortError,
  { readonly brand: unique symbol }
>()("CustomizePortError", {
  cause: Schema.Defect(),
}) {}

/** Open a template in the chosen editor, with approval for web access. */
export type CustomizeAction = (request: CustomizeRequest) => Promise<void>;

/**
 * The Customize flow for callers outside Effect: the entry actions, the
 * setting tab and the Workbench view. A run rejects with what failed.
 */
export function bindCustomize(
  bridge: Pick<EffectBridge, "runPromise">,
  context: Context.Context<CustomizeServices>,
  ports: CustomizePorts,
): CustomizeAction {
  return (request) =>
    bridge.runPromise(
      customize(request, ports).pipe(
        Effect.mapError(({ cause }) => cause),
        Effect.provideContext(context),
      ),
    );
}

const portError = (cause: unknown) => new CustomizePortError({ cause });

/** A port's Promise, failing with what it rejected with. */
const port = <A>(evaluate: () => Promise<A>) =>
  Effect.tryPromise({ try: evaluate, catch: portError });

export const customize = Effect.fn("LocalBridge.customize")(function* (
  request: CustomizeRequest,
  ports: CustomizePorts,
) {
  const item =
    request.item === undefined ? yield* activeNoteItem : request.item;
  const nativeRequest = { ...request, item };
  const openNative = port(() => ports.openNative(nativeRequest));
  if (!ports.webWorkbenchEnabled) {
    yield* openNative;
    return;
  }
  const preference = ports.preference();
  const source = yield* (yield* Profile).getSource(request.profileId);
  const reason = unsupportedProfileSourceReason(
    yield* withDependencies(source),
    ports.pluginVersion,
  );
  const notifier = yield* Notifier;
  if (reason !== null) {
    yield* Effect.logDebug("Customize kept the Profile in Obsidian").pipe(
      Effect.annotateLogs({ reason }),
      withLogCategory("local-bridge"),
    );
    yield* openNative;
    yield* notifier.show(m.notice_workbench_unsupported_profile());
    return;
  }

  if (
    request.destination === "native" ||
    (!request.destination && preference === "native")
  ) {
    yield* openNative;
    return;
  }

  const settings = yield* PluginSettings;
  const current = yield* settings.current;
  const turnServerOn = current["server.enabled"] !== true;
  const turnWorkbenchOn = !current["server.workbench"];
  if (turnServerOn || turnWorkbenchOn || preference !== "web") {
    const details: LaunchSheetDetails = {
      website: new URL(DOCS_SITE_URL).host,
      vault: (yield* ObsidianEnv).vaultName,
      item: item?.title ?? item?.key ?? null,
      template: yield* profileDisplayName(request.profileId),
      turnServerOn,
      turnWorkbenchOn,
    };
    // An interrupt takes the sheet away.
    const consent = yield* awaitModal<LaunchConsent | null>((settle) =>
      ports.confirmLaunch(details, settle),
    );
    if (consent === null) return;
    if (consent.destination === "native") {
      yield* openNative;
      if (consent.remember) ports.rememberPreference("native");
      return;
    }
    if (turnServerOn || turnWorkbenchOn)
      yield* settings.update({
        ...(turnServerOn ? { "server.enabled": true } : {}),
        ...(turnWorkbenchOn ? { "server.workbench": true } : {}),
      });
    if (turnServerOn && !(yield* whenListening)) {
      yield* Effect.logWarning(
        "Customize gave up waiting for the local server",
      ).pipe(withLogCategory("local-bridge"));
      yield* notifier.show(m.notice_workbench_server_failed());
      return;
    }
    if (consent.remember) ports.rememberPreference("web");
  }

  const url = yield* (yield* LocalBridge).launchUrl({
    profileId: request.profileId,
    item,
  });
  if (url === null) {
    yield* notifier.show(m.notice_workbench_unavailable());
    return;
  }
  ports.openExternal(url);
});

/**
 * The Profile document with the partials it calls bundled in, so the check
 * sees a folder partial written in Eta the way the page would. A document that
 * cannot be bundled is checked as written.
 */
const withDependencies = (source: string) =>
  Template.use((template) =>
    template.exportLiteratureNotePackSource(source, {
      onMissingPartial: () => {},
    }),
  ).pipe(Effect.orElseSucceed(() => source));

/** `true` once the listener binds, `false` once the wait runs out. */
const whenListening = LocalServer.use((server) =>
  server.effectivePortChanges.pipe(
    Stream.filter((bound) => bound !== null),
    Stream.runHead,
    Effect.map((bound) => Option.isSome(bound)),
  ),
).pipe(
  Effect.timeoutOrElse({
    duration: SERVER_START_TIMEOUT,
    orElse: () => Effect.succeed(false),
  }),
);

/** The paper the active Literature Note is about, or `null` for a Sample Item. */
const activeNoteItem = Effect.gen(function* () {
  const file = yield* (yield* Workspace).getActiveFile;
  if (!file) return null;
  return noteItem(file, yield* (yield* MetadataCache).fileCache(file));
});

/** The paper a Literature Note is about, from its cache; `null` for any other note. */
export function noteItem(
  file: TFile,
  cache: CachedMetadata | null,
): SelectedItemIdentity | null {
  const key = itemKeyFromFrontmatter(cache);
  return key === null ? null : { key, title: file.basename };
}
