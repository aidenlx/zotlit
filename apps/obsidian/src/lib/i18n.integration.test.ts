import { afterEach, expect, test } from "vitest";

import { LANGUAGE_PACK_LIMITS } from "@zotlit/obsidian-i18n";

import { catalog } from "./i18n/generated/catalog.js";
import basePack from "./i18n/generated/en.json";
import * as m from "./i18n/generated/messages.js";
import { runtime } from "./i18n/generated/runtime.js";

// Turbo generates these artifacts before testing; compiler mechanics are
// covered in @zotlit/obsidian-i18n. Check the plugin's actual build output here.
afterEach(() => runtime.reset());

test("the plugin pack contains its shared labels and fits the runtime cap", () => {
  expect(basePack.messages).not.toHaveProperty("docs_index_title");
  // The web Workbench's strings belong to the docs catalog, so the plugin pack
  // leaves them out.
  expect(basePack.messages).not.toHaveProperty("workbench_title");
  expect(basePack.messages).not.toHaveProperty(["zotero.menu_file.label"]);
  expect(basePack.messages).toHaveProperty(["zotero.prefs_notify_section"]);
  // A pack over the cap is refused at runtime, and copy another host owns is
  // what fills it. Add the new prefix to EXCLUDE_MESSAGE_PREFIXES when this
  // fails for messages the plugin never reads.
  expect(Object.keys(basePack.messages).length).toBeLessThanOrEqual(
    LANGUAGE_PACK_LIMITS.messages,
  );
  expect(catalog).toEqual({
    baseLocale: "en",
    packs: { "zh-CN": { fileName: "zh-CN.json" } },
  });
});

test("the generated facade renders bundled lifecycle copy and base-locale fallback", () => {
  expect(m.hello()).toBe("world");
  // Lifecycle copy renders in the target language from the bundled subset,
  // with no Language Pack installed and no network access.
  expect(m.settings_language_pack_name()).toBe("Language pack");
  runtime.setTargetLocale("zh-CN");
  expect(m.settings_language_pack_name()).toBe("语言包");
  expect(m.settings_language_pack_desc({ language: "简体中文" })).toBe(
    "以 简体中文 显示 ZotLit 界面。安装时将下载语言包。",
  );
  // Everything outside the configured prefixes keeps the existing ladder.
  expect(m.hello()).toBe("world");
  expect(m.creator_summary({ count: 3, first: "Ada" })).toBe("Ada et al.");
});
