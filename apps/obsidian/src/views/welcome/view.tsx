// ItemView orchestrator for the Welcome View: mounts the presentational tree, wires live step actions, and keeps connection status subscribed to database events while open.
import { ItemView, normalizePath } from "obsidian";
import type { App, ViewStateResult, WorkspaceLeaf } from "obsidian";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";
import type { NoteIndex } from "@/services/note-index/service";
import type { QueryClientService } from "@/services/query-client/service";
import type { ReleaseService } from "@/services/release/service";
import type { SettingsService } from "@/services/settings/service";
import type { LiteratureNoteTemplateMigrationService } from "@/services/template/migration";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";
import type { ZoteroReadsService } from "@/services/zotero-reads/service";

import { WelcomeActionsContext } from "./actions";
import type { WelcomeActions } from "./actions";
import { createCompanionRefresh } from "./companion-refresh";
import { readConnectionStatus, readConnectionSync } from "./connection";
import { templateMigrationNotice } from "./migration-notice";
import type { SetupActions } from "./setup-actions";
import { createWelcomeStore, WelcomeStoreProvider } from "./store";
import { Welcome } from "./Welcome";

export const WELCOME_VIEW_TYPE = "zotlit-welcome";

// Delay before the connection spinner appears; a readout that settles faster —
// the common case, since the DB is usually already loaded on open — resolves
// straight to connected/missing without ever flashing the spinner.
const CONNECTION_CHECKING_DELAY_MS = 200;

export interface WelcomeViewDeps {
  app: App;
  reads: Pick<ZoteroReadsService, "state" | "ready" | "error" | "on">;
  queries: Pick<QueryClientService, "peek" | "read">;
  zoteroPref: Pick<ZoteroPrefService, "dataDir" | "companionInstalled" | "on">;
  noteIndex: Pick<NoteIndex, "getIndexedItemKeys" | "whenIndexed" | "on">;
  settings: Pick<SettingsService, "subscribe">;
  setupActions: SetupActions;
  templateMigration: Pick<
    LiteratureNoteTemplateMigrationService,
    "convert" | "retryCleanup"
  >;
  release: Pick<ReleaseService, "hasV1Templates">;
}

export class WelcomeView extends ItemView {
  readonly #store = createWelcomeStore();
  readonly #deps: WelcomeViewDeps;
  #root: Root | null = null;
  #closed = false;
  #stack: DisposableStack | undefined;
  #connectionGen = 0;
  #checkingTimer: number | null = null;

  constructor(leaf: WorkspaceLeaf, deps: WelcomeViewDeps) {
    super(leaf);
    this.contentEl.addClass("zt-root");
    this.#deps = deps;
  }

  override getViewType(): string {
    return WELCOME_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return m.welcome_view_name();
  }

  override getIcon(): string {
    return "book-marked";
  }

  override getState(): Record<string, unknown> {
    return { mode: this.#store.getState().mode };
  }

  override async setState(
    state: unknown,
    result: ViewStateResult,
  ): Promise<void> {
    await super.setState(state, result);
    if (!state || typeof state !== "object") return;
    const s = state as Record<string, unknown>;
    if (s.mode === "fresh" || s.mode === "upgraded") {
      this.#store.setState({ mode: s.mode });
    }
  }

  protected override async onOpen(): Promise<void> {
    using stack = new DisposableStack();

    const folderExists = (folder: string) =>
      this.app.vault.getFolderByPath(normalizePath(folder)) !== null;
    stack.defer(
      this.#deps.settings.subscribe((s) => {
        if (s) {
          const literatureFolder =
            s["note.default-profile"].bindings["note.literature-folder"];
          this.#store.setState({
            literatureFolder,
            literatureFolderExists: folderExists(literatureFolder),
            templateConversionPending: s["note.template-conversion-pending"],
            templateFolder: s["template.folder"],
            templateConversionResult: s["note.template-conversion-result"],
            v1TemplatesPresent: this.#deps.release.hasV1Templates(
              s["template.folder"],
            ),
          });
        }
      }),
    );

    const refreshVaultEvidence = () => {
      const state = this.#store.getState();
      this.#store.setState({
        literatureFolderExists: folderExists(state.literatureFolder),
        v1TemplatesPresent: this.#deps.release.hasV1Templates(
          state.templateFolder,
        ),
      });
    };
    const created = this.app.vault.on("create", refreshVaultEvidence);
    stack.defer(() => this.app.vault.offref(created));
    const deleted = this.app.vault.on("delete", refreshVaultEvidence);
    stack.defer(() => this.app.vault.offref(deleted));
    const renamed = this.app.vault.on("rename", refreshVaultEvidence);
    stack.defer(() => this.app.vault.offref(renamed));

    const refreshNotes = () => {
      this.#store.setState({
        hasLiteratureNote: this.#deps.noteIndex.getIndexedItemKeys().length > 0,
      });
    };
    stack.defer(this.#deps.noteIndex.on("changed", refreshNotes));
    void this.#deps.noteIndex.whenIndexed().then(() => {
      if (!this.#closed) refreshNotes();
    });

    // Startup may precede Zotero's add-on list. Later installs still refresh
    // when the reader returns from Zotero or the connected services change.
    const companion = stack.use(
      createCompanionRefresh({
        readInstalled: () => this.#deps.zoteroPref.companionInstalled(),
        publish: (companionInstalled) =>
          this.#store.setState({ companionInstalled }),
      }),
    );
    const refreshCompanion = (): void => void companion.refresh();
    stack.defer(this.#deps.zoteroPref.on("changed", refreshCompanion));
    stack.defer(this.#deps.reads.on("changed", refreshCompanion));
    const win = this.containerEl.win;
    win.addEventListener("focus", refreshCompanion);
    stack.defer(() => win.removeEventListener("focus", refreshCompanion));
    refreshCompanion();

    const actions: WelcomeActions = {
      retryTemplateCleanup: async () => {
        const result = await this.#deps.templateMigration.retryCleanup();
        new BaseNotice(templateMigrationNotice(result));
      },
      convertLiteratureNoteTemplates: async () => {
        const result = await this.#deps.templateMigration.convert();
        new BaseNotice(templateMigrationNotice(result));
        return result;
      },
      openExternal: (url) => window.open(url),
      ...this.#deps.setupActions,
    };

    // Seed the definite readout before first paint so an already-loaded DB
    // renders connected/missing directly instead of flashing the spinner.
    this.#store.setState({
      connection: readConnectionSync(this.#deps) ?? { status: "checking" },
    });

    this.#root = createRoot(this.contentEl);
    this.#root.render(
      <WelcomeStoreProvider value={this.#store}>
        <WelcomeActionsContext value={actions}>
          <Welcome />
        </WelcomeActionsContext>
      </WelcomeStoreProvider>,
    );

    const reload = (): void => void this.#loadConnection();
    stack.defer(this.#deps.reads.on("changed", reload));
    stack.defer(this.#deps.reads.on("degraded", reload));
    stack.defer(this.#deps.reads.on("refresh-failed", reload));
    stack.defer(
      this.#deps.reads.on("refreshing", (active) => {
        if (active) {
          // Invalidate any in-flight readout so its stale result can't land on
          // top of this refresh, then show checking only once the refresh is
          // slow enough to matter — a quick refresh never flashes the spinner.
          this.#armChecking(++this.#connectionGen);
        }
      }),
    );
    void this.#loadConnection();
    this.#stack = stack.move();
  }

  protected override async onClose(): Promise<void> {
    this.#closed = true;
    this.#clearCheckingTimer();
    this.#stack?.dispose();
    this.#stack = undefined;
    this.#root?.unmount();
    this.#root = null;
  }

  async #loadConnection(): Promise<void> {
    const gen = ++this.#connectionGen;
    this.#armChecking(gen);
    const connection = await readConnectionStatus(this.#deps);
    if (this.#closed || gen !== this.#connectionGen) return;
    this.#clearCheckingTimer();
    this.#store.setState({ connection });
  }

  /** Show the checking spinner only if this readout is still pending after the grace delay. */
  #armChecking(gen: number): void {
    this.#clearCheckingTimer();
    this.#checkingTimer = window.setTimeout(() => {
      this.#checkingTimer = null;
      if (!this.#closed && gen === this.#connectionGen) {
        this.#store.setState({ connection: { status: "checking" } });
      }
    }, CONNECTION_CHECKING_DELAY_MS);
  }

  #clearCheckingTimer(): void {
    if (this.#checkingTimer !== null) {
      window.clearTimeout(this.#checkingTimer);
      this.#checkingTimer = null;
    }
  }
}
