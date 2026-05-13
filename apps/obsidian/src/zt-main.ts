import { Plugin } from "obsidian";
import { initI18n } from "./lib/i18n";
import { BaseNotice } from "./lib/notice";
import { buildServices } from "./services/build";
import { addDatabaseActions } from "./services/database/actions";
import { ZotLitSettingTab } from "./setting-tab";
import "./zt-main.css";

/** Thin Obsidian plugin shell; feature work should live in services/actions. */
export default class ZotLitPlugin extends Plugin {
  // Owns every service/resource registered during onload after startup commits.
  #stack?: AsyncDisposableStack;

  // Debug/escape-hatch access only. Services should depend on each other via DI.
  #services?: ReturnType<typeof buildServices>["services"];

  get services(): ReturnType<typeof buildServices>["services"] {
    if (!this.#services) throw new Error("Plugin not loaded");
    return this.#services;
  }

  override async onload(): Promise<void> {
    await super.onload();

    // Register the Paraglide locale strategy before any service can call `m.*`.
    initI18n();

    // Local stack gives automatic rollback if any synchronous startup wiring
    // fails before the plugin commits ownership with `stack.move()`.
    await using stack = new AsyncDisposableStack();
    const { services } = buildServices(this, stack);

    this.addSettingTab(
      new ZotLitSettingTab({
        plugin: this,
        settings: services.settings,
        db: services.db,
      }),
    );

    addDatabaseActions(this, { db: services.db });

    console.log("ZotLit loaded");

    this.#services = services;
    this.#stack = stack.move();
  }

  override onunload(): void {
    // Drop the service bag before async disposal so late callers fail clearly.
    this.#services = undefined;

    const stack = this.#stack;
    this.#stack = undefined;

    void stack?.disposeAsync().catch((error: unknown) => {
      console.error("ZotLit cleanup error:", error);
      new BaseNotice("Failed to clean up ZotLit resources");
    });
  }
}
