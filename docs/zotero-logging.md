# Zotero Logging Report

**Analysis based on commit:** `504447de41`

## Scope

This report covers how Zotero's logging functions are implemented, where `console.`\* exists or does not exist, and how plugin code can log to both Zotero debug output and the Mozilla Browser Console from common environments:

- plugin `bootstrap.js` sandbox
- plugin/chrome HTML pages
- main Zotero `zoteroPane.xhtml` window
- content iframes/browser pages used by reader, note editor, translators, and snapshot code

The motivating constraint is correct: `console` is not provided in the plugin `bootstrap.js` sandbox.

## Short Answer

Use these defaults:

```js
// Works in plugin bootstrap.js and any privileged Zotero chrome context
Zotero.debug("[my-plugin] message", 3);
Zotero.warn("[my-plugin] warning");
Zotero.logError(error);
```

For Browser Console output from `bootstrap.js`, use `Zotero.log()` or `Services.console` rather than `console.*`:

```js
Zotero.log("[my-plugin] visible in Browser Console", "warning");
Services.console.logStringMessage("[my-plugin] plain console message");
```

For a plugin page loaded as chrome HTML/XHTML, `console.*` should generally exist because it is a window context, but it is not the same thing as Zotero debug output. Use `Zotero.debug()` when you want the line to appear in Zotero's Debug Output Logging flow.

For code running in the main Zotero window, `console.*`, `Zotero.debug()`, `Zotero.log()`, `Zotero.logError()`, and main-window globals such as `ZoteroPane` are available.

## Implementation of Zotero Logging APIs

### `Zotero.debug()`

`Zotero.debug` is assigned in [chrome/content/zotero/xpcom/zotero.js](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/xpcom/zotero.js#L45). Its implementation is a small wrapper around `Zotero.Debug.log()`:

- `Zotero.debug(message, level = 3, maxDepth, stack)` adjusts the stack offset, then calls `Zotero.Debug.log(message, level, maxDepth, stack)` in [chrome/content/zotero/xpcom/zotero.js](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/xpcom/zotero.js#L1299).
- `Zotero.Debug` is implemented in [chrome/content/zotero/xpcom/debug.js](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/xpcom/debug.js#L27).
- Non-string messages are rendered with `Zotero.Utilities.varDump()` in [debug.js](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/xpcom/debug.js#L89).
- Messages are filtered by `extensions.zotero.debug.level` in [debug.js](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/xpcom/debug.js#L97).
- Output is formatted as `(level)(+delta): message` in [debug.js](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/xpcom/debug.js#L144).

In Zotero desktop, `Zotero.debug()` is not a direct alias for `console.log()`. It writes into Zotero's debug-output pipeline if that pipeline is enabled by terminal logging, viewer logging, in-memory store, or listeners.

### `Zotero.log()`

`Zotero.log(message, type, sourceName, sourceLine, lineNumber, columnNumber)` writes to Mozilla's console service:

- It creates an `nsIScriptError` in [chrome/content/zotero/xpcom/zotero.js](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/xpcom/zotero.js#L1317).
- `type` defaults to `"warning"` and maps to the matching `nsIScriptError` flag in [zotero.js](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/xpcom/zotero.js#L1321).
- It calls `Services.console.logMessage(scriptError)` in [zotero.js](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/xpcom/zotero.js#L1337).

The `type` argument is not a custom Zotero enum. Zotero builds a property name with `type + "Flag"` and reads that property from the `nsIScriptError` instance:

```js
var flags = scriptError[type + "Flag"];
```

In the current generated Gecko typings, `nsIScriptError` exposes `errorFlag`, `warningFlag`, and `infoFlag` in [types/gecko/generated/lib.gecko.xpcom.d.ts](https://github.com/zotero/zotero/blob/504447de41/types/gecko/generated/lib.gecko.xpcom.d.ts#L3058). Zotero's source comment also mentions historical Mozilla flag names `"exception"` and `"strict"` in [zotero.js](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/xpcom/zotero.js#L1312). In practice, plugin code should use:

- `Zotero.log(message, "warning")`: Browser Console warning; this is the default if `type` is omitted.
- `Zotero.log(message, "error")`: Browser Console error.
- `Zotero.log(message, "info")`: Browser Console informational script message, where supported by the runtime.

Avoid unknown strings. There is no validation layer in `Zotero.log()`; an unsupported `type` produces an undefined flag value and relies on Mozilla's `nsIScriptError.init()` behavior.

`Zotero.log()` also hard-codes the console category to `"system javascript"` and marks the entry as chrome-context output in [zotero.js](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/xpcom/zotero.js#L1326). The optional source parameters let callers attach filename/source/line metadata to the Browser Console entry.

There is an important caveat at commit `504447de41`: Zotero's implementation still passes the older `nsIScriptError.init()` argument shape, including `sourceLine`, but the generated Gecko type in this tree shows the current signature as:

```js
init(
  message,
  sourceName,
  lineNumber,
  columnNumber,
  flags,
  category,
  fromPrivateWindow,
  fromChromeContext,
);
```

That signature is documented in [types/gecko/generated/lib.gecko.xpcom.d.ts](https://github.com/zotero/zotero/blob/504447de41/types/gecko/generated/lib.gecko.xpcom.d.ts#L3081). Zotero currently calls:

```js
scriptError.init(
  message,
  sourceName,
  sourceLine,
  lineNumber,
  columnNumber,
  flags,
  "system javascript",
  false,
  true,
);
```

If the runtime follows the current Gecko signature, those arguments shift: `sourceLine` is treated as `lineNumber`, `lineNumber` as `columnNumber`, `columnNumber` as `flags`, `flags` as `category`, and `"system javascript"` as `fromPrivateWindow`. That can make `Zotero.log()` entries misclassified or not visible where expected in the Browser Console. This matches the observed behavior where `Services.console.logStringMessage("hello")` appears but `Zotero.log("hello")` is not found.

[PR #5920](https://github.com/zotero/zotero/pull/5920/commits) address this issue. `Zotero.log()` will remain broken until patch being merged.

Use `Zotero.log()` only if you verify it appears in the target Zotero version. For a reliable plain Browser Console breadcrumb from plugin bootstrap code, prefer `Services.console.logStringMessage()`. For a reliable severity-tagged script message in current Gecko, create and initialize `nsIScriptError` directly with the current argument order.

### `Services.console.logStringMessage()`

`Services.console.logStringMessage(message)` writes a plain string to Mozilla's console service. It is available in the plugin bootstrap sandbox because `Services` is injected into the sandbox in [chrome/content/zotero/xpcom/plugins.js](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/xpcom/plugins.js#L163).

Compared with `Zotero.log()`:

- `logStringMessage()` does not create an `nsIScriptError`.
- It has no severity/type argument.
- It has no source filename, source line, line number, column number, or `"system javascript"` category metadata.
- It is useful for a simple Browser Console breadcrumb from `bootstrap.js`, where `console` is absent.

Because Zotero's console listener filters warnings only after successfully treating a message as `nsIScriptError`, plain string messages are not warning-filtered by `_shouldKeepError()` in [zotero.js](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/xpcom/zotero.js#L1902). Use `logStringMessage()` sparingly; for routine plugin diagnostics, prefer `Zotero.debug()`.

### `Zotero.logError()`

`Zotero.logError(err)` logs to both Zotero debug output and Mozilla's console:

- It first calls `Zotero.debug(err, 1)` in [chrome/content/zotero/xpcom/zotero.js](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/xpcom/zotero.js#L1344).
- It then calls `Zotero.log(..., "error", ...)` with error message, filename, and line number where available in [zotero.js](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/xpcom/zotero.js#L1346).

Use this for caught exceptions.

### `Zotero.warn()`

`Zotero.warn(err)` is similar to `logError()`, but logs at debug level 2 and emits a console warning in [chrome/content/zotero/xpcom/zotero.js](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/xpcom/zotero.js#L1352).

## Debug Output Logging Internals

Default debug preferences are in [defaults/preferences/zotero.js](https://github.com/zotero/zotero/blob/504447de41/defaults/preferences/zotero.js#L13):

- `extensions.zotero.debug.log = false`
- `extensions.zotero.debug.log.slowTime = 250`
- `extensions.zotero.debug.stackTrace = false`
- `extensions.zotero.debug.store = false`
- `extensions.zotero.debug.store.limit = 500000`
- `extensions.zotero.debug.store.submitSize = 10000000`
- `extensions.zotero.debug.store.submitLineLength = 10000`
- `extensions.zotero.debug.level = 5`

Startup initializes prefs and then `Zotero.Debug.init(options.forceDebugLog)` in [chrome/content/zotero/xpcom/zotero.js](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/xpcom/zotero.js#L260). `Debug.init()` reads the debug prefs in [chrome/content/zotero/xpcom/debug.js](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/xpcom/debug.js#L53). If `debug.store` is true at startup, Zotero enables storage once and immediately resets the pref to false in [debug.js](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/xpcom/debug.js#L63).

Debug output can go to:

- terminal text output via `dump("zotero" + output + "\n\n")` when `debug.log` or `-ZoteroDebugText` is active, in [debug.js](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/xpcom/debug.js#L147)
- in-app debug viewer when `-ZoteroDebug` is active, in [debug.js](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/xpcom/debug.js#L159)
- registered listeners, in [debug.js](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/xpcom/debug.js#L171)
- in-memory store when Debug Output Logging is enabled, in [debug.js](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/xpcom/debug.js#L181)

The in-memory store is toggled by `Zotero.Debug.setStore(enable)` in [debug.js](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/xpcom/debug.js#L266). Help menu controls call this through `ZoteroStandalone.DebugOutput.toggleStore()` in [chrome/content/zotero/standalone/standalone.js](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/standalone/standalone.js#L885).

Submitting debug output:

- Help menu submission builds `Zotero.Debug.get(...)` and posts to `ZOTERO_CONFIG.REPOSITORY_URL + "report?debug=1"` in [standalone.js](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/standalone/standalone.js#L913).
- The HTML debug viewer has its own submit path to the same endpoint in [chrome/content/zotero/debugViewer.js](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/debugViewer.js#L81).
- `Zotero.Debug.get()` includes recent kept console errors, system info, and stored debug output in [chrome/content/zotero/xpcom/debug.js](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/xpcom/debug.js#L194).

Command line:

- `-ZoteroDebug` forces the HTML debug viewer.
- `-ZoteroDebugText` forces terminal logging.
- These are parsed in [app/assets/commandLineHandler.js](https://github.com/zotero/zotero/blob/504447de41/app/assets/commandLineHandler.js#L9).

## Error Buffer and Report Errors

Zotero separately tracks console errors for error reporting:

- Startup console messages are captured with `Services.console.getMessageArray()` in [chrome/content/zotero/xpcom/zotero.js](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/xpcom/zotero.js#L391).
- A console listener is registered in [zotero.js](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/xpcom/zotero.js#L399).
- The listener keeps a 25-entry rolling buffer in [zotero.js](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/xpcom/zotero.js#L2009).
- `_shouldKeepError()` filters warnings, CSS parser messages, content JavaScript messages, and known noise in [zotero.js](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/xpcom/zotero.js#L1902).
- `Zotero.getErrors(true)` returns startup plus recent kept errors as strings in [zotero.js](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/xpcom/zotero.js#L1424).
- “Report Errors...” opens `errorReport.xhtml` with `Zotero.getErrors(true)` in [chrome/content/zotero/zoteroPane.js](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/zoteroPane.js#L6429).

Important distinction: `Zotero.debug()` lines are part of Debug Output Logging only. Browser Console errors tracked by `Zotero.getErrors()` are a different channel.

## Environment Matrix

| Environment                                       | `console.*` availability                             | Zotero APIs                                 | Main-window globals                                | Best logging choice                                                              |
| ------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------- |
| Plugin `bootstrap.js` sandbox                     | No by default                                        | Yes, injected                               | No direct globals, but can access window           | `Zotero.debug`, `Zotero.logError`, `Zotero.log`, `Services.console`              |
| Main Zotero `zoteroPane.xhtml`                    | Yes, window context                                  | Yes                                         | Yes                                                | `Zotero.debug` for debug output; `console.*` or `Zotero.log` for Browser Console |
| Plugin/chrome HTML/XHTML page                     | Usually yes, window context                          | Only if imported or loaded via `include.js` | No unless reached through `Zotero.getMainWindow()` | Load/import `Zotero`; use `Zotero.debug` and `console.*` as separate channels    |
| Zotero CommonJS modules via `resource/require.js` | Yes, injected                                        | Usually yes depending module                | No                                                 | `Zotero.debug`; `console.*` also exists                                          |
| Reader iframe                                     | Yes, wrapped                                         | Not as normal chrome global                 | No                                                 | `console.*` is forwarded to original console and mirrored to `Zotero.debug`      |
| Note editor content iframe                        | Content-page console                                 | Only selected helpers are injected          | No                                                 | Content `console.*`; chrome wrapper logs iframe errors with `Zotero.logError`    |
| Translation content sandbox                       | Sandbox-specific                                     | Translation framework `Zotero`, bounded API | No                                                 | Translator `Zotero.debug`; parent actor proxies privileged work                  |
| SingleFile snapshot sandbox                       | Inherits page/global behavior; custom `Zotero.debug` | Minimal cloned `Zotero`                     | No                                                 | `Zotero.debug` maps to `console.log` in that sandbox                             |

## Plugin `bootstrap.js` Sandbox

Plugins are loaded into a dedicated system-principal sandbox:

- Sandbox creation is in [chrome/content/zotero/xpcom/plugins.js](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/xpcom/plugins.js#L137).
- The sandbox `wantGlobalProperties` includes browser-like globals such as `fetch`, `URL`, `DOMParser`, `XMLHttpRequest`, and `ChromeUtils`, but not `console`, in [plugins.js](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/xpcom/plugins.js#L141).
- Zotero then assigns globals such as `Zotero`, `Services`, `IOUtils`, `PathUtils`, timers, workers, and `XMLSerializer`, again without `console`, in [plugins.js](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/xpcom/plugins.js#L163).
- `bootstrap.js` is loaded into that sandbox with `Services.scriptloader.loadSubScriptWithOptions(..., { target: scope, ignoreCache: true })` in [plugins.js](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/xpcom/plugins.js#L203).

Because `console` is not present, plugin bootstrap code should not call `console.log()` unless the plugin defines its own console shim.

Recommended bootstrap logger:

```js
var PluginLogger = {
  id: "my-plugin@example.com",

  debug(message, level = 3) {
    Zotero.debug(`[${this.id}] ${message}`, level);
  },

  info(message) {
    Zotero.debug(`[${this.id}] ${message}`, 3);
    Services.console.logStringMessage(`[${this.id}] ${message}`);
  },

  warn(message) {
    Zotero.warn(`[${this.id}] ${message}`);
  },

  error(error) {
    Zotero.logError(error);
  },
};
```

If a third-party library expects `console`, provide a minimal shim early in `bootstrap.js`:

```js
var console = {
  log: (...args) =>
    Zotero.debug(`[my-plugin] ${args.map(String).join(" ")}`, 3),
  info: (...args) =>
    Zotero.debug(`[my-plugin] ${args.map(String).join(" ")}`, 3),
  debug: (...args) =>
    Zotero.debug(`[my-plugin] ${args.map(String).join(" ")}`, 5),
  warn: (...args) => Zotero.warn(`[my-plugin] ${args.map(String).join(" ")}`),
  error: (...args) => {
    let message = `[my-plugin] ${args.map((arg) => arg?.stack || String(arg)).join(" ")}`;
    Zotero.log(message, "error");
    Zotero.debug(message, 1);
  },
};
```

Use a local `var console` shim rather than assuming a global exists. This avoids changing Zotero's plugin sandbox contract.

### Bootstrap Access to Main-Window APIs

From `bootstrap.js`, use these patterns:

```js
function onMainWindowLoad({ window }, reason) {
  let ZoteroPane = window.ZoteroPane;
  Zotero.debug(`[my-plugin] main window loaded: ${!!ZoteroPane}`, 3);
}

function startup({ id, version, rootURI }, reason) {
  let win = Zotero.getMainWindow();
  if (win?.ZoteroPane) {
    Zotero.debug(`[${id}] existing main window is available`, 3);
  }
}
```

Why:

- `Zotero.getMainWindow()` and `Zotero.getMainWindows()` are defined in [chrome/content/zotero/xpcom/zotero.js](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/xpcom/zotero.js#L77).
- `onMainWindowLoad` receives `{ window: domWindow }` when `chrome://zotero/content/zoteroPane.xhtml` loads in [chrome/content/zotero/xpcom/plugins.js](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/xpcom/plugins.js#L104).

## Main Window `zoteroPane.xhtml`

The main Zotero window is `chrome://zotero/content/zoteroPane.xhtml`.

- It imports `Zotero` with `ChromeUtils.importESModule("chrome://zotero/content/zotero.mjs")` in [chrome/content/zotero/zoteroPane.xhtml](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/zoteroPane.xhtml#L60).
- It loads `standalone.js`, `tabs.js`, `zoteroPane.js`, and other scripts into the window in [zoteroPane.xhtml](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/zoteroPane.xhtml#L62).
- `ZoteroPane` is defined as a window global in [chrome/content/zotero/zoteroPane.js](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/zoteroPane.js#L32).

Logging in this context:

```js
Zotero.debug("debug output line", 3);
Zotero.log("browser console warning", "warning");
Zotero.logErrorZotero.logErrorZotero.logError(
  new Error("browser console error and debug line"),
);
console.log("browser console only");
```

The Developer menu opens the Browser Console with `toJavaScriptConsole()`:

- Menu item in [zoteroPane.xhtml](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/zoteroPane.xhtml#L763)
- Implementation in [chrome/content/zotero/standalone/standalone.js](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/standalone/standalone.js#L1075)

## Plugin or Zotero Chrome HTML/XHTML Pages

Chrome pages usually acquire Zotero APIs by loading `include.js`:

- `include.js` imports `Zotero` in [chrome/content/zotero/include.js](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/include.js#L1).
- It loads `resource://zotero/require.js` if `require` is not already defined in [include.js](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/include.js#L13).
- `debugViewer.html` uses this pattern in [chrome/content/zotero/debugViewer.html](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/debugViewer.html#L7).
- `runJS.html` uses this pattern in [chrome/content/zotero/runJS.html](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/runJS.html#L39).

In plugin chrome pages, the equivalent is either:

```html
<script src="chrome://zotero/content/include.js"></script>
```

or:

```js
var { Zotero } = ChromeUtils.importESModule(
  "chrome://zotero/content/zotero.mjs",
);
```

Then:

```js
Zotero.debug("[my-plugin page] debug output", 3);
console.log("[my-plugin page] Browser Console/devtools console");
```

If the page needs `ZoteroPane`, cross to the main window:

```js
let mainWindow = Zotero.getMainWindow();
let pane = mainWindow?.ZoteroPane;
```

`runJS.html` is special: it evaluates code in the main Zotero window, not in its own page. [chrome/content/zotero/runJS.js](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/runJS.js#L9) gets `Zotero.getMainWindow()` and calls `win.eval(code)` in [runJS.js](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/runJS.js#L22).

## CommonJS Modules Loaded by `require.js`

Do not infer bootstrap sandbox behavior from Zotero's CommonJS module loader.

`resource/require.js` explicitly injects `console` into module globals:

- The injected globals list includes `console` in [resource/require.js](https://github.com/zotero/zotero/blob/504447de41/resource/require.js#L99).
- The `console` entry is at [resource/require.js](https://github.com/zotero/zotero/blob/504447de41/resource/require.js#L106).

So `console` can exist in Zotero-loaded modules even though it does not exist in plugin `bootstrap.js`.

## Content, Iframe, and Browser-Like Contexts

### Reader iframe

Reader iframe console is intentionally wrapped:

- `_wrapConsole()` grabs the original iframe `console` in [chrome/content/zotero/xpcom/reader.js](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/xpcom/reader.js#L1486).
- It wraps `log`, `info`, `warn`, `error`, `debug`, and `trace` in [reader.js](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/xpcom/reader.js#L1490).
- The wrapper mirrors messages into `Zotero.debug()` with levels derived from the console method and then forwards to the original console in [reader.js](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/xpcom/reader.js#L1492).
- It assigns the wrapper to `win.wrappedJSObject.console` in [reader.js](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/xpcom/reader.js#L1504).

### Note editor iframe

The note editor is a content iframe:

- The iframe is created with `type="content"` and loads `resource://zotero/note-editor/editor.html` in [chrome/content/zotero/elements/noteEditor.js](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/elements/noteEditor.js#L48).
- Chrome code exposes selected helper functions via `wrappedJSObject`, such as `zoteroExecCommand`, in [chrome/content/zotero/xpcom/editorInstance.js](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/xpcom/editorInstance.js#L100).
- Iframe errors are logged with `Zotero.logError(event.error)` in [editorInstance.js](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/xpcom/editorInstance.js#L178).

Content-page `console.*` exists as page console behavior, but it is not automatically Zotero debug output unless wrapped.

### JSWindowActors and content pages

Injected browser/content pages use actors rather than full main-window APIs:

- Actors are registered in [chrome/content/zotero/actors/ActorManager.mjs](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/actors/ActorManager.mjs#L4).
- `PageDataChild` reads document title, body text, cookies, serialized HTML, and selected channel info in [chrome/content/zotero/actors/PageDataChild.mjs](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/actors/PageDataChild.mjs#L16).
- `PageDataChild.loadURI()` loads with the system principal in [PageDataChild.mjs](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/actors/PageDataChild.mjs#L53).

### Translation sandbox

Translation content injection creates its own system-principal sandbox:

- Sandbox creation with the page as prototype is in [chrome/content/zotero/actors/TranslationChild.mjs](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/actors/TranslationChild.mjs#L203).
- It loads translation scripts into the sandbox in [TranslationChild.mjs](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/actors/TranslationChild.mjs#L214).
- It initializes translation debug logging with `Zotero.Debug.init(1)` and `Zotero.Debug.setStore(true)` in [TranslationChild.mjs](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/actors/TranslationChild.mjs#L222).
- Privileged provider calls are proxied to the parent actor in [chrome/content/zotero/actors/TranslationParent.mjs](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/actors/TranslationParent.mjs#L72).

This is a bounded translation API, not full main-window access.

### SingleFile snapshot sandbox

SingleFile snapshot code uses a page-prototype sandbox:

- Sandbox creation is in [chrome/content/zotero/actors/SingleFileChild.mjs](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/actors/SingleFileChild.mjs#L88).
- It exposes a minimal cloned `Zotero` object with `HTTP` and `debug` in [SingleFileChild.mjs](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/actors/SingleFileChild.mjs#L95).
- Its `Zotero.debug` maps to `console.log` in [SingleFileChild.mjs](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/actors/SingleFileChild.mjs#L96).

## Practical Recipes

### Log only to Zotero Debug Output

```js
Zotero.debug("[my-plugin] reached import stage", 3);
```

This is visible only when debug logging is enabled, a debug viewer/listener exists, or Debug Output Logging storage is active.

### Log an exception to both debug output and Browser Console

```js
try {
  await doWork();
} catch (e) {
  Zotero.logError(e);
}
```

### Log a warning to Browser Console from bootstrap

```js
Zotero.log("[my-plugin] unsupported item type", "warning");
```

If that does not appear in the Browser Console on the current Zotero runtime, use the direct current-Gecko `nsIScriptError.init()` shape:

```js
let scriptError = Components.classes[
  "@mozilla.org/scripterror;1"
].createInstance(Components.interfaces.nsIScriptError);
scriptError.init(
  "[my-plugin] unsupported item type",
  "my-plugin",
  0,
  0,
  scriptError.warningFlag,
  "system javascript",
  false,
  true,
);
Services.console.logMessage(scriptError);
```

### Log a plain string to Browser Console from bootstrap

```js
Services.console.logStringMessage("[my-plugin] loaded");
```

### Make third-party code that calls `console.*` safe in bootstrap

```js
var console = {
  log: (...args) =>
    Zotero.debug(`[my-plugin] ${args.map(String).join(" ")}`, 3),
  info: (...args) =>
    Zotero.debug(`[my-plugin] ${args.map(String).join(" ")}`, 3),
  debug: (...args) =>
    Zotero.debug(`[my-plugin] ${args.map(String).join(" ")}`, 5),
  warn: (...args) => Zotero.warn(`[my-plugin] ${args.map(String).join(" ")}`),
  error: (...args) =>
    Zotero.log(`[my-plugin] ${args.map(String).join(" ")}`, "error"),
};
```

### See output while developing

- Browser Console: Tools -> Developer -> Error Console, implemented by [zoteroPane.xhtml](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/zoteroPane.xhtml#L763) and [standalone.js](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/standalone/standalone.js#L1075).
- Debug Output Logging: Help -> Debug Output Logging, menu in [zoteroPane.xhtml](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/zoteroPane.xhtml#L820), implementation in [standalone.js](https://github.com/zotero/zotero/blob/504447de41/chrome/content/zotero/standalone/standalone.js#L875).
- Terminal debug output: launch with `-ZoteroDebugText`.
- In-app debug viewer at startup: launch with `-ZoteroDebug`.

## External Context Checked

Official Zotero support pages confirm the developer-facing workflows:

- Zotero 7 developer guidance documents plugin transition details and current plugin-development entry points: [https://www.zotero.org/support/dev/zotero_7_for_developers](https://www.zotero.org/support/dev/zotero_7_for_developers)
- Zotero debug-output documentation describes enabling and submitting Debug Output Logging: [https://www.zotero.org/support/debug_output](https://www.zotero.org/support/debug_output)

The source tree is still the authoritative reference for implementation details above.
