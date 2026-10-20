// Whether the field that holds focus in a surface stands with a popup of its
// own, such as an expression editor's completion list or Signature Hint. A
// surface that hears Escape before the field, a chooser page or a dialog,
// leaves the key to the field while it does, so the first Escape closes the
// popup and not the surface.
import { FIELD_POPUP_ATTRIBUTE } from "@zotlit/workbench/language";

/** Whether the focused field inside `surface` holds a popup of its own open. */
export function fieldPopupStands(surface: Element): boolean {
  const field = surface.ownerDocument.activeElement;
  if (!field || !surface.contains(field)) return false;
  // What CodeMirror's field carries while its typing list stands.
  const list =
    field.getAttribute("aria-haspopup") === "listbox" &&
    field.hasAttribute("aria-controls");
  return list || field.hasAttribute(FIELD_POPUP_ATTRIBUTE);
}
