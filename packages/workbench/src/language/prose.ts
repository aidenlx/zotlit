// The prose of a function's, a member's or a field's description, as the
// Query Schema writes it: plain text with code spans in backticks. One
// renderer for every popup that shows one.

/** Appends `text` to `parent`, each span in backticks as a `<code>`. */
export function appendProse(parent: Element, text: string): void {
  const doc = parent.ownerDocument;
  text.split("`").forEach((part, at) => {
    if (part === "") return;
    if (at % 2 === 0) parent.append(part);
    else parent.appendChild(doc.createElement("code")).textContent = part;
  });
}
