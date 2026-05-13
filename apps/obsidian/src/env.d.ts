declare module "*.css" {}

declare module "*.eta.md?raw" {
  const source: string;
  export default source;
}

var __DEV__: boolean;
