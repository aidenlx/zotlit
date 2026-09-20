# PDF annotation probes

This record names the twenty probes that guard PDF annotation editing, tells you how to run them again, and holds the result of the last run against the exact application versions used.

## The two probe families

**The seam probes (P1 to P11)** are ZotLit's own structural guards. Obsidian's PDF reader exposes no public API for the members the overlay needs, so ZotLit checks each member before it uses it. The guards are in `apps/obsidian/src/services/pdf-annotation-editor/seam.ts`; `PDF_SEAM_MEMBERS` names the member each probe guards. They run once per binding at runtime, not in a test suite. A pass writes a `PDF reader seam probe passed` debug record. A miss writes the warning `PDF reader seam probe failed; ZotLit's PDF reader surfaces stay off for this view`, and `PdfSeamProbeLog.ok` then gates the reader surfaces alone. The annotation repository, the attachment resolver, and the Annotation View never read it, so a changed seam costs the reader its overlay and nothing more.

**The transport probes (P1 to P9)** answer one question: can Obsidian's `requestUrl()` carry the Zotero Local API write state machine? The project answered no and rejected that transport. Production calls the Zotero Local API over the Node HTTP transport in `apps/obsidian/src/lib/node-fetch.ts`, which sends no `Origin`, no user agent, and reads no proxy variable. The probes still matter, because each one establishes a fact about the wire that the production transport also depends on: the shape of a `401`, the shape of a network failure, the `204` round trip, header case, the `file:` redirect, and the absence of a timeout. Each probe below was therefore run on both transports wherever the finding can differ.

## The versions this record is against

Run date **2026-09-17**. Every number below was measured on the live applications.

| Component | Version |
| --- | --- |
| Obsidian | 1.14.2, installer 1.13.7 |
| Electron | 43.3.0, Chrome 150.0.7871.212 |
| Zotero | 10.0, platform 140.14.0, global schema 44 |
| ZotLit | 2.2.0-beta.0, Obsidian plugin and ZotLit Companion, the Zotero add-on, both active |
| PDF under test | `attachments/rougier-2014.pdf`, Fixture attachment `RGRPDF24` |

## Seam probes P1 to P11

Read the binding's verdicts from `services.pdfAnnotationEditor.bindings[0].probes` with the PDF open. Each guarded member was then read directly out of the live reader.

| Probe | Member guarded | Verdict | Evidence |
| --- | --- | --- | --- |
| P1 | `PDFFileView.file` | PASS | `view.file.path` reads `attachments/rougier-2014.pdf` |
| P2 | `PDFFileView.viewer` | PASS | `typeof viewer.then === "function"`, and `child` is a member |
| P3 | `PDFViewerHost.then` | PASS | the host resolves to `host.child`, by identity |
| P4 | `PDFViewerController.on/off` | PASS | both are functions |
| P5 | `PDFViewerController.getPage` | PASS | a function that returns a `PDFPageView` |
| P6 | `PDFViewerController.applySubpath` | PASS | a function |
| P7 | `PDFPageRenderedEvent` | PASS | captured live as `{source, pageNumber, cssTransform, isDetailView, timestamp, error}`, with `pageNumber` the number `1` and `source` a `PDFPageView` |
| P8 | `PDFPageView` | PASS | `constructor.name` reads `PDFPageView`; `div` is a `DIV`; `viewport` and `pdfPage` are present |
| P9 | `PDFPageViewport` | PASS | all nine constructor properties present, with `convertToViewportPoint` (see below) |
| P10 | `PDFViewerController.toolbar.toolbarRightEl` | PASS | `div.pdf-toolbar-right` |
| P11 | `getTextContent({ includeChars })`, `commonObjs`, and the document | PASS | 574 text items on page 1 (see below) |

The binding records the probes in the order `P1 P2 P3 P4 P5 P6 P10 P8 P9 P11 P7`. P7 is last, because it records only when a real `pagerendered` event arrives.

Two records carry a `"path": null` field. P1 and P2 run inside `load()`, before the open file path is known. P3 to P11 all carry the vault path. The count and the verdicts are unaffected.

### P9, the live viewport

`constructor.name` reads `PageViewport`. On page 1, at scale `0.6957566780146867` and rotation `0`, the nine guarded properties read:

| Property | Value |
| --- | --- |
| `viewBox` | `[0, 0, 612.28302, 790.866028]` |
| `userUnit` | `1` |
| `scale` | `0.6957566780146867` |
| `rotation` | `0` |
| `offsetX` / `offsetY` | `0` / `0` |
| `transform` | `[0.6957…, 0, 0, -0.6957…, 0, 550.2503…]` |
| `width` / `height` | `425.99999999999994` / `550.2503203959502` |

One further own property is present and is not guarded: `rawDims`. The prototype carries `clone`, `convertToViewportPoint`, `convertToViewportRectangle`, and `convertToPdfPoint`, all functions. The pair that P9 permits but type-checks when present, `clone` and `convertToPdfPoint`, is therefore present on 1.14.2, and the division fallback is not exercised on this version.

The nine properties are guarded strictly: `VIEWPORT_NUMBERS` in `seam.ts` contains `userUnit`, so a viewport without `userUnit` fails P9. A shipped Obsidian cannot be made to drop a member, so the negative half is covered by `seam.test.ts`, which passes 38 tests. Those include one failure case for each of `viewBox`, `userUnit`, `scale`, `rotation`, `offsetX`, `offsetY`, `transform`, `width`, `height`, and `convertToViewportPoint`, a failure case for `clone` and `convertToPdfPoint` present but no longer methods, and a pass case for a viewport with neither.

### P11, the live text source

`page.pdfPage.getTextContent({ includeChars: true })` on page 1 returns 574 items and 4 style entries. One chunk carries the keys `str`, `dir`, `width`, `height`, `transform`, `fontName`, `hasEOL`, and `chars`; `transform` has six entries and `fontName` is the string `g_d13_f1`. Its first glyph reads `{ c: "E", u: "E", r: [58.0535, 726.9241392, 64.150601, 737.4685374] }`.

P11 guards more than the text call. `page.pdfPage.commonObjs` is a `PDFObjects` with `has` and `get` as functions, and `controller.pdfViewer.pdfDocument` reports `numPages` `7` with `getPage` and `getPageLabels` as functions. Every member the guard asserts is present on the live seam.

## Transport probes P1 to P9

### The gate: a bare `requestUrl` cannot talk to Zotero 10

Run this check first. Every other transport finding depends on it.

| Call | Result |
| --- | --- |
| Bare `requestUrl` GET to the Zotero Local API | Rejects with `net::ERR_EMPTY_RESPONSE` |
| `requestUrl` with `Zotero-Allowed-Request: 1` | `200`, full body |
| Node `http`, with or without the header | `200` both ways |
| `@electron/remote` `net.request`, no opt-out | Rejects with `net::ERR_EMPTY_RESPONSE` |

Chromium adds `User-Agent: Mozilla/5.0 (…) obsidian/1.13.7 Chrome/150.0.7871.212 Electron/43.3.0 …` to every renderer-side request. Zotero reads a `User-Agent` that starts with `Mozilla/` as browser traffic and answers by closing the socket. The caller therefore sees a transport rejection with no status and no body, which is not a failure a status-code branch can catch. `Zotero-Allowed-Request: 1` is mandatory on every call from a Chromium-backed transport. The Node transport sends no user agent at all, so it never meets the refusal; ZotLit sends the header on every call regardless.

### The nine probes

| Probe | What it asks | Verdict | Evidence |
| --- | --- | --- | --- |
| P1 | Does a write with no key return a normal `401`, rather than an authentication rejection? | PASS | Both transports: `401`, `www-authenticate: Zotero-API-Key realm="Zotero Local API"`, body `API key required -- POST /api/local/authorize to obtain one` |
| P2 | What shape does a network error take? | PASS | `requestUrl`: an `Error` with message `net::ERR_CONNECTION_REFUSED` and **no own keys**, so no `status` and no `headers`. Node: an `Error` with `code` `ECONNREFUSED` |
| P3 | Does a `204` resolve cleanly? | PASS | `requestUrl` DELETE: `204`, `last-modified-version: 5`, `text` `""`, `arrayBuffer.byteLength` `0`, and `json` throws `SyntaxError`. Node DELETE: `204`, `statusMessage` `No Content`, 0 bytes |
| P4 | Do header names reach Zotero in the case they were sent in? | PASS | Both transports sent `Zotero-API-Key`, `Zotero-Server-ID`, `If-Unmodified-Since-Version`, `Zotero-Write-Token`, and `Zotero-Allowed-Request` byte for byte in the case given |
| P5 | Which wins, `contentType` or a `Content-Type` header? | PASS | The `headers` entry wins in both argument orders: `text/plain; charset=utf-8` reached the wire while `contentType` was set to `application/json` |
| P6 | Can a repeated GET be served from a cache? | PASS | Against a server that sends `Cache-Control: max-age=300`, a second identical `requestUrl` GET did not reach the server, and `Cache-Control: no-cache` on the third call did. Node reached the server every time. Against real Zotero, which sends no `Cache-Control`, no `ETag`, and no `Last-Modified`, the repeated `requestUrl` GET reached Zotero and returned the changed value |
| P7 | What happens to the `file:` redirect? | PASS | `requestUrl` on `/file` rejects with `net::ERR_UNSAFE_REDIRECT`. Node returns the `302` itself, with `Location` a `file:` URI, and does not follow it. `/file/view/url` answers `200 text/plain` on both, with a `file:` URI as the body, not a bare path |
| P8 | Does a hung request time out? | PASS | `requestUrl` stayed pending for 722 s against a route that never answers, with no rejection. Node `http` stayed pending. Node with an `AbortSignal` rejected at 2003 ms with `AbortError` |
| P9 | Does a write through `@electron/remote` `net.request` round trip? | PASS, with two caveats | PATCH answered `204`; `rawHeaders` preserved Zotero's own case while `headers` were lower-cased; `redirect: "manual"` stopped the `file:` redirect and returned `redirectUrl` with the error `Redirect was cancelled`; `cache: "no-store"` was accepted; `abort()` on an in-flight request emitted `abort` |

The two P9 caveats: `net.request` through `@electron/remote` carries the same Chromium user agent, so it needs `Zotero-Allowed-Request: 1` exactly like `requestUrl`; and event order over the remote bridge is not the main-process order. `close` arrived before `response` on every request measured, and before `abort` on the aborted one. Do not use `close` as a completion signal from the renderer.

### Further facts from the same run

**Headers `requestUrl` adds on 1.14.2**, captured on the wire: `Sec-Fetch-Site: none`, `Sec-Fetch-Mode: no-cors`, `Sec-Fetch-Dest: empty`, the Chromium `User-Agent` above, `Accept-Encoding: gzip, deflate, br, zstd`, `Accept-Language`, plus `Host` and `Connection: keep-alive`. There is no `Origin` and no `Cookie`. Obsidian 1.13.4 deleted `sec-fetch-dest` before sending; 1.14.2 puts it on the wire. Zotero ignores it.

**Headers the Node transport adds**: `Host`, `Connection: keep-alive`, and exactly what the caller set. Nothing else.

**The `throw` default costs you the body.** With `throw` left at its default, a `428` came back as a rejection that carried `status: 428` and `headers`, and no body. The same call with `throw: false` resolved and carried the body `Zotero-Server-ID not provided`. Read a failure body only with `throw: false`.

**Response header case.** `requestUrl` lower-cases every response header name. A deliberately odd `Zotero-Weird-Case` header read back as `zotero-weird-case`. Node `rawHeaders` and remote `net` `rawHeaders` keep Zotero's case.

**Zotero's reason phrase is unusable.** Zotero answers `HTTP/1.0 401 undefined` and `HTTP/1.0 428 undefined`. The status line carries the literal string `undefined` for several statuses, and Node surfaces it as `statusMessage === "undefined"`. Only `204` says `No Content`. Branch on the status code, never on `statusText`.

## Reproduce the run

1. Start a Paired Run with the Zotero Local API open:

   ```sh
   pnpm fixture open --local-api
   ```

   The command needs desktop Obsidian running with **Settings → General → Advanced → Command line interface** enabled. See [The Fixture](fixture.md).

2. Read the ready report. It names the Development Vault, the Live Updates port, the Zotero HTTP port, the Zotero RDP port, and the Zotero Local API base URL. Each probe below writes `<port>` for the Zotero HTTP port and `<rdp-port>` for the RDP port; both are chosen per run.

3. Run the seam probes by opening `attachments/rougier-2014.pdf` in the Development Vault with the log level at **debug**, then reading the eleven `PDF reader seam probe passed` records in the developer console. Read the same verdicts as data from the binding's `probes` getter.

4. Run the transport probes from the developer console of the same window for the `requestUrl` half, and from `require("http")` in that console for the Node half. That is the same stack `nodeFetch` uses. Drive the Zotero half over RDP with `apps/zotero/scripts/debug/rdp-eval.ts` against `<rdp-port>`.

5. Rebuild the Fixture afterwards with `pnpm fixture`. A probe run leaves seeded annotations behind.

### The loopback proxy trap

A machine that exports `http_proxy` must bypass it for `127.0.0.1`. Without the bypass, Zotero's connection-close refusal of browser traffic arrives as the proxy's own `503` HTML page, and every local API failure reads as an unrelated status. Pass `--noproxy '*'` to `curl`. The production Node transport reads no proxy variable, which is one reason it is the production transport.

## When to run the probes again

- **The seam family: on every Obsidian upgrade.** The eleven probes guard private members of Obsidian's PDF reader. A minor release can move any of them. The probes fail closed, so a missed change costs the reader its overlay silently until someone reads the warning.
- **The transport family: before a write release.** The nine probes describe how a failure reaches the caller. A release that changes the transport, the Zotero major version, or the Electron version needs them again.

## The large-set measurement

The set was built on `RGRPDF24`, which starts with 7 seeded annotations. 100 further annotations were created over RDP inside one `Zotero.DB.executeTransaction`, which took 252 ms. They cover the seven pages of the PDF and the types highlight, underline, note, image, and ink, cycling Zotero's eight-colour palette, with real page positions and a Sort Index per annotation. Every fourth one carries a comment. The pre-existing seven supply the `text` type. Six further annotations were created for the latency, overlap, and cross-page measurements. The final count was **113**.

Zotero refuses a transaction that creates `text`-type annotations and calls `addTag` inside it, and rolls the whole transaction back. Seed tags in a separate transaction.

### Completeness

| Check | Measured | Verdict |
| --- | --- | --- |
| Local API total against Zotero's own count | `Total-Results: 108` against `getAnnotations(true).length` `108`; key sets identical, zero overlap, zero missing | PASS |
| The page boundary of the children walk | `limit=100&start=0` returned 100 items, `limit=100&start=100` returned 8; union 108, intersection 0 | PASS |
| Annotation View cards against Zotero | 110 cards and the header "110 of 110" against Zotero's 110; 113 and "113 of 113" at the end of the run | PASS |
| The list is not truncated | The `.zt-annot-card` count equals the header count; the view is not virtualised | PASS |

### Responsiveness

Every timing comes from `performance.now()` inside the renderer. The method is stated beside each number.

| Measurement | Method | Number |
| --- | --- | --- |
| Full list rebuild, 107 cards | `annotations-changed` to the last `MutationObserver` record on the view container | 120.3 ms and 100.3 ms on two rebuilds. The intermediate record shows the list going to 0 cards and back, so this is a teardown and rebuild, not a diff |
| Mount of a 110-card list | `openFile(note)` to the mutation records | First record at 34.4 ms, all 110 cards in the DOM at 62.5 ms, last record at 94.8 ms |
| Local API refetch of 110 annotations | Query invalidation to the resolution of `repository.read` | 26.7 ms for two pages of the children route |
| Re-render on an identical list | Mutation records after that refetch | 0 records. An unchanged list costs no DOM work |
| Long tasks during a 110-card rebuild | `PerformanceObserver({entryTypes:["longtask"]})` | None. No task longer than 50 ms |
| Main-thread responsiveness during the same rebuild | `requestAnimationFrame` round trip sampled every 16 ms, 486 samples | Median 8.5 ms, p95 16.5 ms, maximum 18.3 ms |
| Overlay census, 3 rendered pages | DOM count per `.zt-pdf-annotation-overlay` | Page 1: 23 marks in 27 nodes. Page 2: 16 in 20. Page 3: 15 in 19. The overlay is one `<svg>` per page |
| Overlay repaint after one zoom step of 1.25 | `requestAnimationFrame` poll of the overlay width until it reaches the expected value | Overlay gone at 6.4 ms, back and correctly sized at 69.9 ms, 873 px measured against 872.5 px expected. 23 marks redrawn |
| Overlay geometry under the same zoom step | `getBoundingClientRect()` before and after | 559 × 722 to 698 × 902, against 698.75 × 902.5 expected |

### A Zotero-side change reaches an open surface, and a lost Live Updates channel is silent

**With Live Updates connected, the path works.** Measured on a wired Paired Run: a Zotero-side create reached the Annotation View, 7 cards to 8, and the reader overlay, 9 marks to 10, in under 2 s. A Zotero-side colour and comment change reached the card text and the mark's computed `fill` in about 1.1 s: still stale at 29 ms, arrived by 1114 ms.

**With the Live Updates listener off, nothing arrives and nothing says so.** Reproduced deliberately: a Zotero-side comment change never reached the card, the card kept its stale text, and the header still read "8 of 8". This is the documented degradation, not a defect in the data path. The Freshness Signal is the only trigger on the Local API path, so with no Live Updates connection the `zotero-local-api` partition is never invalidated. Only `db.on("changed")` fires, and that drops the `zotero-db` partition. Turning the channel back on recovered the list on the next Zotero-side save.

What is a real finding is that the degradation is silent. The view gives the user no sign that it can no longer hear Zotero. The live-updates state is consumed in one place, the empty state of the `zotero-reader` follow mode in `apps/obsidian/src/views/annot-view/presentation.ts`. Under follow-active-tab or pinned, with a list showing, nothing surfaces it. The [release checklist](release-checklist.md) carries it as a known limitation.

Read the Live Updates receiver from `services.localServer.available`. `services.localBridge` is the Workbench bridge and reads falsy on a healthy Paired Run.

## Two wire facts about the children route

**A malformed Zotero key silently returns another document's annotations.** `GET /api/users/0/items/RGRPDF10/children?itemType=annotation` carries a key with the excluded letters `0` and `1`. Zotero 10.0, schema 44, answers `200` with ten annotations that span three different parent attachments, `RGRPDF24`, `PDFSTR22`, and `CNPDF26A`. Zotero drops the parent constraint rather than rejecting the key. A key from the valid alphabet that names nothing, such as `ZZZZZZZZ`, is the one that answers `[]`. ZotLit is protected because `parseIndexedKey` rejects such a key before the request is sent, and that guard is load-bearing: a caller that builds a key by string concatenation can read another document's annotations and get a `200`.

**`itemType=annotation` is load-bearing on the children route.** Without it, `children?sort=dateAdded&direction=asc` answers `Total-Results: 0` for `RGRPDF24`.

## Four undocumented behaviours File Link Capture stands on

File Link Capture ([ADR 0045](../apps/obsidian/docs/adr/0045-file-link-capture-patches-window-open.md)) reads four behaviours Obsidian documents nowhere. All four were read out of the 1.14.2 renderer bundle, `node_modules/.ob-rev-1.14.2/app.js`. **None is live-measured yet**, so they carry no verdict in the tables above; a Paired Run has to confirm them before the release. Re-verify all four against a fresh extraction whenever `minAppVersion` moves.

| Behaviour | Where it is read | Why Capture needs it |
| --- | --- | --- |
| Every external-link click ends at `window.open(href, target)` | The reading-view delegate `t.on("click", "a.external-link", ...)` and `onExternalLinkClick`; the Live Preview path `triggerClickableToken`, which reads the URL off the CodeMirror tree because no anchor exists in that view; the Properties and Bases renderers | It is the only symbol all four paths share, so it is the only complete place to take the click |
| `"_external"` is the target Obsidian's own "Open in default browser" item passes | `handleExternalLinkContextMenu`, which also triggers the public `url-menu` event | Capture hands that target straight back, which is what keeps the per-link way out working |
| `Vault.getFileByPath("file:<abs>")` falls through to the external file manager | `getFileByPath` → `externalFileManager.getExternalFile`, gated on `Platform.isDesktopApp` | How an Attachment outside the vault reaches Obsidian's reader at all. Already relied on by the four existing open gestures |
| The PDF view reads a page jump off `eState.subpath` as the string `"#page=N"` | `PDFView.setEphemeralState` → `applySubpath`, which parses the fragment with `URLSearchParams` and also accepts `offset`, `annotation`, `selection`, and `height` | How a link's `#page=N` lands on the right page |

A change to the first two costs Capture its clicks; the link then opens in the system app, which is what happened before the feature existed. A change to the third or fourth is already covered by the reader seam's own failure mode: a notice, not a wrong file.

## Two undocumented behaviours Mark Landing stands on

Mark Landing ([ADR 0046](../apps/obsidian/docs/adr/0046-landing-on-a-mark-is-an-ephemeral-state-contract-read-at-the-leaf.md)) reads two more. Both were read out of the same 1.14.2 bundle, neither is live-measured yet, and both are re-verified whenever `minAppVersion` moves.

| Behaviour | Where it is read | Why Mark Landing needs it |
| --- | --- | --- |
| `WorkspaceLeaf.setEphemeralState` is the only path the ephemeral state takes to a view | `setViewState`, which calls it unconditionally whenever an ephemeral state is given and compares nothing; the deferred view, which stores the whole object and replays it verbatim through `setViewState` on rerender; `History.updateState`, which restores through the same call | It is the one documented symbol every delivery path crosses, and the PDF view keeps nothing once the call returns |
| An unknown key in a PDF fragment is inert | `applySubpath`, which parses the fragment with `URLSearchParams` and reads `page`, `offset`, `annotation`, `selection`, and `height` by name, looping over nothing | An Annotation Anchor rides beside `#page=N` without disturbing it, so a reader that is not listening still lands on the page |

A change to the first costs a Landing its Anchor; the link then opens on its page, which is what ADR 0045 alone already did. A change to the second would have Obsidian claim `zt-annotation` for itself, which renaming the key answers.

## See also

- [The Fixture](fixture.md), for the Paired Run and the Zotero Local API trial.
- [Release checklist](release-checklist.md), for the checks that stay manual.
- Issues [#1139](https://github.com/aidenlx/zotlit/issues/1139) and [#1152](https://github.com/aidenlx/zotlit/issues/1152), for the specification these probes serve.
