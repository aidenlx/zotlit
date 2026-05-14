import "obsidian";

declare module "obsidian" {
  interface MetadataCache {
    initialized: boolean;
    on(name: "initialized", callback: () => any, ctx?: any): EventRef;
  }
  interface App {
    plugins: {
      plugins: Record<string, unknown>;
    };
  }
}
