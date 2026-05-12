import type ZotLitPlugin from "../zt-main";
import { ServiceContainer } from "./service-base";
import { migrateLegacyV0 } from "./settings/migrate";
import { SettingsService } from "./settings/service";

/**
 * Construct and wire all Obsidian plugin services.
 *
 * This function does not own lifecycle. `zt-main.ts` creates the stack, passes
 * it here, and moves the stack only after all plugin startup wiring succeeds.
 */
export function buildServices(
  plugin: ZotLitPlugin,
  stack: AsyncDisposableStack,
) {
  const container = new ServiceContainer(stack, (key, error) => {
    console.error(`Service "${key}" failed to initialize`, error);
  });

  return container.use({
    settings: () =>
      new SettingsService({ plugin, migrateLegacy: migrateLegacyV0 }),
  });
}
