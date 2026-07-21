// ItemView orchestrator for the Welcome View: mounts the presentational tree, wires live step actions, and keeps connection status subscribed to DB events while open.
import {
  type App,
  ItemView,
  type ViewStateResult,
  type WorkspaceLeaf,
} from "obsidian";
import { createRoot, type Root } from "react-dom/client";

import * as m from "@/paraglide/messages";
import { type DatabaseService } from "@/services/database/service";
import { type SettingsService } from "@/services/settings/service";
import { type ZoteroPrefService } from "@/services/zotero-pref/service";

import { type WelcomeActions, WelcomeActionsContext } from "./actions";
import { readConnectionStatus } from "./connection";
import { type SetupActions } from "./setup-actions";
import { createWelcomeStore, WelcomeStoreProvider } from "./store";
import { Welcome } from "./Welcome";

export const WELCOME_VIEW_TYPE = "zotlit-welcome";

export interface WelcomeViewDeps {
  app: App;
  db: Pick<DatabaseService, "state" | "ready" | "client" | "error" | "on">;
  zoteroPref: Pick<ZoteroPrefService, "dataDir">;
  settings: Pick<SettingsService, "loaded" | "current" | "subscribe">;
  setupActions: SetupActions;
}

export class WelcomeView extends ItemView {
  readonly #store = createWelcomeStore();
  readonly #deps: WelcomeViewDeps;
  #root: Root | null = null;
  #closed = false;
  #stack: DisposableStack | undefined;
  #connectionGen = 0;

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
          });
      }),
    );

    const actions: WelcomeActions = {
      openExternal: (url) => window.open(url),
      ...this.#deps.setupActions,
    };

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
          // Invalidate any in-flight readout so its stale result can't land
          // on top of this checking state before the refresh settles.
          this.#connectionGen += 1;
          this.#store.setState({ connection: { status: "checking" } });
        }
      }),
    );
    void this.#loadConnection();
  }

  protected override async onClose(): Promise<void> {
    this.#closed = true;
    this.#stack?.dispose();
    this.#stack = undefined;
    this.#root?.unmount();
    this.#root = null;
  }

  async #loadConnection(): Promise<void> {
    const gen = ++this.#connectionGen;
    const connection = await readConnectionStatus(this.#deps);
    if (this.#closed || gen !== this.#connectionGen) return;
    this.#store.setState({ connection });
  }
}
