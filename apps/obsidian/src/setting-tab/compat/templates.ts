import { type App, type Setting, type TFile } from "obsidian";

import { validateFrontmatterExpr } from "@zotlit/templates/frontmatter";

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
 * "Templates" section: template folder, the Eta engine toggles (auto-pair and
 * the two auto-trim dropdowns), and the ejectable template files including the
 * note filename and the imperative frontmatter-fields list.
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

  const engine = sectionGroup(
    group.listEl,
    m.settings_template_engine_heading(),
  );
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

  const files = sectionGroup(
    group.listEl,
    m.settings_template_files_heading(),
  ).addExtraButton((btn) =>
    btn
      .setIcon("folder-output")
      .setTooltip(m.settings_template_eject_all())
      .onClick(() => void ejectAll(ctx)),
  );

  files.addSetting((setting) =>
    renderFilenameRow(
      setting
        .setName(m.settings_template_filename_name())
        .setDesc(m.settings_template_filename_desc()),
      ctx,
    ),
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
        .setDesc(describeField(field.expr))
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

/** Show the expression, flagging it in red when it doesn't compile. The raw
 *  parser error is left to the edit modal, where it can be fixed. */
function describeField(expr: string): string | DocumentFragment {
  if (!expr || !validateFrontmatterExpr(expr)) return expr;
  const desc = document.createDocumentFragment();
  desc.append(expr);
  const note = document.createElement("div");
  note.className = "zt:mt-2 zt:text-(--text-error)";
  note.textContent = m.settings_frontmatter_compile_error();
  desc.append(note);
  return desc;
}

function openFieldModal(ctx: CompatContext, index: number | null): void {
  const fields = ctx.settings.current?.["note.frontmatter-fields"] ?? [];
  const field = index === null ? null : (fields[index] ?? null);
  const existingKeys = fields.filter((_, i) => i !== index).map((f) => f.key);

  openFrontmatterFieldModal(ctx.app, { field, existingKeys }).then(
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
  const path = templatePath(folder, name);
  const file = ctx.app.vault.getFileByPath(path);

  const compileError = ctx.plugin.services.template.compileErrors.get(name);
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
  if (compileError) {
    appendCompileError(desc, compileError, m.settings_template_compile_error());
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
          btn.buttonEl.blur();
          void ejectAndRefresh(ctx, name);
        }),
    );
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
  const missing = TEMPLATE_NAMES.filter(
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

function renderFilenameRow(setting: Setting, ctx: CompatContext): void {
  const { template } = ctx.plugin.services;
  const saved = ctx.settings.current?.["template.filename"] ?? "";
  const filenameError = template.filenameError;

  if (filenameError) {
    const desc = document.createDocumentFragment();
    desc.append(m.settings_template_filename_desc());
    appendCompileError(
      desc,
      filenameError,
      m.settings_template_compile_error(),
    );
    setting.setDesc(desc);
  }

  setting.addTextArea((ta) => {
    ta.setPlaceholder(defaultPlaceholder("template.filename"));
    ta.setValue(saved);
    ta.inputEl.rows = 3;
  });

  setting.addExtraButton((btn) => {
    btn
      .setIcon("check")
      .setTooltip(m.settings_frontmatter_save())
      .onClick(() => {
        const textarea = setting.controlEl.querySelector("textarea");
        if (!textarea) return;

        const value = textarea.value.trim();
        const error = value ? template.validateSource(value) : null;

        if (error) {
          const desc = document.createDocumentFragment();
          desc.append(m.settings_template_filename_desc());
          appendCompileError(desc, error, m.settings_template_compile_error());
          setting.setDesc(desc);
          return;
        }

        ctx.settings.update({ "template.filename": value });
      });
  });
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
