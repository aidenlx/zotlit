declare module "*.css" {}

declare module "@zotlit/templates/defaults/*?raw" {
  const source: string;
  export default source;
}

var __DEV__: boolean;
