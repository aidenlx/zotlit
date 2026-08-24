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

    namespace MenuManager {
      interface LibraryMenuContext {
        // Zotero 10 removed the singular `collectionTreeRow` and passes the
        // collections-pane selection as an array; the singular name survives
        // as a property whose getter throws on read. `zotero-types@4.1.2`
        // describes the Zotero 9 shape only, so the plural is added here and
        // stays optional to keep Zotero 9 (where it is absent) typing.
        // https://github.com/zotero/zotero/blob/10.0.0/chrome/content/zotero/zoteroPane.js#L4113
        collectionTreeRows?: Zotero.CollectionTreeRow[];
      }

      interface BaseMenuContext {
        // The dynamic `setL10nArgs` writes its value straight to
        // `dataset.l10nArgs` with no `JSON.stringify` (unlike the static
        // `l10nArgs` menu field), so callers must pass an already-serialized
        // JSON string — an object stringifies to "[object Object]" and breaks
        // Fluent `$arg` selection. Adds a string overload to the `object` one.
        // https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/pluginAPI/menuManager.js
        setL10nArgs(l10nArgs: string): void;
      }
    }
  }

  // `zotero-types@4.1.2`'s generated `nsIWindowMediator.getMostRecentWindow`
  // only accepts `string`, but the underlying XPCOM method accepts `null`
  // for "any window type" (widely used by Zotero itself, e.g. the focus
  // check in zoteroPane.js).
  // https://searchfox.org/mozilla-esr140/source/xpcom/ds/nsIWindowMediator.idl
  interface nsIWindowMediator {
    getEnumerator(aWindowType: null): nsISimpleEnumerator;
    getMostRecentWindow(aWindowType: null): mozIDOMWindowProxy;
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
    // Tracks chrome window open/close and enumerates open windows by type
    // (e.g. "zotero:reader", "navigator:browser") — the same idiom Zotero's
    // own plugin loader uses to notice main-window load/unload.
    wm: nsIWindowMediator;
    // Point-in-time OS focus state (which chrome window currently has
    // focus); no listener API, unlike `wm`.
    focus: nsIFocusManager;
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
