import { Effect } from "effect";
import { Menu } from "obsidian";
import type {
  SettingControl,
  SettingDefinition,
  SettingDefinitionItem,
  Setting,
  SettingGroupItem,
} from "obsidian";

import { awaitConfirm } from "@/lib/confirm";
import { awaitModal } from "@/lib/effect-modal";
import * as m from "@/lib/i18n/generated/messages";
import { portCall } from "@/lib/legacy-port";
import { showMenuAtButton } from "@/lib/menu";
import { Notifier } from "@/lib/notifier";
import { Vault } from "@/lib/obsidian-vault";
import { leaveSettingsFor } from "@/lib/plugin-host";
import type { AutoTrim } from "@/services/settings/schema";
import { Template } from "@/services/template/service";
import { openNewPartialPrompt } from "@/views/template-workbench/new-partial";
import { openTemplateWorkbench } from "@/views/template-workbench/register";

import { appendCompileError } from "./compile-error";
import type { SettingsKey, SettingTabContext } from "./context";
import { SettingTab } from "./effect-tab";
import { defaultPlaceholder } from "./placeholder";

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

/** Rebuild the definitions once a row's action has run. */
const rebuild = SettingTab.use((tab) => tab.update);

/** Whether JavaScript Templates are on, for a row's `visible` predicate. */
function javascriptTemplatesEnabled(ctx: SettingTabContext): () => boolean {
  return () =>
    ctx.tab.sync(
      Template.use((template) => template.javascriptTemplatesEnabled),
    );
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
      id: "settings_template_folder",
      name: m.settings_template_folder_name(),
      desc: m.settings_template_folder_desc(),
      control: {
        type: "folder",
        key: "template.folder",
        placeholder: defaultPlaceholder("template.folder"),
      },
    },
    {
      id: "settings_template_js_enable",
      name: m.settings_template_js_enable_name(),
      desc: m.settings_template_js_enable_desc(),
      render: (setting) => renderJsTemplatesButton(setting, ctx),
    },
    {
      id: "settings_template_trim_leading",
      name: m.settings_template_trim_leading_name(),
      desc: m.settings_template_trim_desc(),
      visible: javascriptTemplatesEnabled(ctx),
      control: trimControl("template.auto-trim-leading"),
    },
    {
      id: "settings_template_trim_trailing",
      name: m.settings_template_trim_trailing_name(),
      desc: m.settings_template_trim_desc(),
      visible: javascriptTemplatesEnabled(ctx),
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
  const files = ctx.tab.sync(
    Effect.gen(function* () {
      const template = yield* Template;
      return (yield* template.loaded)
        ? yield* template.getUnrecognizedFiles
        : [];
    }),
  );
  return files.map((path) => ({
    id: `settings_template_unrecognized:${path}`,
    name: m.settings_template_unrecognized_name(),
    desc: m.settings_template_unrecognized_desc({ path }),
    searchable: false,
  }));
}

/**
 * The Profiles page's Partials list, mirroring the Profile list: an Add
 * partial row on the header, one row per partial with Open and a menu holding
 * Delete, and one row per partial file whose name another Template already
 * answers to. Rename stays an Obsidian file operation.
 *
 * A vault shares a partial between Profiles, so it belongs beside them rather
 * than on the main page, which is the default Profile alone.
 *
 * Structural, for the reason {@link citationTextItems} gives.
 */
export function partialItems(
  ctx: SettingTabContext,
): SettingDefinitionItem<SettingsKey>[] {
  const documents = ctx.tab.sync(
    Effect.gen(function* () {
      const template = yield* Template;
      if (!(yield* template.loaded)) return undefined;
      return {
        partials: yield* template.getPartialDocuments,
        reserved: yield* template.getReservedPartialFiles,
      };
    }),
  );
  if (!documents) return [];
  const { partials, reserved } = documents;
  return [
    {
      type: "list",
      id: "settings_partials",
      heading: m.settings_partials_heading(),
      emptyState: m.settings_partials_empty_desc(),
      addItem: {
        name: m.settings_partial_add(),
        action: () =>
          void ctx.tab.run(addPartial(ctx), m.settings_failed_partial_create()),
      },
      items: partials.map((partial) => ({
        id: `settings_partial_entry:${partial.path}`,
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
                void ctx.tab.run(
                  openPartial(ctx, partial.path),
                  m.settings_failed_partial_open(),
                );
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
                    .onClick(
                      () =>
                        void ctx.tab.run(
                          deletePartial(ctx, partial),
                          m.settings_failed_partial_delete(),
                        ),
                    ),
                );
                showMenuAtButton(menu, button.extraSettingsEl);
              }),
          );
        },
      })),
    },
    ...reserved.map(({ name, path }) => ({
      id: `settings_partial_reserved:${path}`,
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
function addPartial(ctx: SettingTabContext) {
  return Effect.gen(function* () {
    const template = yield* Template;
    const taken = yield* template.getPartialNames;
    const name = yield* awaitModal<string | null>((settle) =>
      openNewPartialPrompt(ctx.app, taken, settle),
    );
    if (name === null) return;
    yield* template.createPartial(name);
    const document = yield* template.getPartialDocument(name);
    if (document) yield* openPartial(ctx, document.path);
  }).pipe(Effect.ensuring(rebuild));
}

function openPartial(ctx: SettingTabContext, path: string) {
  return Effect.gen(function* () {
    const file = yield* (yield* Vault).getFileByPath(path);
    if (!file) return;
    yield* leaveSettingsFor("open-template-workbench", () =>
      openTemplateWorkbench(ctx.app, file, { explainUnsupported: false }),
    );
  });
}

function deletePartial(
  ctx: SettingTabContext,
  partial: { name: string; path: string },
) {
  return Effect.gen(function* () {
    const confirmed = yield* awaitConfirm(
      {
        title: m.settings_partial_delete_confirm_title(),
        content: m.settings_partial_delete_confirm_body({ path: partial.path }),
        action: m.settings_partial_delete(),
        destructive: true,
      },
      ctx.app,
    );
    if (!confirmed) return;
    yield* (yield* Template).deletePartial(partial.name);
  }).pipe(Effect.ensuring(rebuild));
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
  if (!ctx.tab.sync(Template.use((template) => template.loaded))) return [];
  return [
    {
      id: "settings_citation_text",
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
  const status = ctx.tab.sync(
    Template.use((template) => template.getCitationTemplateStatus),
  );

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
        void ctx.tab.run(
          openCitationText(ctx),
          m.settings_failed_citation_text_open(),
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
        void ctx.tab.run(
          resetCitationText(ctx, status.path),
          m.settings_failed_citation_text_reset(),
        );
      }),
  );
}

/**
 * Open the Citation Template in the Template Workbench View, creating its
 * document from the built-in citation text when the vault holds none.
 */
function openCitationText(ctx: SettingTabContext) {
  return Effect.gen(function* () {
    const file = yield* (yield* Template).materializeCitationTemplate;
    yield* portCall("open-template-workbench", () =>
      openTemplateWorkbench(ctx.app, file, { explainUnsupported: false }),
    );
  }).pipe(Effect.ensuring(rebuild));
}

function resetCitationText(ctx: SettingTabContext, path: string) {
  return Effect.gen(function* () {
    const confirmed = yield* awaitConfirm(
      {
        title: m.settings_citation_text_reset_confirm_title(),
        content: m.settings_citation_text_reset_confirm_body({ path }),
        action: m.settings_template_reset(),
        destructive: true,
      },
      ctx.app,
    );
    if (!confirmed) return;
    yield* (yield* Template).restoreCitationTemplate;
    yield* (yield* Notifier).show(m.notice_citation_text_reset());
  }).pipe(Effect.ensuring(rebuild));
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
  const enabled = javascriptTemplatesEnabled(ctx)();
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
      void ctx.tab.run(
        applyJsTemplatesFlag(ctx, !enabled).pipe(Effect.ensuring(rebuild)),
        m.settings_failed_js_templates(),
      );
    });
  });
}

/**
 * Disabling applies immediately. Enabling requires confirmation first, since
 * Eta templates then run with ZotLit's full JS access; declining leaves the
 * gate off and the trailing rebuild re-renders the button to match.
 */
function applyJsTemplatesFlag(ctx: SettingTabContext, enabled: boolean) {
  return Effect.gen(function* () {
    const template = yield* Template;
    if (!enabled) return yield* template.setJavascriptTemplatesEnabled(false);
    const confirmed = yield* awaitConfirm(
      {
        title: m.settings_template_js_confirm_title(),
        content: m.settings_template_js_confirm_body(),
        action: m.settings_template_js_confirm_action(),
        cta: true,
      },
      ctx.app,
    );
    if (confirmed) yield* template.setJavascriptTemplatesEnabled(true);
  });
}
