// Ambient types for Inlang plugins that ship no type declarations despite
// declaring a `types` field in their `package.json`.

declare module "@inlang/plugin-message-format" {
  const plugin: import("@inlang/sdk").InlangPlugin;
  export default plugin;
}

declare module "@inlang/plugin-m-function-matcher" {
  const plugin: import("@inlang/sdk").InlangPlugin;
  export default plugin;
}
