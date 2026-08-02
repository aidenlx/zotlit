// ZotLit release policy and port wiring for the reusable Language Pack lifecycle.

import {
  createLanguagePackLifecycle,
  type LanguagePackLifecyclePorts,
  type PackSource,
} from "@zotlit/obsidian-i18n";

import { resourceReleaseUrl } from "./constants.js";
import { catalog } from "./i18n/generated/catalog.js";
import { runtime } from "./i18n/generated/runtime.js";
import { getLogger } from "./log.js";

const logger = getLogger("i18n");

/**
 * ZotLit's release policy: Language Packs are assets of the Resource Release
 * pinned to the running plugin version, so a build downloads the pack compiled
 * from its own message set.
 *
 * @see docs/adr/0019-runtime-assets-ship-on-a-parallel-resource-release.md
 */
const packSource = (pluginVersion: string): PackSource =>
  typeof __LANGUAGE_PACK_DEV_SERVER__ === "string"
    ? {
        baseUrl: __LANGUAGE_PACK_DEV_SERVER__,
        origin: new URL(__LANGUAGE_PACK_DEV_SERVER__).host,
      }
    : {
        baseUrl: resourceReleaseUrl(pluginVersion),
        origin: "github.com/aidenlx/zotlit",
      };

export type LanguagePackLifecycle = ReturnType<typeof initI18n>;

type InitI18nOptions = {
  pluginVersion: string;
  ports: LanguagePackLifecyclePorts;
};

export function initI18n({ pluginVersion, ports }: InitI18nOptions) {
  return createLanguagePackLifecycle({
    runtime,
    pluginVersion,
    namespace: "zotlit",
    catalog,
    source: packSource(pluginVersion),
    aliases: { zh: "zh-CN" },
    ports,
    logger,
  });
}
