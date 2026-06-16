import { join } from "node:path/posix";
import {
  type App,
  type SettingControl,
  type SettingDefinition,
  type SettingDefinitionItem,
  type Setting,
  type TFile,
} from "obsidian";

import { confirm } from "@/lib/confirm";
import { ensureFolder } from "@/lib/ensure-folder";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";
import * as m from "@/paraglide/messages";
import { type AutoTrim } from "@/services/settings/schema";
import {
  CANONICAL_NAMES,
  DEFAULT_NOTE_FILENAME,
  EMBEDDED_DEFAULTS,
  type TemplateName,
  toFilename,
} from "@/services/template/defaults";
import { normalizeVaultPath } from "@/services/template/path";

import { type SettingsKey, type SettingTabContext } from "./context";
import { frontmatterPageItems } from "./frontmatter";

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
  return [
    {
      name: m.settings_template_folder_name(),
      desc: m.settings_template_folder_desc(),
      control: {
        type: "folder",
        key: "template.folder",
        placeholder: "ZtTemplates",
      },
    },
    {
      type: "group",
      heading: m.settings_template_engine_heading(),
      items: [
        {
          name: m.settings_template_auto_pair_name(),
          desc: m.settings_template_auto_pair_desc(),
          control: { type: "toggle", key: "template.auto-pair-eta" },
        },
        {
          name: m.settings_template_trim_leading_name(),
          desc: m.settings_template_trim_desc(),
          control: trimControl("template.auto-trim-leading"),
        },
        {
          name: m.settings_template_trim_trailing_name(),
          desc: m.settings_template_trim_desc(),
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
          name: m.settings_template_filename_name(),
          desc: m.settings_template_filename_desc(),
          control: {
            type: "textarea",
            key: "template.filename",
            placeholder: DEFAULT_NOTE_FILENAME,
            rows: 3,
          },
        },
        {
          type: "page",
          name: m.settings_page_frontmatter(),
          desc: m.settings_page_frontmatter_desc(),
          items: frontmatterPageItems(ctx),
        },
        ...CANONICAL_NAMES.map(
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
 * One row per built-in template. A template is "ejected" when a vault file
 * exists at its path; {@link TemplateService} then loads it instead of the
 * embedded default. Ejected → open / reset; not ejected → eject.
 */
function renderEjectableRow(
  setting: Setting,
  ctx: SettingTabContext,
  name: TemplateName,
): void {
  const folder = currentFolder(ctx);
  const path = templatePath(folder, name);
  const file = ctx.app.vault.getFileByPath(path);

  const desc = document.createDocumentFragment();
  desc.append(TEMPLATE_META[name].desc());
  desc.append(document.createElement("br"));
  if (file) {
    const code = document.createElement("code");
    code.textContent = path;
    desc.append(code);
  } else {
    desc.append(m.settings_template_using_default());
  }
  setting.setDesc(desc);

  if (file) {
    setting
      .addButton((btn) =>
        btn
          .setIcon("pencil")
          .setTooltip(m.settings_template_open())
          .onClick(() => void openTemplate(ctx.app, file)),
      )
      .addButton((btn) =>
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
      )
      .addButton((btn) =>
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
      file = await ctx.app.vault.create(path, EMBEDDED_DEFAULTS[name]);
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
    await ctx.app.vault.modify(file, EMBEDDED_DEFAULTS[name]);
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
  const missing = CANONICAL_NAMES.filter(
    (name) => !ctx.app.vault.getFileByPath(templatePath(folder, name)),
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
          EMBEDDED_DEFAULTS[name],
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

function templatePath(folder: string, name: TemplateName): string {
  const file = toFilename(name)!;
  return folder === "" ? file : join(folder, file);
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
};
