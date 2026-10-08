// Install and uninstall controls for the device-wide Chinese Segmenter binary.

import type { SettingDefinition } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";

import type { SettingsKey, SettingTabContext } from "./context";
import { managedBinaryDefinition } from "./managed-binary";

/** The segmenter row, in the Chinese Segmenter's own words. */
export function chineseSegmenterDefinition(
  ctx: SettingTabContext,
): SettingDefinition<SettingsKey> {
  return managedBinaryDefinition(ctx.chineseSegmenter, {
    id: "settings_chinese_segmenter",
    name: m.settings_chinese_segmenter_name(),
    desc: m.settings_chinese_segmenter_desc(),
    status: {
      absent: m.settings_chinese_segmenter_status_absent(),
      installing: m.settings_chinese_segmenter_status_installing(),
      installed: (version) =>
        m.settings_chinese_segmenter_status_installed({ version }),
      downloadFailed: (detail) =>
        m.settings_chinese_segmenter_status_download_failed({ detail }),
      hashMismatch: m.settings_chinese_segmenter_status_hash_mismatch(),
      initFailed: (detail) =>
        m.settings_chinese_segmenter_status_init_failed({ detail }),
    },
    actions: {
      install: m.settings_chinese_segmenter_install(),
      installing: m.settings_chinese_segmenter_installing(),
      retry: m.settings_chinese_segmenter_retry(),
      uninstall: m.settings_chinese_segmenter_uninstall(),
    },
    notices: {
      downloading: m.notice_chinese_segmenter_downloading(),
      installed: m.notice_chinese_segmenter_installed(),
      installFailed: m.notice_chinese_segmenter_install_failed(),
      removed: m.notice_chinese_segmenter_removed(),
      removeFailed: m.notice_chinese_segmenter_remove_failed(),
    },
  });
}
