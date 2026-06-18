// Local augmentations on top of `zotero-types/entries/sandbox`.

declare global {
  // Vite-injected build-time constant.
  const __DEV__: boolean;

  // `zotero-types@4.1.2` types `Zotero.DataDirectory.dir` but not
  // `Zotero.Profile`. We only read its profile directory.
  // https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/profile.js#L30
  namespace Zotero {
    namespace Profile {
      const dir: string;
    }
  }

  // `zotero-types@4.1.2` omits the reducer that mutates the internal reader's
  // `_state`. It is the single write path (`this._state = { ...this._state,
  // ...state }`), so wrapping it is how we observe selection changes.
  // https://github.com/zotero/reader/blob/9.0.4/src/common/reader.js#L493
  namespace _ZoteroTypes {
    namespace Reader {
      interface InternalReader<T extends keyof ViewTypeMap> {
        _updateState(
          state: Partial<InternalReader<T>["_state"]>,
          init?: boolean,
        ): void;
      }
    }
  }

  interface Window {
    /**
     * Gecko chrome-window global. We only use `insertFTLIfNeeded`, which
     * idempotently appends `<link rel="localization" href="…"/>` to the
     * window's document so its `document.l10n` includes the FTL file in
     * subsequent translations.
     *
     * @see https://searchfox.org/mozilla-esr140/source/toolkit/content/widgets/MozElements.js
     */
    readonly MozXULElement: {
      insertFTLIfNeeded(path: string): void;
    };
  }

  // Mozilla Services global, injected into the plugin sandbox by Zotero.
  // Sandbox creation site:
  // https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/plugins.js#L137
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
