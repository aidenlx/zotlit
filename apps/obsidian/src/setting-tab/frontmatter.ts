import { type SettingDefinitionItem } from "obsidian";

import { validateFrontmatterExpr } from "@zotlit/templates/frontmatter";

import { confirm } from "@/lib/confirm";
import * as m from "@/paraglide/messages";

import { type SettingsKey, type SettingTabContext } from "./context";
import { openFrontmatterFieldModal } from "./frontmatter-modal";

export function frontmatterPageItems(
  ctx: SettingTabContext,
): SettingDefinitionItem<SettingsKey>[] {
  const fields = ctx.settings.current?.["note.frontmatter-fields"] ?? [];
  return [
    {
      type: "list",
      heading: m.settings_note_frontmatter_heading(),
      emptyState: m.settings_note_frontmatter_empty(),
      extraButtons: [
        (btn) =>
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
      ],
      addItem: {
        name: m.settings_note_frontmatter_add(),
        action: () => openFieldModal(ctx, null),
      },
      onDelete: (index) => deleteField(ctx, index),
      items: fields.map((field) => ({
        name: field.key || m.settings_note_frontmatter_empty_key(),
        desc: describeField(field.expr),
        searchable: false,
        action: (_el, index) => openFieldModal(ctx, index),
      })),
    },
  ];
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

function openFieldModal(ctx: SettingTabContext, index: number | null): void {
  const fields = ctx.settings.current?.["note.frontmatter-fields"] ?? [];
  const field = index === null ? null : (fields[index] ?? null);
  const existingKeys = fields.filter((_, i) => i !== index).map((f) => f.key);

  openFrontmatterFieldModal(ctx.app, { field, existingKeys }).then(
    (value) => {
      const next = [...fields];
      if (index === null) next.push(value);
      else next[index] = value;
      ctx.settings.update({ "note.frontmatter-fields": next });
    },
    () => {},
  );
}

function deleteField(ctx: SettingTabContext, index: number): void {
  const fields = [...(ctx.settings.current?.["note.frontmatter-fields"] ?? [])];
  fields.splice(index, 1);
  ctx.settings.update({ "note.frontmatter-fields": fields });
}
