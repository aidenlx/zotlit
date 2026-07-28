// Framework-agnostic copy and visibility rule for the Language Pack setting,
// shared by the declarative (1.13+) and imperative (compat) setting tabs. The
// item exists only to get a pack installed, so it appears exactly while one is
// available and not yet active. Copy names the language by its Endonym, never
// the artifact or its origin — those stay in the logs.

import { type LanguagePackLifecycle } from "@/lib/i18n";
import * as m from "@/lib/i18n/generated/messages";

import { installLanguagePack } from "./install-toast";

export type LanguagePackSettingCopy = {
  name: string;
  desc: string;
  /** Absent once only a restart is pending, nothing being left to install. */
  install?: {
    label: string;
    /**
     * True while the download it started is in flight. The button stays
     * labelled rather than being dropped — a row whose control disappears
     * mid-action collapses to an empty slot, reading as a broken button.
     */
    disabled: boolean;
    run(): void;
  };
};

/**
 * Presentation for the Language Pack setting, or `undefined` when the item is
 * hidden — either no pack ships for the resolved locale, or the installed pack
 * is already running.
 */
export function languagePackSettingCopy(
  lifecycle: LanguagePackLifecycle,
): LanguagePackSettingCopy | undefined {
  const situation = lifecycle.getSituation();
  const { endonym } = lifecycle;
  const name = m.settings_language_pack_name();
  // `install()` returns the in-flight promise, so the disabled button's action
  // stays the real one rather than a stand-in that could never run.
  const install = (disabled: boolean): LanguagePackSettingCopy["install"] => ({
    label: m.notice_language_pack_install_action(),
    disabled,
    run: () => installLanguagePack(lifecycle),
  });

  switch (situation.kind) {
    case "unavailable":
    case "active":
      return undefined;
    case "restart-pending":
      return { name, desc: m.notice_language_pack_restart() };
    case "downloading":
      return {
        name,
        desc: m.notice_language_pack_downloading(),
        install: install(true),
      };
    case "offered":
    case "installable":
      return {
        name,
        desc: m.settings_language_pack_desc({ language: endonym }),
        install: install(false),
      };
  }
}
