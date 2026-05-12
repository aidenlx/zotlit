/** Show download dialog to save given file. */
export function saveFile(data: Blob, filename: string): void {
  const url = URL.createObjectURL(data);

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}
