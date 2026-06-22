export function basename(path: string, ext = ".md"): string {
  if (ext !== "" && isOnlySlashes(path)) return path === ext ? "" : path;

  const name = finalSegment(path);
  if (ext === "" || name === "") return name;
  if (path === ext) return "";
  if (name === ext) return name;
  return name.endsWith(ext) ? name.slice(0, -ext.length) : name;
}

function finalSegment(path: string): string {
  let end = path.length;
  while (end > 0 && path.charCodeAt(end - 1) === 47) end--;
  if (end === 0) return "";

  const start = path.lastIndexOf("/", end - 1) + 1;
  return path.slice(start, end);
}

function isOnlySlashes(path: string): boolean {
  if (path.length === 0) return false;
  for (let i = 0; i < path.length; i++) {
    if (path.charCodeAt(i) !== 47) return false;
  }
  return true;
}
