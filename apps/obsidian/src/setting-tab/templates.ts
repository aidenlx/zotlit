import { Menu } from "obsidian";
import type {
  SettingControl,
  SettingDefinition,
  SettingDefinitionItem,
  Setting,
  SettingGroupItem,
} from "obsidian";

import { confirm } from "@/lib/confirm";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";
import type { AutoTrim } from "@/services/settings/schema";
import { openCitationTemplate } from "@/services/template/actions";
import { createSharedPartial } from "@/views/template-workbench/new-partial";
import { openTemplateWorkbench } from "@/views/template-workbench/register";

import { appendCompileError } from "./compile-error";
import type { SettingsKey, SettingTabContext } from "./context";
import { defaultPlaceholder } from "./placeholder";

const logger = getLogger(["setting-tab", "templates"]);

/** Auto-trim dropdown sentinel for "keep whitespace" (`false` isn't a string). */
const TRIM_KEEP = "keep";

export type AutoTrimKey =
  | "template.auto-trim-leading"
  | "template.auto-trim-trailing";

/** The two settings keys whose stored value uses the {@link TRIM_KEEP} sentinel. */
export const AUTO_TRIM_KEYS: ReadonlySet<SettingsKey> = new Set<AutoTrimKey>([
  "template.auto-trim-leading",
  "template.auto-trim-trailing",
]);

/** Map a stored {@link AutoTrim} to its dropdown string (`false` → `"keep"`). */
export function encodeAutoTrim(value: unknown): string {
  return value === "nl" || value === "slurp" ? value : TRIM_KEEP;
}

/** Map a dropdown string back to a stored {@link AutoTrim} (`"keep"` → `false`). */
export function decodeAutoTrim(value: unknown): AutoTrim {
  return value === "nl" || value === "slurp" ? value : false;
}

/**
 * The Advanced page's Template engine rows: the template folder, the
 * JavaScript Templates gate with its Eta editing options, and one row per
 * unrecognized file in the folder.
 */
export function templateEngineItems(
  ctx: SettingTabContext,
): SettingGroupItem<SettingsKey>[] {
  return [
    {
      name: m.settings_template_folder_name(),
      desc: m.settings_template_folder_desc(),
      control: {
        type: "folder",
        key: "template.folder",
        placeholder: defaultPlaceholder("template.folder"),
      },
    },
    {
      name: m.settings_template_js_enable_name(),
      desc: m.settings_template_js_enable_desc(),
      render: (setting) => renderJsTemplatesButton(setting, ctx),
    },
    {
      name: m.settings_template_trim_leading_name(),
      desc: m.settings_template_trim_desc(),
      visible: () => ctx.template.javascriptTemplatesEnabled,
      control: trimControl("template.auto-trim-leading"),
    },
    {
      name: m.settings_template_trim_trailing_name(),
      desc: m.settings_template_trim_desc(),
      visible: () => ctx.template.javascriptTemplatesEnabled,
      control: trimControl("template.auto-trim-trailing"),
    },
    ...unrecognizedFileItems(ctx),
  ];
}

/**
 * One row per `zotlit-` prefixed file in the template folder that answers to
 * no Template Document kind, so a misnamed file is named where the folder is
 * configured. Structural, for the reason {@link citationTextItems} gives.
 */
function unrecognizedFileItems(
  ctx: SettingTabContext,
): SettingDefinition<SettingsKey>[] {
  if (!ctx.template.loaded) return [];
  return ctx.template.getUnrecognizedFiles().map((path) => ({
    name: m.settings_template_unrecognized_name(),
    desc: m.settings_template_unrecognized_desc({ path }),
    searchable: false,
  }));
}

/**
 * The Literature note page's Partials list, mirroring the Profile list: an Add
 * partial row on the header, one row per partial with Open and a menu holding
 * Delete, and one row per partial file whose name another Template already
 * answers to. Rename stays an Obsidian file operation.
 *
 * Structural, for the reason {@link citationTextItems} gives.
 */
export function partialItems(
  ctx: SettingTabContext,
): SettingDefinitionItem<SettingsKey>[] {
  if (!ctx.template.loaded) return [];
  const partials = ctx.template.getPartialDocuments();
  return [
    {
      type: "list",
      heading: m.settings_partials_heading(),
      emptyState: m.settings_partials_empty_desc(),
      addItem: {
        name: m.settings_partial_add(),
        action: () => void addPartial(ctx),
      },
      items: partials.map((partial) => ({
        name: partial.name,
        desc: partial.path,
        searchable: false,
        render: (setting) => {
          setting.addButton((button) =>
            button
              .setIcon("pencil")
              .setTooltip(m.settings_partial_open())
              .onClick(() => {
                button.buttonEl.blur();
                void openPartial(ctx, partial.path);
              }),
          );
          setting.addExtraButton((button) =>
            button
              .setIcon("more-horizontal")
              .setTooltip(m.workbench_more_actions())
              .onClick(() => {
                const menu = new Menu();
                menu.addItem((item) =>
                  item
                    .setTitle(m.settings_partial_delete())
                    .setIcon("trash-2")
                    .setWarning(true)
                    .onClick(() => void deletePartial(ctx, partial)),
                );
                const bounds = button.extraSettingsEl.getBoundingClientRect();
                menu.showAtPosition({ x: bounds.left, y: bounds.bottom });
              }),
          );
        },
      })),
    },
    ...ctx.template.getReservedPartialFiles().map(({ name, path }) => ({
      name: m.settings_partial_reserved_name(),
      desc: m.settings_partial_reserved_desc({ name, path }),
      searchable: false,
    })),
  ];
}

/**
 * Add partial: the name prompt opens over settings, and settings closes only
 * once the document exists, the way `duplicateProfileToWorkbench` does. A
 * dismissed prompt leaves the reader on the page they started from.
 */
async function addPartial(ctx: SettingTabContext): Promise<void> {
  const name = await createSharedPartial(ctx.app, ctx.template, {
    open: false,
  });
  ctx.requestUpdate();
  if (name === null) return;
  const document = ctx.template.getPartialDocument(name);
  if (document) await openPartial(ctx, document.path);
}

async function openPartial(
  ctx: SettingTabContext,
  path: string,
): Promise<void> {
  const file = ctx.app.vault.getFileByPath(path);
  if (!file) return;
  ctx.app.setting.close();
  await openTemplateWorkbench(ctx.app, file, { explainUnsupported: false });
}

async function deletePartial(
  ctx: SettingTabContext,
  partial: { name: string; path: string },
): Promise<void> {
  try {
    const confirmed = await confirm(
      {
        title: m.settings_partial_delete_confirm_title(),
        content: m.settings_partial_delete_confirm_body({ path: partial.path }),
        action: m.settings_partial_delete(),
        destructive: true,
      },
      ctx.app,
    );
    if (!confirmed) return;
    await ctx.template.deletePartial(partial.name);
  } catch (error) {
    logger.error("Failed to delete a partial", { error, name: partial.name });
    new BaseNotice(m.notice_partial_delete_failed());
  } finally {
    ctx.requestUpdate();
  }
}

/**
 * The Citations page's Citation text row: Open edits `zotlit-citation.md`,
 * creating it from the built-in text when the vault holds none, and Reset
 * moves that document to trash.
 *
 * Structural, so it can't be deferred into a `render` callback the way the
 * row's own service reads are. The first `getSettingDefinitions()` runs from
 * `addSettingTab()`, before TemplateService finishes loading; the tab
 * re-renders this row on `ready` — see ZotLitSettingTab.
 */
export function citationTextItems(
  ctx: SettingTabContext,
): SettingDefinition<SettingsKey>[] {
  if (!ctx.template.loaded) return [];
  return [
    {
      name: m.settings_citation_text_name(),
      desc: m.settings_citation_text_desc(),
      render: (setting) => renderCitationTextRow(setting, ctx),
    },
  ];
}

/**
 * The Citation Template's own row. A vault with no `zotlit-citation.md` reads
 * "Using the built-in default" and offers Open alone; a customized one names
 * its file and adds Reset.
 */
function renderCitationTextRow(setting: Setting, ctx: SettingTabContext): void {
  const status = ctx.template.getCitationTemplateStatus();

  const desc = createFragment();
  desc.append(m.settings_citation_text_desc());
  desc.append(createEl("br"));
  if (status.customized) {
    const code = createEl("code");
    code.textContent = status.path;
    desc.append(code);
  } else {
    desc.append(m.settings_template_using_default());
  }
  if (status.inertPath) {
    const inert = createDiv();
    inert.className = "zt:mt-2 zt:text-(--text-warning)";
    inert.textContent = m.settings_template_inert_eta({
      path: status.inertPath,
    });
    desc.append(inert);
  }
  if (status.compileError) {
    appendCompileError(
      desc,
      status.compileError,
      m.settings_template_compile_error(),
    );
  }
  setting.setDesc(desc);

  setting.addButton((btn) =>
    btn
      .setIcon("pencil")
      .setTooltip(m.settings_citation_text_open())
      .onClick(() => {
        // Obsidian's setting-item reconciler skips re-rendering any row that
        // contains document.activeElement (to preserve focus mid-edit), so a
        // row whose button materialized the file would keep its old state.
        btn.buttonEl.blur();
        void openCitationTemplate(ctx.app, ctx.template).finally(() =>
          ctx.requestUpdate(),
        );
      }),
  );

  if (!status.customized) return;
  setting.addButton((btn) =>
    btn
      .setIcon("rotate-ccw")
      .setTooltip(m.settings_template_reset())
      .setDestructive()
      .onClick(() => {
        btn.buttonEl.blur();
        void resetCitationText(ctx, status.path);
      }),
  );
}

async function resetCitationText(
  ctx: SettingTabContext,
  path: string,
): Promise<void> {
  try {
    const confirmed = await confirm(
      {
        title: m.settings_citation_text_reset_confirm_title(),
        content: m.settings_citation_text_reset_confirm_body({ path }),
        action: m.settings_template_reset(),
        destructive: true,
      },
      ctx.app,
    );
    if (!confirmed) return;
    await ctx.template.restoreCitationTemplate();
    new BaseNotice(m.notice_citation_text_reset());
  } catch (error) {
    logger.error("Failed to reset the citation text", { error });
    new BaseNotice(m.notice_citation_text_reset_failed());
  } finally {
    ctx.requestUpdate();
  }
}

/**
 * Declarative dropdown for one auto-trim side. The stored value is
 * `false | "nl" | "slurp"`; the {@link TRIM_KEEP} sentinel bridges `false` to a
 * dropdown string in {@link ZotLitSettingTab}'s control encode/decode.
 */
function trimControl(key: AutoTrimKey): SettingControl<SettingsKey> {
  return {
    type: "dropdown",
    key,
    defaultValue: TRIM_KEEP,
    options: {
      [TRIM_KEEP]: m.settings_template_trim_disable(),
      nl: m.settings_template_trim_nl(),
      slurp: m.settings_template_trim_slurp(),
    },
  };
}

/**
 * Gate button for `TemplateService.javascriptTemplatesEnabled` — "Turn on" /
 * "Turn off" by current state. Bare `render` row (not a declarative `control`)
 * because the flag is per-device state on the service, not a `SettingsKey`.
 */
function renderJsTemplatesButton(
  setting: Setting,
  ctx: SettingTabContext,
): void {
  const service = ctx.template;
  const enabled = service.javascriptTemplatesEnabled;
  setting.addButton((btn) => {
    if (enabled) {
      btn.setButtonText(m.settings_template_js_turn_off());
    } else {
      btn.setButtonText(m.settings_template_js_turn_on()).setWarning();
    }
    btn.onClick(() => {
      // See the blur comment in renderEjectableRow's eject button: the
      // reconciler skips re-rendering the row containing document.activeElement.
      btn.buttonEl.blur();
      void applyJsTemplatesFlag(ctx, !enabled).finally(() =>
        ctx.requestUpdate(),
      );
    });
  });
}

/**
 * Disabling applies immediately. Enabling requires confirmation first, since
 * Eta templates then run with ZotLit's full JS access; declining leaves the
 * gate off and the trailing `requestUpdate` re-renders the button to match.
 */
async function applyJsTemplatesFlag(
  ctx: SettingTabContext,
  enabled: boolean,
): Promise<void> {
  const service = ctx.template;
  try {
    if (!enabled) {
      await service.setJavascriptTemplatesEnabled(false);
      return;
    }
    const confirmed = await confirm(
      {
        title: m.settings_template_js_confirm_title(),
        content: m.settings_template_js_confirm_body(),
        action: m.settings_template_js_confirm_action(),
        cta: true,
      },
      ctx.app,
    );
    if (confirmed) await service.setJavascriptTemplatesEnabled(true);
  } catch (error) {
    logger.error("Failed to change JavaScript templates flag", {
      enabled,
      error,
    });
  }
}
