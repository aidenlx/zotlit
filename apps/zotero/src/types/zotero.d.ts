// Local augmentations on top of `zotero-types/entries/sandbox`.

declare global {
  // Vite-injected build-time constant.
  const __DEV__: boolean;

  // Mozilla Services global, injected into the plugin sandbox by Zotero.
  // Sandbox creation site:
  // https://github.com/zotero/zotero/blob/3d2f51eeb4e26f0c7b40716d611a6a781e5c2c68/chrome/content/zotero/xpcom/plugins.js#L137
  const Services: {
    console: {
      logStringMessage(message: string): void;
    };
    scriptloader: {
      /**
       * Synchronously fetch and execute a script.
       *
       * @param url Chrome/resource/file URL of the script source.
       * @param targetObj Object used as the global scope for the script's
       *   top-level execution. `var`/`function` declarations at the top level
       *   become properties of this object, which is how Zotero populates
       *   namespace objects (e.g. `loadSubScript(uri, zContext)` hangs the
       *   script's top-level bindings off `zContext`). If omitted, the script
       *   runs in the caller's global.
       * @param charset Character set used to decode the script bytes. Zotero
       *   passes `'utf-8'` explicitly; defaults to the platform default
       *   (effectively UTF-8 on modern Firefox/Zotero).
       */
      loadSubScript(url: string, targetObj?: object, charset?: string): void;
    };
  };
}

export {};
