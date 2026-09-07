// Shared formatting for vault-relative Obsidian wiki links.

export interface WikiLinkOptions {
  readonly alias?: string;
  readonly subpath?: string;
}

export function formatWikiLink(
  target: string,
  options: WikiLinkOptions = {},
): string {
  const fragment = options.subpath
    ? `#${options.subpath.startsWith("#") ? options.subpath.slice(1) : options.subpath}`
    : "";
  return `[[${target}${fragment}${options.alias ? `|${options.alias}` : ""}]]`;
}
