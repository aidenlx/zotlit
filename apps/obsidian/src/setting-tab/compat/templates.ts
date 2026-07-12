import { type App, type Setting, type TFile } from "obsidian";

import { type TemplateLanguage } from "@zotlit/templates/facade";
import { type FrontmatterField } from "@zotlit/templates/frontmatter";

import { confirm } from "@/lib/confirm";
import { ensureFolder } from "@/lib/ensure-folder";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";
import * as m from "@/paraglide/messages";
import {
  DEFAULT_TEMPLATES,
  templatePath,
  TEMPLATE_NAMES,
  type TemplateName,
} from "@/services/template/defaults";
import { normalizeVaultPath } from "@/services/template/path";
import { appendCompileError } from "@/setting-tab/compile-error";
import { openFrontmatterFieldModal } from "@/setting-tab/frontmatter-modal";
import { frontmatterFieldLabel } from "@/setting-tab/frontmatter-strategy";
import { defaultPlaceholder } from "@/setting-tab/placeholder";

import { type CompatContext } from "./context";
import { sectionGroup } from "./group";

const logger = getLogger(["setting-tab", "compat", "templates"]);

/**
 * "Templates" section: template folder, the JavaScript templates gate and the
 * Eta engine toggles (auto-pair and the two auto-trim dropdowns), and the
 * ejectable template files including the note filename and the imperative
 * frontmatter-fields list.
 */
export function templatesSection(
  containerEl: HTMLElement,
  ctx: CompatContext,
): void {
  const group = sectionGroup(
    containerEl,
    m.settings_page_templates(),
    m.settings_page_templates_desc(),
  );

  // Pre-1.13 has no declarative `folder` control; a plain text input is the
  // faithful imperative fallback (loses the folder suggester autocomplete).
  group.addSetting((setting) =>
    setting
      .setName(m.settings_template_folder_name())
      .setDesc(m.settings_template_folder_desc())
      .addText((text) =>
        text
          .setPlaceholder(defaultPlaceholder("template.folder"))
          .setValue(ctx.settings.current?.["template.folder"] ?? "")
          .onChange((value) =>
            ctx.settings.update({ "template.folder": value }),
          ),
      ),
  );

  const engine = sectionGroup(group.listEl, m.settings_template_js_heading());
  engine.addSetting((setting) =>
    renderJsTemplatesButton(
      setting
        .setName(m.settings_template_js_enable_name())
        .setDesc(m.settings_template_js_enable_desc()),
      ctx,
    ),
  );
  if (ctx.plugin.services.template.javascriptTemplatesEnabled) {
    engine.addSetting((setting) =>
      setting
        .setName(m.settings_template_auto_pair_name())
        .setDesc(m.settings_template_auto_pair_desc())
        .addToggle((toggle) =>
          toggle
            .setValue(ctx.settings.current?.["template.auto-pair-eta"] ?? true)
            .onChange((value) =>
              ctx.settings.update({ "template.auto-pair-eta": value }),
            ),
        ),
    );
    engine.addSetting((setting) =>
      renderTrimRow(setting, ctx, "template.auto-trim-leading"),
    );
    engine.addSetting((setting) =>
      renderTrimRow(setting, ctx, "template.auto-trim-trailing"),
    );
  }

  const files = sectionGroup(
    group.listEl,
    m.settings_template_files_heading(),
  ).addExtraButton((btn) =>
    btn
      .setIcon("folder-output")
      .setTooltip(m.settings_template_eject_all())
      .onClick(() => void ejectAll(ctx)),
  );

  renderFrontmatterList(files.listEl, ctx);

  for (const name of TEMPLATE_NAMES) {
    files.addSetting((setting) =>
      renderEjectableRow(
        setting.setName(TEMPLATE_META[name].title()),
        ctx,
        name,
      ),
    );
  }
}

type AutoTrimKey = "template.auto-trim-leading" | "template.auto-trim-trailing";

/**
 * Auto-trim dropdown for one side. Stored value is `false | "nl" | "slurp"`;
 * the `"keep"` sentinel bridges `false` to a dropdown string.
 */
function renderTrimRow(
  setting: Setting,
  ctx: CompatContext,
  key: AutoTrimKey,
): void {
  const name =
    key === "template.auto-trim-leading"
      ? m.settings_template_trim_leading_name()
      : m.settings_template_trim_trailing_name();
  setting
    .setName(name)
    .setDesc(m.settings_template_trim_desc())
    .addDropdown((dropdown) => {
      const value = ctx.settings.current?.[key];
      dropdown
        .addOptions({
          keep: m.settings_template_trim_disable(),
          nl: m.settings_template_trim_nl(),
          slurp: m.settings_template_trim_slurp(),
        })
        .setValue(value === "nl" || value === "slurp" ? value : "keep")
        .onChange((next) =>
          ctx.settings.update({
            [key]: next === "nl" || next === "slurp" ? next : false,
          }),
        );
    });
}

/**
 * Gate button for `TemplateService.javascriptTemplatesEnabled` — "Turn on" /
 * "Turn off" by current state. Imperative mirror of the declarative
 * `renderJsTemplatesButton` in `setting-tab/templates.ts`.
 */
function renderJsTemplatesButton(setting: Setting, ctx: CompatContext): void {
  const service = ctx.plugin.services.template;
  const enabled = service.javascriptTemplatesEnabled;
  setting.addButton((btn) => {
    if (enabled) {
      btn.setButtonText(m.settings_template_js_turn_off());
    } else {
      btn.setButtonText(m.settings_template_js_turn_on()).setWarning();
    }
    btn.onClick(() => {
      btn.buttonEl.blur();
      void applyJsTemplatesFlag(ctx, !enabled).finally(() => ctx.rerender());
    });
  });
}

/**
 * Disabling applies immediately. Enabling requires confirmation first, since
 * Eta templates then run with ZotLit's full JS access; declining leaves the
 * gate off and the trailing `rerender` re-renders the button to match.
 */
async function applyJsTemplatesFlag(
  ctx: CompatContext,
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

// --- Frontmatter fields (imperative port of frontmatter.ts) -----------------

function renderFrontmatterList(
  containerEl: HTMLElement,
  ctx: CompatContext,
): void {
  const fields = ctx.settings.current?.["note.frontmatter-fields"] ?? [];

  const group = sectionGroup(containerEl, m.settings_note_frontmatter_heading())
    .addExtraButton((btn) =>
      btn
        .setIcon("rotate-ccw")
        .setTooltip(m.settings_note_frontmatter_reset())
        .onClick(() => {
          void confirm(
            {
              title: m.settings_note_frontmatter_reset_confirm_title(),
              content: m.settings_note_frontmatter_reset_confirm_body(),
              action: m.settings_note_frontmatter_reset(),
              destructive: true,
            },
            ctx.app,
          ).then(
            (yes) => yes && ctx.settings.reset(["note.frontmatter-fields"]),
          );
        }),
    )
    .addExtraButton((btn) =>
      btn
        .setIcon("plus")
        .setTooltip(m.settings_note_frontmatter_add())
        .onClick(() => openFieldModal(ctx, null)),
    );

  if (fields.length === 0) {
    group.addSetting((setting) =>
      setting.setDesc(m.settings_note_frontmatter_empty()),
    );
    return;
  }

  fields.forEach((field, index) => {
    group.addSetting((setting) =>
      setting
        .setName(frontmatterFieldLabel(field))
        .setDesc(describeField(ctx, field))
        .addExtraButton((btn) =>
          btn
            .setIcon("pencil")
            .setTooltip(m.settings_frontmatter_modal_edit_title())
            .onClick(() => openFieldModal(ctx, index)),
        )
        .addExtraButton((btn) =>
          btn
            .setIcon("trash-2")
            .setTooltip(m.settings_template_delete())
            .onClick(() => {
              deleteField(ctx, index);
              ctx.rerender();
            }),
        ),
    );
  });
}

/**
 * Show the expression, flagging it in red when it doesn't compile. The raw
 * parser error is left to the edit modal, where it can be fixed.
 */
function describeField(
  ctx: CompatContext,
  field: FrontmatterField,
): string | DocumentFragment {
  const { expr } = field;
  const service = ctx.plugin.services.template;
  const compileError = service.validateFrontmatterExpr(expr, field.language);
  const inert =
    field.language === "javascript" && !service.javascriptTemplatesEnabled;
  if (!inert && (!expr || !compileError)) return expr;
  const desc = document.createDocumentFragment();
  desc.append(expr);
  if (inert) {
    const note = document.createElement("div");
    note.className = "zt:mt-2 zt:text-(--text-warning)";
    note.textContent = m.settings_frontmatter_inert_js();
    desc.append(note);
  }
  if (expr && compileError) {
    const note = document.createElement("div");
    note.className = "zt:mt-2 zt:text-(--text-error)";
    note.textContent = m.settings_frontmatter_compile_error();
    desc.append(note);
  }
  return desc;
}

function openFieldModal(ctx: CompatContext, index: number | null): void {
  const fields = ctx.settings.current?.["note.frontmatter-fields"] ?? [];
  const field = index === null ? null : (fields[index] ?? null);
  const existingKeys = fields.filter((_, i) => i !== index).map((f) => f.key);
  const service = ctx.plugin.services.template;

  openFrontmatterFieldModal(ctx.app, {
    field,
    existingKeys,
    validateExpr: (expr, language) =>
      service.validateFrontmatterExpr(expr, language),
    javascriptTemplatesEnabled: service.javascriptTemplatesEnabled,
  }).then(
    (value) => {
      const next = [...fields];
      if (index === null) next.push(value);
      else next[index] = value;
      ctx.settings.update({ "note.frontmatter-fields": next });
      ctx.rerender();
    },
    () => {},
  );
}

function deleteField(ctx: CompatContext, index: number): void {
  const fields = [...(ctx.settings.current?.["note.frontmatter-fields"] ?? [])];
  fields.splice(index, 1);
  ctx.settings.update({ "note.frontmatter-fields": fields });
}

// --- Template files (imperative port of templates.ts helpers) ---------------

/**
 * One row per built-in template. A template is "ejected" when a vault file
 * exists at its path; `TemplateService` then loads it instead of the
 * embedded default. Ejected → open / reset; not ejected → eject.
 */
function renderEjectableRow(
  setting: Setting,
  ctx: CompatContext,
  name: TemplateName,
): void {
  const folder = currentFolder(ctx);
  const liquidFile = ctx.app.vault.getFileByPath(templatePath(folder, name));
  const etaFile = ctx.app.vault.getFileByPath(
    templatePath(folder, name, "eta"),
  );
  const file = liquidFile ?? etaFile;

  const compileError = ctx.plugin.services.template.compileErrors.get(name);
  const desc = document.createDocumentFragment();
  desc.append(TEMPLATE_META[name].desc());
  desc.append(document.createElement("br"));
  if (file) {
    const code = document.createElement("code");
    code.textContent = file.path;
    desc.append(code);
  } else {
    desc.append(m.settings_template_using_default());
  }
  const shadowedPath = ctx.plugin.services.template.shadowedFiles.get(name);
  if (shadowedPath) {
    const shadowed = document.createElement("div");
    shadowed.className = "zt:mt-2 zt:text-(--text-warning)";
    shadowed.textContent = m.settings_template_shadowed({
      path: shadowedPath,
    });
    desc.append(shadowed);
  }
  const inertPath = ctx.plugin.services.template.inertEtaFiles.get(name);
  if (inertPath) {
    const inert = document.createElement("div");
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
    // This section only runs on Obsidian < 1.13 (the declarative path owns
    // 1.13+), so the destructive-button styling must use `setWarning()` —
    // `setDestructive()` is @since 1.13.0 and throws `is not a function` here,
    // aborting the render and dropping every section below Templates.
    setting.addButton((btn) =>
      btn
        .setIcon("pencil")
        .setTooltip(m.settings_template_open())
        .onClick(() => void openTemplate(ctx.app, file)),
    );
    // Resetting overwrites with the Liquid default source, so it's only safe
    // to offer when the effective file is the Liquid one.
    if (file === liquidFile) {
      setting.addButton((btn) =>
        btn
          .setIcon("rotate-ccw")
          .setTooltip(m.settings_template_reset())
          .setWarning()
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
        .setWarning()
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
          btn.buttonEl.blur();
          void ejectAndRefresh(ctx, name);
        }),
    );
  }
}

/**
 * Toward Eta: trash the Liquid file (if any), then reveal a shadowed `.eta.md`
 * or create and open an empty one. Toward Liquid: trash the `.eta.md` and let
 * the name fall back to an existing Liquid file or the embedded default.
 * Nothing converts — dispatch, Liquid-wins precedence, and the watcher pick the
 * file change up as they would a manual edit. All removals go through
 * Obsidian's recoverable trash.
 */
async function switchLanguage(
  ctx: CompatContext,
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
      const created = await ctx.app.vault.create(etaPath, "");
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
    ctx.rerender();
  }
}

async function ejectAndRefresh(
  ctx: CompatContext,
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
    ctx.rerender();
  }
}

async function resetAndRefresh(
  ctx: CompatContext,
  file: TFile,
  name: TemplateName,
): Promise<void> {
  try {
    await ctx.app.vault.modify(file, DEFAULT_TEMPLATES[name]);
    new BaseNotice(m.notice_template_reset());
  } catch (error) {
    logger.error("Failed to reset template", { name, error });
    new BaseNotice(m.notice_template_reset_failed());
  } finally {
    ctx.rerender();
  }
}

async function deleteAndRefresh(
  ctx: CompatContext,
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
    ctx.rerender();
  }
}

async function ejectAll(ctx: CompatContext): Promise<void> {
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
    ctx.rerender();
  }
}

async function openTemplate(app: App, file: TFile): Promise<void> {
  await app.workspace.getLeaf(true).openFile(file);
}

function currentFolder(ctx: CompatContext): string {
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
