// Vite asset-import modules used by the plugin bundle (tsconfig excludes
// `vite/client`, which would otherwise provide these).
declare module "*.svg?inline" {
  /** Build-time data URI of the inlined SVG. */
  const dataUri: string;
  export default dataUri;
}
