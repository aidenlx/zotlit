// The Welcome View as a banner: mounts the presentational tree into an element
// above the Library View, wires live step actions, and keeps the connection
// status subscribed to database events while it is loaded.
//
// @see apps/obsidian/docs/adr/0076-the-library-view-is-the-first-screen.md
import { Component, normalizePath } from "obsidian";
import type { App } from "obsidian";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import { BaseNotice } from "@/lib/notice";
import type { QueryClientService } from "@/services/query-client/service";
import type { ReleaseService } from "@/services/release/service";
import type { SettingsService } from "@/services/settings/service";
import type { LiteratureNoteTemplateMigrationService } from "@/services/template/migration";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";
import type { ZoteroReadsService } from "@/services/zotero-reads/service";

import { WelcomeActionsContext } from "./actions";
import type { WelcomeActions } from "./actions";
import { readConnectionStatus, readConnectionSync } from "./connection";
import { templateMigrationNotice } from "./migration-notice";
import type { SetupActions } from "./setup-actions";
import { createWelcomeStore, WelcomeStoreProvider } from "./store";
import { Welcome } from "./Welcome";

// Delay before the connection spinner appears; a readout that settles faster —
// the common case, since the DB is usually already loaded on open — resolves
// straight to connected/missing without ever flashing the spinner.
const CONNECTION_CHECKING_DELAY_MS = 200;

export interface WelcomeBannerDeps {
  app: App;
  reads: Pick<ZoteroReadsService, "state" | "ready" | "error" | "moved" | "on">;
  queries: Pick<QueryClientService, "peek" | "read">;
  zoteroPref: Pick<ZoteroPrefService, "dataDir">;
  settings: Pick<SettingsService, "subscribe" | "update">;
  setupActions: SetupActions;
  templateMigration: Pick<
    LiteratureNoteTemplateMigrationService,
    "convert" | "retryCleanup"
  >;
  release: Pick<ReleaseService, "hasV1Templates" | "acknowledgeMigration">;
}

export class WelcomeBanner extends Component {
  readonly #store = createWelcomeStore();
  readonly #deps: WelcomeBannerDeps;
  /** Where the banner draws. */
  readonly el: HTMLElement;
  #root: Root | null = null;
  #stack: DisposableStack | undefined;
  #connectionGen = 0;
  #checkingTimer: number | null = null;
  #connection: Promise<void> = Promise.resolve();

  constructor(deps: WelcomeBannerDeps, el: HTMLElement) {
    super();
    this.#deps = deps;
    this.el = el;
  }

  /**
   * Show the banner, its setup steps included, until the researcher
   * dismisses it, as "Open welcome view" asks.
   */
  request(): void {
    this.#store.setState({ requested: true });
  }

  /** Settles once the last connection readout started has landed. */
  get settled(): Promise<void> {
    return this.#connection;
  }

  override onload(): void {
    using stack = new DisposableStack();
    const { app, settings, release } = this.#deps;

    const folderExists = (folder: string) =>
      app.vault.getFolderByPath(normalizePath(folder)) !== null;
    stack.defer(
      settings.subscribe((s) => {
        if (s) {
          const literatureFolder =
            s["note.default-profile"].bindings["note.literature-folder"];
          this.#store.setState({
            migrationPending: s["release.migration-pending"],
            dismissed: s["welcome.dismissed"],
            literatureFolder,
            literatureFolderExists: folderExists(literatureFolder),
            templateConversionPending: s["note.template-conversion-pending"],
            templateFolder: s["template.folder"],
            templateConversionResult: s["note.template-conversion-result"],
            v1TemplatesPresent: release.hasV1Templates(s["template.folder"]),
          });
        }
      }),
    );

    const refreshVaultEvidence = () => {
      const state = this.#store.getState();
      this.#store.setState({
        literatureFolderExists: folderExists(state.literatureFolder),
        v1TemplatesPresent: release.hasV1Templates(state.templateFolder),
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
        this.#store.setState({ requested: true });
        const result = await this.#deps.templateMigration.convert();
        new BaseNotice(templateMigrationNotice(result));
        return result;
      },
      openExternal: (url) => window.open(url),
      dismiss: () => {
        this.#store.setState({ requested: false });
        settings.update({ "welcome.dismissed": true });
        release.acknowledgeMigration();
      },
      ...this.#deps.setupActions,
    };

    // Seed the definite readout before first paint so an already-loaded DB
    // renders connected/missing directly instead of flashing the spinner.
    this.#store.setState({
      connection: readConnectionSync(this.#deps) ?? { status: "checking" },
    });

    this.#root = createRoot(this.el);
    this.#root.render(
      <WelcomeStoreProvider value={this.#store}>
        <WelcomeActionsContext value={actions}>
          <Welcome />
        </WelcomeActionsContext>
      </WelcomeStoreProvider>,
    );

    const { reads } = this.#deps;
    const reload = (): void => this.#loadConnection();
    stack.defer(reads.on("changed", reload));
    stack.defer(reads.on("degraded", reload));
    stack.defer(reads.on("refresh-failed", reload));
    stack.defer(
      reads.on("refreshing", (active) => {
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
  }

  #loadConnection(): void {
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
