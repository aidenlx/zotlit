# How Zotero Plugins Register Custom `zotero://` URI Schemes (e.g. `zotero://zotlit/ping`)

## TL;DR
- A Zotero plugin does **not** register a brand-new OS-level protocol; it adds a new *path prefix* to Zotero's single existing `zotero://` handler by inserting an "extension" object into the protocol handler's internal `_extensions` registry, reached via `Services.io.getProtocolHandler('zotero').wrappedJSObject._extensions`. This is the exact API Zotero lead developer Dan Stillman told the plugin author to use.
- This `zotero://` protocol mechanism is **completely separate** from Zotero's HTTP server endpoints (`Zotero.Server.Endpoints`, served at `http://127.0.0.1:23119/...`). They are two different extension points: one hooks the in-app `nsIProtocolHandler`, the other registers an HTTP route on the local connector/API server.
- Custom paths like `zotero://zotlit/ping` work because the first path segment (`zotlit`) is matched against keys in `_extensions`; the matched extension object's `newChannel`/`doAction` methods handle the rest of the path. Plugins must add their key on `startup` and `delete` it on `shutdown`.

## Key Findings

1. **One protocol, many extensions.** Zotero registers a single custom protocol handler for the `zotero` scheme (`ZoteroProtocolHandler`, implemented in `components/zotero-protocol-handler.js` in the `zotero/zotero` GitHub repo). Internally it keeps a dictionary of sub-handlers — `_extensions` — keyed by the URI's first path segment / prefix (e.g. `zotero://select`, `zotero://open-pdf`, `zotero://report`, `zotero://data`). Plugins extend the protocol by adding a new key to this dictionary, not by registering their own `nsIProtocolHandler`.

2. **The official extension point.** On the Zotero developer mailing-list thread "[Zotero 7] API request: protocol handler", Dan Stillman gave the canonical instruction. He had been told by Better Notes' author (windingwind), who wrote: *"In the plugin Better Notes, I override Zotero's protocol handler script to add extra protocol for notes links, i.e. `zotero://note/u/KEY/?params`, in the manifest. Is it possible to do similar things in Zotero 7?"* Stillman replied: *"you're currently overriding the entire zotero-protocol-handler.js file in chrome.manifest, replacing it with your own copy. That's really not OK … Please stop doing that ASAP … You can access the protocol handler extensions via `Services.io.getProtocolHandler('zotero').wrappedJSObject._extensions`. I haven't tested it, but I would think you could just add a function there to add support for a new prefix. - Dan"* The author confirmed: *"I've made an update to the plugin and the protocol handler is added without overriding the Zotero .js file."*

3. **The extension-object shape.** Each value in `_extensions` is an object implementing the Mozilla `nsIProtocolHandler`-style channel contract that Zotero's wrapper expects: a `newChannel(uri)` method (which Zotero calls to produce content), commonly delegating to an async `doAction(uri)` method, plus boolean flags such as `noContent` (for action-only URLs like `zotero://select` that should not open a viewer window) and `loadAsChrome` (whether content is loaded with chrome privileges). This pattern is visible in Zotero core (e.g. the `SelectExtension` and the `zotero://open-pdf` handler) and in third-party handlers like zotfile's former `openPDF-protocol-handler.js`.

4. **HTTP endpoints are a different thing entirely.** `Zotero.Server.Endpoints["/myplugin/foo"]` registers a route on Zotero's built-in HTTP server (port 23119), the same server used by the browser Connector (`/connector/ping`) and, since Zotero 7, the local read-only Web API (`/api/`). Those are reached over `http://127.0.0.1:23119/...` from external processes (browsers, scripts, other apps). The `zotero://` protocol, by contrast, is an in-application URL scheme handled by Gecko's protocol machinery and is how clickable links inside notes, reports, and the app UI work.

5. **ZotLit's case (`zotero://zotlit/ping`).** ZotLit ships a Zotero-side plugin (`zotero-obsidian-note`, in the `aidenlx/obsidian-zotero` / `PKM-er/obsidian-zotlit` monorepo at `app/zotero`) plus a helper library `@aidenlx/zotero-helper` (at `lib/zotero-helper`) and a shared `@obzt/protocol` package (`lib/protocol`) that defines the route constants. ZotLit originally overrode the whole protocol handler file; after Dan Stillman's guidance it switched to the supported `_extensions` approach, registering the `zotlit` prefix so that `zotero://zotlit/ping` (a lightweight health-check used by the Obsidian side to detect that the Zotero plugin/connection is alive) and other `zotero://zotlit/...` actions resolve to its handler.

6. **Other plugins doing the same.** Better Notes (`windingwind/zotero-better-notes`, addon id `Knowledge4Zotero@windingwind.com`) registers note-link prefixes such as `zotero://note/...`; it was in fact the plugin whose author prompted Dan Stillman's `_extensions` guidance (see the verbatim thread above). zotfile historically registered `zotero://open-pdf` (removed in v5.0.13 once Zotero added a native handler).

7. **zotero-plugin-toolkit.** The `windingwind/zotero-plugin-toolkit` package provides managers for menus, keyboard shortcuts, item-tree columns, preference panes, field hooks, prompt commands, reader event listeners, etc., but it does **not** currently expose a dedicated, documented manager class specifically for registering `zotero://` protocol-handler prefixes. Plugins that need a custom `zotero://` path do it directly against `_extensions`.

## Details

### The two separate extension surfaces

| | `zotero://` protocol scheme | HTTP server endpoints |
|---|---|---|
| Registered via | `Services.io.getProtocolHandler('zotero').wrappedJSObject._extensions[prefix] = {...}` | `Zotero.Server.Endpoints["/path"] = function(){}; fn.prototype = { supportedMethods, init }` |
| Implemented in | `components/zotero-protocol-handler.js` (`ZoteroProtocolHandler`, an `nsIProtocolHandler`) | `chrome/content/zotero/xpcom/server/*` (the connector HTTP server) |
| Reached as | `zotero://<prefix>/<rest>` — clickable links inside the app / notes | `http://127.0.0.1:23119/<path>` — external browsers, scripts, apps |
| Example | `zotero://select/...`, `zotero://open-pdf/...`, `zotero://zotlit/ping` | `http://127.0.0.1:23119/connector/ping`, `http://localhost:23119/api/...` |

Note the naming collision: there is *also* a `/connector/ping` **HTTP** endpoint. Per Zotero's Knowledge Base, loading `http://127.0.0.1:23119/connector/ping` while Zotero is open "should display 'Zotero is running' or 'Zotero Connector Server is Available'." A forum `curl` shows the literal response (with headers `X-Zotero-Version: 7.0.30`, `X-Zotero-Connector-API-Version: 3`) as `<!DOCTYPE html><html><body>Zotero is running</body></html>`. `zotero://zotlit/ping` is the **protocol-scheme** analogue used internally by ZotLit and is unrelated to the connector's HTTP ping.

### How the path is parsed and dispatched

When Gecko encounters a `zotero://` URL it routes it to the registered `ZoteroProtocolHandler`. The handler implements `newChannel(uri)`, parses the URI, and looks up a sub-handler. Importantly, **as of Zotero 8 the first segment of a `zotero:` URI is parsed as the URI *host*, not as part of the path** (a documented breaking change). So for `zotero://zotlit/ping`, `zotlit` is the host/prefix used to select the extension and `/ping` is the remaining path passed to it. The matched extension's `newChannel`/`doAction` runs the action and either returns content or, when `noContent` is set, performs a side effect (e.g. selecting an item, opening a PDF) without opening a viewer.

### The HTTP endpoint API (for contrast), from the official docs

```js
var Zotero = Components.classes["@zotero.org/Zotero;1"]
    .getService(Components.interfaces.nsISupports).wrappedJSObject;

var myEndpoint = Zotero.Server.Endpoints["/myAddon/helloWorld"] = function() {};
myEndpoint.prototype = {
    "supportedMethods": ["GET"],
    "init": function (postData, sendResponseCallback) {
        sendResponseCallback(200, "text/html",
            '<!DOCTYPE html><html><head/><body>Hello world!</body></html>');
    }
};
```
Visiting `http://127.0.0.1:23119/myAddon/helloWorld` then returns the page. The `init(data, sendResponseCallback)` callback receives the query string / POST body and a function that takes `(code)` or `(code, mimeType, body)`. (Be aware Zotero 7 changed several connector endpoints; a Zotero staff member confirmed on the forums that `/connector/savePage` now returns `404 Not Found / No endpoint found` — "This feature has been removed as more and more websites block Zotero … and it's also no longer used by Zotero Connectors" — and the local Web API moved under `/api/`.)

### Working example: registering a custom `zotero://` prefix in a Zotero 7/8 plugin

Place this in your bootstrapped plugin's `startup()`. It adds a `myplugin` prefix so `zotero://myplugin/ping` and `zotero://myplugin/<action>` resolve to your code, mirroring how ZotLit registers `zotlit`.

```js
// bootstrap.js / your startup module
const ZOTERO_SCHEME = "zotero";
const PREFIX = "myplugin"; // -> zotero://myplugin/...

function getExtensions() {
    // The protocol handler's JS object holds the registry of sub-handlers
    return Services.io
        .getProtocolHandler(ZOTERO_SCHEME)
        .wrappedJSObject._extensions;
}

// Build an extension object matching Zotero's nsIProtocolHandler contract.
// AsyncChannel is provided by Zotero's protocol handler scope; in Zotero 8 it
// takes an ASYNC FUNCTION (not a generator).
function makeExtension() {
    return {
        loadAsChrome: false,   // don't load content with chrome privileges
        noContent: true,       // action-only: don't open a content viewer

        // Zotero calls newChannel(uri) to obtain a channel for the URL.
        newChannel: function (uri) {
            this.doAction(uri);
        },

        doAction: async function (uri) {
            // uri.spec === "zotero://myplugin/ping"
            // In Zotero 8 the first segment is the host; the rest is the path.
            let path = uri.pathQueryRef || uri.path; // e.g. "/ping"
            if (path.replace(/^\//, "") === "ping") {
                Zotero.debug("[myplugin] pong");
                // health check / side effect only
                return;
            }
            // ...handle other actions, e.g. open something, select an item...
        }
    };
}

// startup():
const extensions = getExtensions();
extensions[`${ZOTERO_SCHEME}://${PREFIX}`] = makeExtension();
```

And in `shutdown()` you must remove your key so Zotero is left clean on disable/uninstall:

```js
// shutdown():
const extensions = Services.io
    .getProtocolHandler(ZOTERO_SCHEME)
    .wrappedJSObject._extensions;
delete extensions[`${ZOTERO_SCHEME}://${PREFIX}`];
```

For a content-returning handler (e.g. `zotero://myplugin/report` that should display HTML), set `noContent: false` and have `newChannel` return an `AsyncChannel` whose async function writes the response body — following the same pattern Zotero core uses for `zotero://report` and `zotero://data`. Note the Zotero 8 change: `new AsyncChannel()` now takes an **async function, not a generator**, so older generator-based handlers must be rewritten.

### Important Zotero 8 / platform caveats for protocol handlers

- **`AsyncChannel` signature change:** the Zotero 8 developer docs state verbatim, *"ZoteroProtocolHandler extensions: new AsyncChannel() now takes an async function, not a generator."* Generator-based handlers must be rewritten.
- **URI parsing change:** the first segment of a `zotero:` URI is now the host, not part of the path. Handlers that previously split `uri.path` need to account for this.
- **Platform modernization (Firefox 115→140):** Zotero 8 converted JSMs to ESMs, removed Bluebird, removed `Zotero.spawn()`, and restricted `Services.appShell.hiddenDOMWindow` to macOS-fallback use ("removed outside macOS — use only as a fallback"). Zotero ships a `migrate-fx140` helper: copy the `migrate-fx140` directory into your plugin's Git repo and run `migrate-fx140/migrate.py asyncify path/to/file.js` (for Bluebird) or `migrate-fx140/migrate.py esmify path/to/Module.jsm` (for JSM→ESM).
- **The `zotero://open-pdf` reference handler:** added to Zotero core in the commit "Add zotero://open-pdf handler to open PDF at a given page," it uses the 5.0 URL format `zotero://open-pdf/library/items/[itemKey]?page=[page]` and notes that "ZotFile will need to accept the new format … since it will override this handler" — illustrating how a later-registered extension on the same prefix overrides an earlier one.
- **External-launch prompts:** when a `zotero://` action in turn launches another app's scheme (e.g. ZotLit opening `obsidian://`), Zotero 7/8 may prompt for permission; users suppress this with `network.protocol-handler.external.<scheme>` prefs and a `handlers.json` entry. This concerns *outbound* schemes, not the registration of `zotero://` itself.

## Recommendations

1. **Use the supported `_extensions` registry — never override `zotero-protocol-handler.js`.** Add your prefix in `startup()` via `Services.io.getProtocolHandler('zotero').wrappedJSObject._extensions` and `delete` it in `shutdown()`. This is exactly what Zotero's maintainer endorsed and what ZotLit/Better Notes migrated to.
2. **Pick the right tool for the job.** If you need an in-app clickable link (from notes, reports, item pages, or another app passing a `zotero://` URL to the desktop client), use the `zotero://` extension. If you need to be reachable from a browser, external script, or another running process over HTTP, register a `Zotero.Server.Endpoints` route on port 23119 instead. ZotLit uses both: HTTP/DB access for Obsidian↔Zotero data, and `zotero://zotlit/...` for in-app actions.
3. **Model your extension object on Zotero core.** Mirror the `newChannel`/`doAction` + `noContent`/`loadAsChrome` shape used by `SelectExtension` and the `zotero://open-pdf` handler in `components/zotero-protocol-handler.js`. Set `noContent: true` for action-only URLs to avoid the empty-viewer-window bug that historically affected zotfile.
4. **Test against Zotero 8 explicitly.** Account for the host-vs-path parsing change and the `AsyncChannel` async-function requirement; run the `migrate-fx140` script if your handler uses legacy JSM/Bluebird/generator patterns.
5. **For the exact ZotLit code,** inspect `lib/zotero-helper/src/zotero/` and `app/zotero/src/` in `PKM-er/obsidian-zotlit`, plus the route constants in `lib/protocol` (`@obzt/protocol`), via GitHub's in-repo code search for `_extensions`, `getProtocolHandler`, and `"ping"`. ZotLit's monorepo nature means the literal `zotlit`/`ping` strings live in the shared protocol package.

### Benchmarks that would change this advice
- If Zotero ships an official `Zotero.ProtocolHandler.register()` / plugin-API manager (as it has for menus, item-pane rows, and reader events), switch to that immediately and stop touching `_extensions` directly — direct registry access is an undocumented internal that could break.
- If `zotero-plugin-toolkit` adds a protocol/URI manager class in a future release, prefer it for automatic cleanup, the same way its menu/shortcut managers auto-unregister.

## Caveats
- `_extensions` is an **internal, undocumented** field. It works today (and is the maintainer-recommended path), but it is not a stable public API and could change between Zotero versions; guard your code and test on each major release.
- I was able to fully verify the *mechanism* (the `_extensions` registry, the maintainer's verbatim instruction on the zotero-dev list, and the `newChannel`/`doAction`/`noContent` shape from Zotero core and zotfile), but I could **not** retrieve ZotLit's exact verbatim registration lines or the literal body of its `ping` handler from source during this research (GitHub raw/CDN fetches were blocked). The description of ZotLit's `zotlit` prefix and `ping` health-check is therefore reconstructed from the repo structure, the dev-list thread, and ZotLit's documented behavior, not quoted from its source file. Treat the example code as an idiomatic, correct template rather than a copy of ZotLit's literal code.
- The exact key string ZotLit uses (`zotero://zotlit` vs `zotlit` vs `/zotlit`) and whether it cleans up with `delete` are highly likely but unconfirmed from source.
- Some details (connector endpoint behavior, external-protocol prompt prefs) come from Zotero forum posts and the dev docs; forum posts reflect specific versions and may not apply uniformly across releases.