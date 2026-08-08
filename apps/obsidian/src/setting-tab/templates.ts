import type {
  App,
  SettingControl,
  SettingDefinition,
  SettingDefinitionItem,
  Setting,
  TFile,
} from "obsidian";

import type { TemplateLanguage } from "@zotlit/templates/facade";

import { confirm } from "@/lib/confirm";
import { ensureFolder } from "@/lib/ensure-folder";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";
import type { AutoTrim } from "@/services/settings/schema";
import {
  DEFAULT_TEMPLATES,
  DEFAULT_TEMPLATES_ETA,
  templateFileFromPath,
  templatePath,
  TEMPLATE_NAMES,
} from "@/services/template/defaults";
import type { TemplateName } from "@/services/template/defaults";
import { normalizeVaultPath } from "@/services/template/path";

import { appendCompileError } from "./compile-error";
import type { SettingsKey, SettingTabContext } from "./context";
import { frontmatterPageItems } from "./frontmatter";
import { defaultPlaceholder } from "./placeholder";
import { migrationReminderItem } from "./resources";

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

/** Items for the "Templates" sub-page. */
export function templatesPageItems(
  ctx: SettingTabContext,
): SettingDefinitionItem<SettingsKey>[] {
  const pending = ctx.settings.current?.["release.migration-pending"] === true;
  return [
    // Included structurally, not via `visible` — see migrationReminderItem's
    // JSDoc for why.
    ...(pending ? [migrationReminderItem(ctx)] : []),
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
      type: "group",
      heading: m.settings_template_js_heading(),
      items: [
        {
          name: m.settings_template_js_enable_name(),
          desc: m.settings_template_js_enable_desc(),
          render: (setting) => renderJsTemplatesButton(setting, ctx),
        },
        {
          name: m.settings_template_auto_pair_name(),
          desc: m.settings_template_auto_pair_desc(),
          visible: () =>
            ctx.plugin.services.template.javascriptTemplatesEnabled,
          control: { type: "toggle", key: "template.auto-pair-eta" },
        },
        {
          name: m.settings_template_trim_leading_name(),
          desc: m.settings_template_trim_desc(),
          visible: () =>
            ctx.plugin.services.template.javascriptTemplatesEnabled,
          control: trimControl("template.auto-trim-leading"),
        },
        {
          name: m.settings_template_trim_trailing_name(),
          desc: m.settings_template_trim_desc(),
          visible: () =>
            ctx.plugin.services.template.javascriptTemplatesEnabled,
          control: trimControl("template.auto-trim-trailing"),
        },
      ],
    },
    {
      type: "group",
      heading: m.settings_template_files_heading(),
      extraButtons: [
        (btn) =>
          btn
            .setIcon("folder-output")
            .setTooltip(m.settings_template_eject_all())
            .onClick(() => void ejectAll(ctx)),
      ],
      items: [
        {
          type: "page",
          name: m.settings_page_frontmatter(),
          desc: m.settings_page_frontmatter_desc(),
          items: frontmatterPageItems(ctx),
        },
        ...TEMPLATE_NAMES.map(
          (name): SettingDefinition<SettingsKey> => ({
            name: TEMPLATE_META[name].title(),
            desc: TEMPLATE_META[name].desc(),
            render: (setting) => renderEjectableRow(setting, ctx, name),
          }),
        ),
      ],
    },
  ];
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
  const service = ctx.plugin.services.template;
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
  const service = ctx.plugin.services.template;
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

/**
 * One row per built-in template. A template is "ejected" when a vault file
 * exists at its path; `TemplateService` then loads it instead of the
 * embedded default. Ejected → open / reset; not ejected → eject.
 */
function renderEjectableRow(
  setting: Setting,
  ctx: SettingTabContext,
  name: TemplateName,
): void {
  const folder = currentFolder(ctx);
  const liquidFile = ctx.app.vault.getFileByPath(templatePath(folder, name));
  const etaFile = ctx.app.vault.getFileByPath(
    templatePath(folder, name, "eta"),
  );
  const file = liquidFile ?? etaFile;

  const compileError =
    ctx.plugin.services.template.compileErrors.get(name)?.message;
  const desc = createFragment();
  desc.append(TEMPLATE_META[name].desc());
  desc.append(createEl("br"));
  if (file) {
    const code = createEl("code");
    code.textContent = file.path;
    desc.append(code);
  } else {
    desc.append(m.settings_template_using_default());
  }
  const shadowedPath = ctx.plugin.services.template.shadowedFiles.get(name);
  if (shadowedPath) {
    const shadowed = createDiv();
    shadowed.className = "zt:mt-2 zt:text-(--text-warning)";
    shadowed.textContent = m.settings_template_shadowed({
      path: shadowedPath,
    });
    desc.append(shadowed);
  }
  const inertPath = ctx.plugin.services.template.inertEtaFiles.get(name);
  if (inertPath) {
    const inert = createDiv();
    inert.className = "zt:mt-2 zt:text-(--text-warning)";
    inert.textContent = m.settings_template_inert_eta({ path: inertPath });
    desc.append(inert);
  }
  if (compileError) {
    appendCompileError(desc, compileError, m.settings_template_compile_error());
  }
  setting.setDesc(desc);

  const gate = ctx.plugin.services.template.javascriptTemplatesEnabled;
  const showLanguage = gate || (etaFile !== null && liquidFile === null);
  if (showLanguage) {
    const currentLanguage: TemplateLanguage = liquidFile
      ? "liquid"
      : etaFile
        ? "eta"
        : "liquid";
    setting.addDropdown((dropdown) => {
      // Gate off, the row is an inert `.eta.md`: list Eta first as the current
      // value and Liquid as the only switch target; gate on, Liquid leads as
      // the default language.
      dropdown
        .addOptions(
          gate
            ? {
                liquid: m.settings_template_language_liquid(),
                eta: m.settings_template_language_eta(),
              }
            : {
                eta: m.settings_template_language_eta(),
                liquid: m.settings_template_language_liquid(),
              },
        )
        .setValue(currentLanguage)
        .onChange((value) => {
          dropdown.selectEl.blur();
          void switchLanguage(ctx, name, value as TemplateLanguage);
        });
      dropdown.selectEl.setAttr(
        "aria-label",
        m.settings_template_language_tooltip(),
      );
    });
  }

  if (file) {
    setting.addButton((btn) =>
      btn
        .setIcon("pencil")
        .setTooltip(m.settings_template_open())
        .onClick(() => void openTemplate(ctx.app, file)),
    );
    // Reset overwrites with the default source of the file's own edition. An
    // Eta row resets only while JavaScript Templates is on; a lone inert
    // `.eta.md` offers the toward-Liquid dropdown instead. Liquid reset is
    // gate-independent.
    if (file === liquidFile || (file === etaFile && gate)) {
      setting.addButton((btn) =>
        btn
          .setIcon("rotate-ccw")
          .setTooltip(m.settings_template_reset())
          .setDestructive()
          .onClick(() => {
            btn.buttonEl.blur();
            void confirm(
              {
                title: m.settings_template_reset_confirm_title(),
                content: m.settings_template_reset_confirm_body({
                  name: TEMPLATE_META[name].title(),
                }),
                action: m.settings_template_reset(),
                destructive: true,
              },
              ctx.app,
            )
              .then(async (yes) => {
                if (!yes) return;
                await resetAndRefresh(ctx, file, name);
              })
              .catch((err) => {
                logger.error("Failed to reset template", { name, error: err });
              });
          }),
      );
    }
    setting.addButton((btn) =>
      btn
        .setIcon("trash-2")
        .setTooltip(m.settings_template_delete())
        .setDestructive()
        .onClick(() => {
          btn.buttonEl.blur();
          void confirm(
            {
              title: m.settings_template_delete_confirm_title(),
              content: m.settings_template_delete_confirm_body({
                name: TEMPLATE_META[name].title(),
              }),
              action: m.settings_template_delete(),
              destructive: true,
            },
            ctx.app,
          )
            .then(async (yes) => {
              if (!yes) return;
              await deleteAndRefresh(ctx, file, name);
            })
            .catch((err) => {
              logger.error("Failed to delete template", { name, error: err });
            });
        }),
    );
  } else {
    setting.addButton((btn) =>
      btn
        .setIcon("file-pen")
        .setTooltip(m.settings_template_eject())
        .onClick(() => {
          // Obsidian's setting-item reconciler skips re-rendering any row that
          // contains document.activeElement (to preserve focus mid-edit). The
          // clicked button lives in this row, so without blurring, requestUpdate()
          // refreshes every ejectable row except this one — leaving it stuck on
          // the pre-eject state. Blur first so the row re-runs its render.
          btn.buttonEl.blur();
          void ejectAndRefresh(ctx, name);
        }),
    );
  }
}

/**
 * Toward Eta: trash the Liquid file (if any), then reveal a shadowed `.eta.md`
 * or create one from the embedded Eta default and open it. Toward Liquid: trash
 * the `.eta.md` and let the name fall back to an existing Liquid file or the
 * embedded default.
 * Nothing converts — dispatch, Liquid-wins precedence, and the watcher pick the
 * file change up as they would a manual edit. All removals go through
 * Obsidian's recoverable trash.
 */
async function switchLanguage(
  ctx: SettingTabContext,
  name: TemplateName,
  target: TemplateLanguage,
): Promise<void> {
  const folder = currentFolder(ctx);
  const etaPath = templatePath(folder, name, "eta");
  const liquidFile = ctx.app.vault.getFileByPath(templatePath(folder, name));
  const etaFile = ctx.app.vault.getFileByPath(etaPath);
  const service = ctx.plugin.services.template;
  try {
    if (target === "eta") {
      // Gate-off invariant: never create or reveal an Eta file on a device
      // that has not consented to JavaScript templates.
      if (!service.javascriptTemplatesEnabled) return;
      if (liquidFile) {
        const yes = await confirm(
          {
            title: m.settings_template_switch_eta_confirm_title(),
            content: m.settings_template_switch_eta_confirm_body({
              name: TEMPLATE_META[name].title(),
              path: liquidFile.path,
            }),
            action: m.settings_template_switch_action(),
            destructive: true,
          },
          ctx.app,
        );
        if (!yes) return;
        await ctx.app.fileManager.trashFile(liquidFile);
        if (etaFile) return;
      } else if (etaFile) {
        return;
      }
      await ensureFolder(ctx.app, folder);
      const created = await ctx.app.vault.create(
        etaPath,
        DEFAULT_TEMPLATES_ETA[name],
      );
      await openTemplate(ctx.app, created);
    } else {
      if (!etaFile) return;
      const yes = await confirm(
        {
          title: m.settings_template_switch_liquid_confirm_title(),
          content: m.settings_template_switch_liquid_confirm_body({
            name: TEMPLATE_META[name].title(),
            path: etaFile.path,
          }),
          action: m.settings_template_switch_action(),
          destructive: true,
        },
        ctx.app,
      );
      if (!yes) return;
      await ctx.app.fileManager.trashFile(etaFile);
    }
  } catch (error) {
    logger.error("Failed to switch template language", {
      name,
      target,
      error,
    });
    new BaseNotice(m.notice_template_switch_failed());
  } finally {
    ctx.requestUpdate();
  }
}

async function ejectAndRefresh(
  ctx: SettingTabContext,
  name: TemplateName,
): Promise<void> {
  const folder = currentFolder(ctx);
  const path = templatePath(folder, name);
  try {
    let file = ctx.app.vault.getFileByPath(path);
    if (!file) {
      await ensureFolder(ctx.app, folder);
      file = await ctx.app.vault.create(path, DEFAULT_TEMPLATES[name]);
    }
    new BaseNotice(m.notice_template_ejected({ path }));
    await openTemplate(ctx.app, file);
  } catch (error) {
    logger.error("Failed to eject template", { name, path, error });
    new BaseNotice(m.notice_template_eject_failed());
  } finally {
    ctx.requestUpdate();
  }
}

async function resetAndRefresh(
  ctx: SettingTabContext,
  file: TFile,
  name: TemplateName,
): Promise<void> {
  try {
    const templateFile = templateFileFromPath(file.path);
    if (!templateFile) throw new Error(`Invalid template path: ${file.path}`);
    const source =
      templateFile.language === "eta"
        ? DEFAULT_TEMPLATES_ETA[name]
        : DEFAULT_TEMPLATES[name];
    await ctx.app.vault.modify(file, source);
    new BaseNotice(m.notice_template_reset());
  } catch (error) {
    logger.error("Failed to reset template", { name, error });
    new BaseNotice(m.notice_template_reset_failed());
  } finally {
    ctx.requestUpdate();
  }
}

async function deleteAndRefresh(
  ctx: SettingTabContext,
  file: TFile,
  name: TemplateName,
): Promise<void> {
  try {
    await ctx.app.fileManager.trashFile(file);
    new BaseNotice(m.notice_template_deleted());
  } catch (error) {
    logger.error("Failed to delete template", { name, error });
    new BaseNotice(m.notice_template_delete_failed());
  } finally {
    ctx.requestUpdate();
  }
}

async function ejectAll(ctx: SettingTabContext): Promise<void> {
  const folder = currentFolder(ctx);
  // A name only counts as missing when neither extension's file exists —
  // ejecting a `.liquid.md` on top of a user's `.eta.md` override would
  // silently shadow it.
  const missing = TEMPLATE_NAMES.filter(
    (name) =>
      !ctx.app.vault.getFileByPath(templatePath(folder, name)) &&
      !ctx.app.vault.getFileByPath(templatePath(folder, name, "eta")),
  );
  if (missing.length === 0) {
    new BaseNotice(m.notice_template_eject_none());
    return;
  }
  try {
    await ensureFolder(ctx.app, folder);
    await Promise.all(
      missing.map((name) =>
        ctx.app.vault.create(
          templatePath(folder, name),
          DEFAULT_TEMPLATES[name],
        ),
      ),
    );
    new BaseNotice(m.notice_template_eject_all());
  } catch (error) {
    logger.error("Failed to eject all templates", { error });
    new BaseNotice(m.notice_template_eject_failed());
  } finally {
    ctx.requestUpdate();
  }
}

async function openTemplate(app: App, file: TFile): Promise<void> {
  await app.workspace.getLeaf(true).openFile(file);
}

function currentFolder(ctx: SettingTabContext): string {
  return normalizeVaultPath(ctx.settings.current?.["template.folder"] ?? "");
}

const TEMPLATE_META: Record<
  TemplateName,
  { title: () => string; desc: () => string }
> = {
  note: {
    title: () => m.settings_template_name_note(),
    desc: () => m.settings_template_desc_note(),
  },
  annotation: {
    title: () => m.settings_template_name_annotation(),
    desc: () => m.settings_template_desc_annotation(),
  },
  content: {
    title: () => m.settings_template_name_content(),
    desc: () => m.settings_template_desc_content(),
  },
  cite: {
    title: () => m.settings_template_name_cite(),
    desc: () => m.settings_template_desc_cite(),
  },
  cite2: {
    title: () => m.settings_template_name_cite2(),
    desc: () => m.settings_template_desc_cite2(),
  },
  filename: {
    title: () => m.settings_template_name_filename(),
    desc: () => m.settings_template_desc_filename(),
  },
};
