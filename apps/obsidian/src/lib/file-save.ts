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
