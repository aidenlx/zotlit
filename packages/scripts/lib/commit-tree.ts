// Type-aware lint builds workspace packages from disk. Lefthook hides the
// unstaged hunks of a staged file, but a file with only unstaged changes stays
// on disk, so lint would check a tree the commit never holds.

/** Files whose content reaches the lint build: sources, and JSON such as message catalogs. */
const BUILD_INPUT = /\.(?:[cm]?[jt]sx?|json)$/;

/**
 * The files with changes outside the commit that lint would still build, read
 * from `git status --porcelain=v1 -z --untracked-files=all`. A file the commit
 * stages is left out: Lefthook hides its unstaged hunks.
 */
export function looseFiles(status: string): string[] {
  const fields = status.split("\0");
  const loose: string[] = [];
  for (let index = 0; index < fields.length; index++) {
    const field = fields[index]!;
    if (field.length < 4) continue;
    const staged = field[0]!;
    const unstaged = field[1]!;
    const path = field.slice(3);
    // A rename or copy carries its source path in the next field.
    if ("RC".includes(staged) || "RC".includes(unstaged)) index++;
    if ((staged === " " || staged === "?") && unstaged !== " ") {
      if (BUILD_INPUT.test(path)) loose.push(path);
    }
  }
  return loose;
}

/** The message that names the loose files and the two ways on. */
export function looseFilesMessage(loose: readonly string[]): string {
  return [
    "Lint builds the working tree, and these files hold changes outside this commit:",
    ...loose.map((path) => `  ${path}`),
    "Move them out of the tree (a WIP commit, or a tagged stash) to check this commit alone,",
    "or run the commit with LEFTHOOK_EXCLUDE=tree to check it together with them.",
  ].join("\n");
}
