/** Show download dialog to save given file. */
export function saveFile(data: Blob, filename: string): void {
  const url = URL.createObjectURL(data);

  const link = createEl("a");
  link.href = url;
  link.download = filename;
  link.classList.add("zt:hidden");

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}

/** Compact timestamp suffix for download filenames, e.g. `20260512-143000`. */
export function exportTimestamp(): string {
  const now = Temporal.Now.plainDateTimeISO();
  const pad = (n: number): string => n.toString().padStart(2, "0");
  return `${now.year}${pad(now.month)}${pad(now.day)}-${pad(now.hour)}${pad(now.minute)}${pad(now.second)}`;
}
