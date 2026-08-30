// Duplicate a Profile and hand its manifest name to the document editor.
import { MarkdownView } from "obsidian";
import { isScalar, parseDocument } from "yaml";

import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";
import type { ProfileSelector } from "@/lib/profile-stamp";

import type { SettingTabContext } from "./context";

export async function duplicateProfileToEditor(
  ctx: Pick<SettingTabContext, "app" | "profile">,
  selector: ProfileSelector,
): Promise<void> {
  const source = ctx.profile.resolveProfile(selector);
  if (!source) throw new Error(`Unknown Profile: ${selector}`);
  const copy = await ctx.profile.duplicate(selector);
  const file = ctx.app.vault.getFileByPath(copy.path);
  if (!file) throw new Error(`Profile document is unavailable: ${copy.path}`);
  ctx.app.setting.close();
  const leaf = ctx.app.workspace.getLeaf(true);
  await leaf.openFile(file, { state: { mode: "source", source: true } });
  if (!(leaf.view instanceof MarkdownView))
    throw new Error("The Profile document did not open in a Markdown editor");
  const editor = leaf.view.editor;
  const text = editor.getValue();
  const header = parseDocument(text.slice(4, text.indexOf("\n---", 4)));
  const name = header.get("name", true);
  if (!isScalar(name) || !name.range)
    throw new Error("The Profile document has no manifest name");
  editor.setSelection(
    editor.offsetToPos(name.range[0] + 4),
    editor.offsetToPos(name.range[1] + 4),
  );
  editor.focus();
  new BaseNotice(
    m.notice_profile_duplicated({
      label: source.label ?? m.settings_profile_default_name(),
    }),
  );
}
