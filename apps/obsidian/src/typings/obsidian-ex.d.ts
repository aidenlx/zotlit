import "obsidian";

declare global {
  /** Obsidian bundles turndown and exposes its constructor as a runtime global. */
  const TurndownService: typeof import("turndown").default;
}

declare module "obsidian" {
  interface MetadataCache {
    initialized: boolean;
    on(name: "initialized", callback: () => any, ctx?: any): EventRef;
  }
  interface App {
    plugins: {
      plugins: Record<string, unknown>;
    };
    internalPlugins: {
      /** The enabled core plugin instance, or null when disabled/absent. */
      getEnabledPluginById(id: string): unknown;
    };
    setting: {
      open(): void;
      openTabById(id: string): unknown;
    };
    commands: {
      executeCommandById(id: string): boolean;
    };
  }

  /** Position-resolved link/tag token from {@link Editor.getClickableTokenAt}. */
  interface ClickableToken {
    type: string;
    text: string;
    start: EditorPosition;
    end: EditorPosition;
  }
  interface Editor {
    getClickableTokenAt(pos: EditorPosition): ClickableToken | null;
  }
  interface MarkdownView {
    /** Live-preview / source edit sub-view; absent in pure reading mode. */
    editMode?: MarkdownEditView;
  }
  interface MarkdownEditView {
    triggerClickableToken(
      token: ClickableToken,
      newLeaf: boolean | PaneType,
    ): void;
  }
  interface MenuItem {
    /** Convert this item into a submenu parent, returning the nested {@link Menu} to populate. Runtime API present since Obsidian 1.4, absent from the vendored typings. */
    setSubmenu(): Menu;
  }
}
