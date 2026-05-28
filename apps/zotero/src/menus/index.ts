import { logger as appLogger } from "@/lib/logger";

import { registerItemMenu } from "./item.js";
import { registerReaderAnnotationMenu } from "./reader-annotation.js";
import { registerReaderPageMenu } from "./reader-page.js";

const logger = appLogger.getChild("menus");

/**
 * Register all menu surfaces. Returns an {@link AsyncDisposable} that
 * unregisters them in LIFO order on shutdown — important for RDP dev
 * reloads where pluginID-scoped auto-cleanup would otherwise leave stale
 * registrations until full plugin teardown.
 */
export async function registerMenus(
  pluginID: string,
): Promise<AsyncDisposable> {
  logger.info("registering menus", { pluginID });
  await using stack = new AsyncDisposableStack();
  stack.use(registerItemMenu(pluginID));
  stack.use(await registerReaderAnnotationMenu(pluginID));
  stack.use(await registerReaderPageMenu(pluginID));
  stack.defer(() => {
    logger.info("menus torn down");
  });
  logger.info("menus registered");
  return stack.move();
}
