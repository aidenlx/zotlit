// The Welcome View as a banner: mounts the presentational tree into an element
// above the Library View, wires live step actions, and keeps the connection
// status subscribed to database events while it is loaded.
//
// @see apps/obsidian/docs/adr/0077-the-library-view-is-the-first-screen.md
import { Component, normalizePath } from "obsidian";
import type { App } from "obsidian";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import { AbortError, passAborted } from "@/lib/abort-error";
import type { EffectBridge } from "@/lib/effect-bridge";
import type { SubscriptionRuntime } from "@/lib/effect-stream";
import { subscribe } from "@/lib/effect-stream";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";
import type { PlainQueryClients } from "@/services/query-client/plain";
import type { Release } from "@/services/release/service";
import type {
  PluginSettings,
  SettingsPatch,
} from "@/services/settings/service";
import type { PlainTemplateMigration } from "@/services/template/plain";
import type { PlainZoteroPref } from "@/services/zotero-pref/plain";
import type { PlainZoteroReads } from "@/services/zotero-reads/plain";

import { WelcomeActionsContext } from "./actions";
import type { WelcomeActions, WelcomeBannerHost } from "./actions";
import {
  readConnectionStatus,
  readConnectionSync,
  unavailable,
} from "./connection";
import { templateMigrationNotice } from "./migration-notice";
import type { SetupActions } from "./setup-actions";
import {
  bannerSections,
  createWelcomeStore,
  WelcomeStoreProvider,
} from "./store";
import { Welcome } from "./Welcome";

const logger = getLogger(["welcome", "banner"]);

// Delay before the connection spinner appears; a readout that settles faster —
// the common case, since the DB is usually already loaded on open — resolves
// straight to connected/missing without ever flashing the spinner.
const CONNECTION_CHECKING_DELAY_MS = 200;

export interface WelcomeBannerDeps {
  runtime: SubscriptionRuntime;
  bridge: Pick<EffectBridge, "runSync" | "runPromise">;
  app: App;
  reads: Pick<
    PlainZoteroReads,
    | "state"
    | "reads"
    | "error"
    | "moved"
    | "changed"
    | "degraded"
    | "refresh-failed"
    | "refreshing"
    | "db-file-missing"
    | "refresh-requested"
  >;
  queries: Pick<PlainQueryClients, "peek" | "read">;
  zoteroPref: Pick<PlainZoteroPref, "dataDir">;
  settings: Pick<PluginSettings["Service"], "changes" | "update" | "flush">;
  setupActions: SetupActions;
  templateMigration: Pick<PlainTemplateMigration, "convert" | "retryCleanup">;
  release: Pick<
    Release["Service"],
    | "hasV1Templates"
    | "acknowledgeMigration"
    | "acknowledgeUpdate"
    | "openReleaseNote"
    | "version"
  >;
}

export class WelcomeBanner extends Component {
  readonly #store = createWelcomeStore();
  readonly #deps: WelcomeBannerDeps;
  readonly #host: WelcomeBannerHost;
  /** Where the banner draws. */
  readonly el: HTMLElement;
  #root: Root | null = null;
  #stack: DisposableStack | undefined;
  #connectionGen = 0;
  #checkingTimer: number | null = null;
  #connection: Promise<void> = Promise.resolve();
  #decided: PromiseWithResolvers<boolean> | null = null;

  constructor(
    deps: WelcomeBannerDeps,
    host: WelcomeBannerHost,
    el: HTMLElement,
  ) {
    super();
    this.#deps = deps;
    this.#host = host;
    this.el = el;
  }

  /**
   * Show the banner, its setup steps included, until the researcher
   * dismisses it, and move focus to it, as "Open welcome view" and the
   * Library View's "Welcome & help" ask.
   */
  request(): void {
    this.#keep({ "welcome.dismissed": false, "welcome.requested": true });
    this.#store.setState((s) => ({ requests: s.requests + 1 }));
  }

  /**
   * Write `patch` to plugin data and on to disk at once, so a reload right
   * after it shows the banner as it is now.
   */
  #keep(patch: SettingsPatch): void {
    const { bridge, settings } = this.#deps;
    bridge.runSync(settings.update(patch));
    bridge.runPromise(settings.flush).catch((error: unknown) => {
      if (AbortError.test(error)) return;
      logger.warn("The Welcome View banner could not keep its state", {
        error,
      });
    });
  }

  /**
   * Put the banner away, as its dismiss button and the Library View's
   * "Welcome & help" do; this acknowledges the Migration Prompt of the
   * upgraded state and the update of the running version.
   */
  dismiss(): void {
    const { bridge, release } = this.#deps;
    this.#store.setState({ converted: false });
    try {
      bridge.runSync(release.acknowledgeMigration);
      bridge.runSync(release.acknowledgeUpdate);
    } catch (error) {
      logger.warn("The Welcome View banner could not acknowledge the release", {
        error,
      });
    }
    this.#keep({
      "welcome.dismissed": true,
      "welcome.requested": false,
      "welcome.steps-shown": false,
    });
  }

  /** Whether the banner shows anything now. */
  get shown(): boolean {
    return bannerSections(this.#store.getState()) !== null;
  }

  /**
   * Whether {@link shown} is final. While the connection readout is still
   * checking, a banner that shows nothing yet may come to show: its setup
   * steps open once the readout lands, where setup is incomplete. A banner
   * that shows already keeps showing.
   */
  get known(): boolean {
    return (
      this.shown || this.#store.getState().connection.status !== "checking"
    );
  }

  /**
   * Settles with whether the banner shows, once that is {@link known}, and at
   * the latest when the banner unloads. Never rejects.
   */
  get decided(): Promise<boolean> {
    if (this.known) return Promise.resolve(this.shown);
    this.#decided ??= Promise.withResolvers();
    return this.#decided.promise;
  }

  #decide(): void {
    if (this.#decided === null) return;
    this.#decided.resolve(this.shown);
    this.#decided = null;
  }

  /**
   * Call `listener` with whether the banner shows, now and on every change,
   * whatever brings it or puts it away.
   *
   * @returns what stops the calls.
   */
  subscribeShown(listener: (shown: boolean) => void): () => void {
    let last = this.shown;
    listener(last);
    return this.#store.subscribe(() => {
      const shown = this.shown;
      if (shown === last) return;
      last = shown;
      listener(shown);
    });
  }

  /** Settles once the last connection readout started has landed. */
  get settled(): Promise<void> {
    return this.#connection;
  }

  override onload(): void {
    using stack = new DisposableStack();
    const { app, bridge, settings, release } = this.#deps;

    const folderExists = (folder: string) =>
      app.vault.getFolderByPath(normalizePath(folder)) !== null;
    stack.defer(
      subscribe(this.#deps.runtime, settings.changes, (s) => {
        if (s) {
          const literatureFolder =
            s["note.default-profile"].bindings["note.literature-folder"];
          this.#store.setState({
            migrationPending: s["release.migration-pending"],
            dismissed: s["welcome.dismissed"],
            requested: s["welcome.requested"],
            stepsShown: s["welcome.steps-shown"],
            literatureFolder,
            literatureFolderExists: folderExists(literatureFolder),
            templateConversionPending: s["note.template-conversion-pending"],
            templateFolder: s["template.folder"],
            templateConversionResult: s["note.template-conversion-result"],
            v1TemplatesPresent: bridge.runSync(
              release.hasV1Templates(s["template.folder"]),
            ),
            updatePending: s["release.update-pending"],
            noticesEnabled: s["release.notices-enabled"],
          });
        }
      }),
    );

    const refreshVaultEvidence = () => {
      const state = this.#store.getState();
      this.#store.setState({
        literatureFolderExists: folderExists(state.literatureFolder),
        v1TemplatesPresent: bridge.runSync(
          release.hasV1Templates(state.templateFolder),
        ),
      });
    };
    const created = app.vault.on("create", refreshVaultEvidence);
    stack.defer(() => app.vault.offref(created));
    const deleted = app.vault.on("delete", refreshVaultEvidence);
    stack.defer(() => app.vault.offref(deleted));
    const renamed = app.vault.on("rename", refreshVaultEvidence);
    stack.defer(() => app.vault.offref(renamed));

    const actions: WelcomeActions = {
      retryTemplateCleanup: async () => {
        const result = await this.#deps.templateMigration.retryCleanup();
        new BaseNotice(templateMigrationNotice(result));
      },
      convertLiteratureNoteTemplates: async () => {
        // The banner stays to show the result the researcher asked for.
        this.#store.setState({ converted: true });
        const result = await this.#deps.templateMigration.convert();
        new BaseNotice(templateMigrationNotice(result));
        return result;
      },
      openExternal: (url) => window.open(url),
      dismiss: () => this.dismiss(),
      showSteps: (shown) => this.#keep({ "welcome.steps-shown": shown }),
      openReleaseNote: () => {
        void bridge.runPromise(release.openReleaseNote).catch(passAborted);
        bridge.runSync(release.acknowledgeUpdate);
      },
      ...this.#deps.setupActions,
      ...this.#host,
    };

    // Seed the definite readout before first paint so an already-loaded DB
    // renders connected/missing directly instead of flashing the spinner.
    this.#store.setState({
      connection: readConnectionSync(this.#deps) ?? { status: "checking" },
      version: release.version,
    });

    this.#root = createRoot(this.el);
    this.#root.render(
      <WelcomeStoreProvider value={this.#store}>
        <WelcomeActionsContext value={actions}>
          <Welcome />
        </WelcomeActionsContext>
      </WelcomeStoreProvider>,
    );

    stack.defer(
      this.#store.subscribe(() => {
        if (this.known) this.#decide();
      }),
    );

    const { reads } = this.#deps;
    const reload = (): void => this.#loadConnection();
    stack.defer(subscribe(this.#deps.runtime, reads["changed"], reload));
    stack.defer(subscribe(this.#deps.runtime, reads["degraded"], reload));
    stack.defer(subscribe(this.#deps.runtime, reads["refresh-failed"], reload));
    stack.defer(
      subscribe(this.#deps.runtime, reads["db-file-missing"], reload),
    );
    stack.defer(
      subscribe(this.#deps.runtime, reads["refreshing"], (active) => {
        if (active) {
          // Invalidate any in-flight readout so its stale result can't land on
          // top of this refresh, then show checking only once the refresh is
          // slow enough to matter — a quick refresh never flashes the spinner.
          this.#armChecking(++this.#connectionGen);
        }
      }),
    );
    this.#loadConnection();
    this.#stack = stack.move();
  }

  override onunload(): void {
    this.#clearCheckingTimer();
    // Any readout in flight lands on a newer generation and is dropped.
    this.#connectionGen++;
    this.#stack?.dispose();
    this.#stack = undefined;
    this.#root?.unmount();
    this.#root = null;
    this.#decide();
  }

  #loadConnection(): void {
    // The Library View shows its not-found card on the same reading.
    this.#store.setState({ notFound: unavailable(this.#deps) });
    const gen = ++this.#connectionGen;
    this.#armChecking(gen);
    this.#connection = readConnectionStatus(this.#deps).then((connection) => {
      if (gen !== this.#connectionGen) return;
      this.#clearCheckingTimer();
      this.#store.setState({ connection });
    });
  }

  /**
   * Show the checking spinner only if this readout is still pending after the
   * grace delay. A held readout stays on screen instead.
   */
  #armChecking(gen: number): void {
    this.#clearCheckingTimer();
    if (readConnectionSync(this.#deps) !== null) return;
    this.#checkingTimer = this.el.win.setTimeout(() => {
      this.#checkingTimer = null;
      if (gen === this.#connectionGen) {
        this.#store.setState({ connection: { status: "checking" } });
      }
    }, CONNECTION_CHECKING_DELAY_MS);
  }

  #clearCheckingTimer(): void {
    if (this.#checkingTimer !== null) {
      this.el.win.clearTimeout(this.#checkingTimer);
      this.#checkingTimer = null;
    }
  }
}
