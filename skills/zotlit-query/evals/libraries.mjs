// The eval corpus names these Libraries; selectors identify the same Libraries.
export function librarySelector(value) {
  return (
    { "My Library": "personal", "Lab Archive": "group:118" }[value] ?? value
  );
}

export function indexedKeyLibrary(key) {
  const suffix = key.slice(8);
  return suffix.startsWith("g") ? `group:${suffix.slice(1)}` : "personal";
}
