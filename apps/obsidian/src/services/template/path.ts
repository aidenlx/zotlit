export function normalizeVaultPath(path: string): string {
  const normalized = path
    .replaceAll("\\", "/")
    .replaceAll(/\/+/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  return normalized === "." ? "" : normalized;
}

export function isEtaTemplatePath(path: string): boolean {
  return normalizeVaultPath(path).endsWith(".eta.md");
}
