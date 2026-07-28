// ZotLit release policy and port wiring for the reusable Language Pack lifecycle.

import {
  createLanguagePackLifecycle,
  type LanguagePackLifecyclePorts,
} from "@zotlit/obsidian-i18n";

import { catalog } from "./i18n/generated/catalog.js";
import { runtime } from "./i18n/generated/runtime.js";
import { getLogger } from "./log.js";

const logger = getLogger("i18n");

/** ZotLit's release policy: Language Packs ship as GitHub release assets. */
const ZOTLIT_PACK_SOURCE = {
  baseUrl: "https://github.com/aidenlx/zotlit/releases/download/language-packs",
  origin: "github.com/aidenlx/zotlit",
};

const source =
  typeof __LANGUAGE_PACK_DEV_SERVER__ === "string"
    ? {
        baseUrl: __LANGUAGE_PACK_DEV_SERVER__,
        origin: new URL(__LANGUAGE_PACK_DEV_SERVER__).host,
      }
    : ZOTLIT_PACK_SOURCE;

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
    source,
    aliases: { zh: "zh-CN" },
    ports,
    logger,
  });
}
