// ItemView orchestrator for the Welcome View: mounts the presentational tree, wires live step actions, and keeps connection status subscribed to DB events while open.
import { ItemView } from "obsidian";
import type { App, ViewStateResult, WorkspaceLeaf } from "obsidian";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";
import type { DatabaseService } from "@/services/database/service";
import type { SettingsService } from "@/services/settings/service";
import type { LiteratureNoteTemplateMigrationService } from "@/services/template/migration";
import type { LiteratureNoteTemplateMigrationResult } from "@/services/template/migration";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";

import { WelcomeActionsContext } from "./actions";
import type { WelcomeActions } from "./actions";
import { readConnectionStatus, readConnectionSync } from "./connection";
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
  db: Pick<DatabaseService, "state" | "ready" | "client" | "error" | "on">;
  zoteroPref: Pick<ZoteroPrefService, "dataDir">;
  settings: Pick<SettingsService, "subscribe">;
  setupActions: SetupActions;
  templateMigration: Pick<LiteratureNoteTemplateMigrationService, "convert">;
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
    const stack = new DisposableStack();
    this.#stack = stack;

    stack.defer(
      this.#deps.settings.subscribe((s) => {
        if (s)
          this.#store.setState({
            literatureFolder: s["note.literature-folder"],
            templateConversionPending: s["note.template-conversion-pending"],
          });
      }),
    );

    const actions: WelcomeActions = {
      convertLiteratureNoteTemplates: async () => {
        const result = await this.#deps.templateMigration.convert();
        new BaseNotice(templateMigrationNotice(result));
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
    stack.defer(this.#deps.db.on("changed", reload));
    stack.defer(this.#deps.db.on("degraded", reload));
    stack.defer(this.#deps.db.on("refresh-failed", reload));
    stack.defer(
      this.#deps.db.on("refreshing", (active) => {
        if (active) {
          // Invalidate any in-flight readout so its stale result can't land on
          // top of this refresh, then show checking only once the refresh is
          // slow enough to matter — a quick refresh never flashes the spinner.
          this.#armChecking(++this.#connectionGen);
        }
      }),
    );
    void this.#loadConnection();
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

function templateMigrationNotice(
  result: LiteratureNoteTemplateMigrationResult,
): string {
  if (result.outcome === "converted") {
    return m.notice_literature_note_template_conversion_success();
  }
  switch (result.diagnostic.code) {
    case "legacy-render-mismatch":
      return m.notice_literature_note_template_conversion_mismatch({
        difference: result.diagnostic.difference,
      });
    case "unsupported-legacy-template":
      return m.notice_literature_note_template_conversion_unsupported();
    case "legacy-frontmatter-inert":
      return m.notice_literature_note_template_conversion_frontmatter_inert({
        fields: result.diagnostic.fields.join(", "),
      });
    case "legacy-frontmatter-evaluation":
      return m.notice_literature_note_template_conversion_frontmatter_evaluation(
        { fields: result.diagnostic.fields.join(", ") },
      );
    case "no-verification-item":
      return m.notice_literature_note_template_conversion_no_item();
    case "converted-document-exists":
      return m.notice_literature_note_template_conversion_exists();
    case "no-legacy-templates":
      return m.notice_literature_note_template_conversion_none();
  }
}
