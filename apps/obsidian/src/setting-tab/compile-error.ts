/** Append a styled compile-error block to a settings desc, with an optional
 *  explanatory heading above the raw error message. */
export function appendCompileError(
  parent: DocumentFragment | HTMLElement,
  message: string,
  heading?: string,
): void {
  const block = document.createElement("div");
  block.className = "zt:mt-2 zt:text-(--text-error)";
  if (heading) block.append(heading);
  const pre = document.createElement("pre");
  pre.className =
    "zt:m-0 zt:mt-1 zt:text-(length:--font-smallest) zt:whitespace-pre-wrap";
  pre.textContent = message;
  block.append(pre);
  parent.append(block);
}
