// The ref lines Git hands a pre-push hook on stdin:
// `<local ref> <local sha> <remote ref> <remote sha>`. A deleted ref has an
// all-zero local sha.
const ZERO = /^0+$/;

/** Whether the push deletes refs and carries no commits. */
export function onlyDeletesRefs(input: string): boolean {
  const lines = input.split("\n").filter(Boolean);
  return (
    lines.length > 0 &&
    lines.every((line) => ZERO.test(line.split(" ")[1] ?? ""))
  );
}
