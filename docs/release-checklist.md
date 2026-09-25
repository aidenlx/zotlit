# Release checklist

Run this checklist before a release that carries PDF annotation editing. It names every check that a person still runs by hand, and the reason each one stays manual.

Record the outcome of each check in the release pull request.

## What is already automated

Do not repeat these by hand.

- **The End-to-end Run suite.** `pnpm e2e` starts the plugin in a real desktop Obsidian window against the Fixture Zotero data. Its Paired Run scenario needs the Zotero Local API, so run `pnpm fixture open --local-api` first, then `pnpm e2e`. See [The Fixture](fixture.md).
- **The probe record.** The eleven seam probes, the nine transport probes, the large-set measurement, and the thirteen checks converted to measurements on 2026-09-17 are in [PDF annotation probes](pdf-annotation-probes.md). That page also says when each probe family needs a fresh run.
- **The unit and integration suites.** `pnpm test` covers the hit-test arithmetic, reading order, the Mark Popup lifecycle, the capability copy tables, the write-outcome classification, the write-token replay, and the seam guards against a synthetic viewport.

## Before you start

1. Install Obsidian 1.14.2 or later. Enable **Settings → General → Advanced → Command line interface**.

2. Open a Paired Run with the Zotero Local API:

   ```sh
   pnpm fixture open --local-api
   ```

   The ready report names the Development Vault and its id, the Live Updates port, the Zotero HTTP port, the Zotero RDP port, and the Zotero Local API base URL. The steps below write `<vault-id>`, `<port>`, and `<rdp-port>` for those values. Each one is chosen per run.

3. In Obsidian, set **Settings → ZotLit → Advanced → Log level** to **debug**, and open the developer console with `Ctrl`/`Cmd` + `Shift` + `I`.

4. Print the Fixture paths when a step needs one:

   ```sh
   pnpm fixture paths
   ```

   `<profile>` below is the Fixture Zotero profile directory.

5. Rebuild the Fixture with `pnpm fixture` after the run. The checks below write to Zotero and leave the Fixture dirty.

### Setup precondition: the Rougier attachment is a linked file

The Zotero attachment `RGRPDF24` for `rougier-2014.pdf` is a linked file, not a stored copy. Only `pnpm fixture open` repoints that link at the Development Vault. After a bare `pnpm fixture build` the link points elsewhere, the attachment resolves as `{ kind: "unresolved" }`, and the reader draws no overlay at all.

This is a precondition, not a defect. If a check that expects marks finds none, confirm the `PDF view resolved` console record before you look anywhere else.

## The reader surfaces

### The marks sit where the Zotero Reader draws them

**Why it is not automated:** a side-by-side aesthetic judgement of two rendered pages. Provenance: [#1142](https://github.com/aidenlx/zotlit/issues/1142).

**Setup:** the Paired Run, with `attachments/rougier-2014.pdf` open in Obsidian and the same attachment open in the Zotero Reader.

**Steps:**

1. Put the two windows side by side on the same page.
2. Compare each mark against the Zotero Reader: the highlight fills its lines, the underline sits on the baseline of its rectangles, the note is a small coloured square with a folded corner, the image is an unfilled outline, the ink follows the drawn stroke at its stored width, and the free text shows its comment at its font size.
3. Zoom through the reader's own steps and rotate the page through all four rotations. Compare again.

**Expected:** every mark covers the same words or region in both readers, in the same colour, at every zoom step and rotation.

**If it fails:** the page-unit geometry or a per-type primitive is wrong. Compare the overlay's `viewBox` with the page box; they must be equal and must not change with zoom.

### An unresolved PDF looks exactly like ZotLit disabled

**Why it is not automated:** an aesthetic judgement about a rendered page. Provenance: [#1140](https://github.com/aidenlx/zotlit/issues/1140), [#1141](https://github.com/aidenlx/zotlit/issues/1141), [#1143](https://github.com/aidenlx/zotlit/issues/1143).

**Setup:** the Paired Run, plus any PDF in the Development Vault that no Zotero attachment points at.

**Steps:**

1. Open it and read its `PDF view resolved` record.
2. Scroll, select text, follow a link, and use the reader's own toolbar.
3. Disable ZotLit, reopen the same file, and compare.

**Expected:** `attachment` reads `{ kind: "unresolved" }`, no notice appears, and nothing in the reader differs from the ZotLit-disabled case. The measurable half is already probed: 0 overlay nodes, 0 marks, and 0 `.notice` nodes.

**If it fails:** an unresolved lookup is costing the reader something. The resolver answers data only and raises no UI.

### A selected mark reads as selected in both themes

**Why it is not automated:** a legibility judgement about colour on a rendered page. Provenance: [#1148](https://github.com/aidenlx/zotlit/issues/1148).

**Setup:** the Paired Run, with the PDF open and one mark of each type on screen.

**Steps:** select a highlight, an underline, a note, an image box, and an ink stroke in turn. Look at each in the default light theme and in the default dark theme.

**Expected:** the selected state is visible on all five, and the annotation's own colour is unchanged. The measured treatment is a `drop-shadow` of `rgb(138, 92, 245)` in light and `rgb(166, 138, 249)` in dark, at 2 px.

**If it fails:** the `drop-shadow` treatment needs replacing. It was chosen because a stroke is already how an underline and an ink path are drawn.

### Pointer input over a mark still belongs to the page

**Why it is not automated:** a real trusted-input drag, and a real PDF link target. Synthetic pointer events do not exercise the text layer's own drag. Provenance: [#1142](https://github.com/aidenlx/zotlit/issues/1142), [#1148](https://github.com/aidenlx/zotlit/issues/1148).

**Setup:** the Paired Run, with the PDF open at a page where a highlight covers running text. The bibliography of `rougier-2014.pdf` carries internal links; highlight text that contains one first, in the Zotero Reader, and refresh ZotLit.

**Steps:**

1. Drag across text that a highlight covers, over several words, and release.
2. Click once inside the same highlight.
3. Click the link under a mark. Then `Alt`-click the same point.
4. Select a mark so the Mark Popup opens, then drag-select text elsewhere on the page.

**Expected:** step 1 leaves the browser's own text selection standing, selects no mark, and opens no popup. Step 2 collapses the selection and selects the mark. In step 3 the plain click follows the link and opens no popup; the `Alt`-click selects the mark and does not follow the link. Step 4 deselects the mark and closes the popup as soon as the selection becomes non-empty.

**If it fails:** the four-pixel travel rule, the collapsed-selection rule, or the link-precedence rule is not reaching the real gesture. Record what the click's `event.target` actually is.

### A text selection opens the create popup

**Why it is not automated:** a real trusted-input drag. The DOM-observable half is already probed: a synthetic gesture opens the popup with twelve controls. Provenance: [#1150](https://github.com/aidenlx/zotlit/issues/1150).

**Setup:** the Paired Run, with the PDF open.

**Steps:**

1. Drag across a sentence on page 1 and release.
2. Start a drag outside the page, in the reader's margin, drag onto the page, and release.
3. Drag across a sentence that runs over a page break.

**Expected:** step 1 opens the popup under the bottom centre of the selection, carrying **Highlight**, **Underline**, the eight Zotero colours, **Add comment**, and **Copy selected text**. Step 2 opens nothing. Step 3 opens one popup, and committing it creates one annotation whose position carries `nextPageRects`.

**If step 2 opens a popup:** the drag-start test is reading the release point rather than the press point.

### A PDF opened from outside the vault resolves and mounts

**Why it is not automated:** Obsidian's external-file open has no CLI route. Provenance: [#1140](https://github.com/aidenlx/zotlit/issues/1140), [#1141](https://github.com/aidenlx/zotlit/issues/1141).

**Setup:** the Paired Run, plus **Settings → Files and links → Detect all file extensions** on. The file is `<dataDir>/storage/PDFSTR22/sakimas-song.pdf`, where `<dataDir>` is the Zotero data directory `pnpm fixture paths` names.

**Steps:**

1. Open that file through Obsidian's external-file open, or from Zotero with **Open in Obsidian**.
2. Read the `PDF view resolved` record.
3. Scroll through several pages.

**Expected:** `path` begins with `file:` and continues with the absolute path, with no vault folder in front of it. `attachment` reads `{ kind: "resolved", attachmentKey: "PDFSTR22", itemKey: "SAKIMA22" }`. Eleven passing seam probes appear once, and scrolling adds no further probe records and raises no error.

**If it fails:** a `path` that carries the vault folder means the `file:` prefix was not stripped before the full-path lookup, which breaks the resolver. A resolution of `unresolved` means the `storage:` expansion is not landing on Zotero's `<dataDir>/storage/<key>/<filename>` layout.

### A linked file typed in another case still resolves

**Why it is not automated:** it needs a real case-insensitive volume, which the Fixture does not provide. The unit tests inject the platform, so they prove the fold rule and not the volume's behaviour. Provenance: [#1141](https://github.com/aidenlx/zotlit/issues/1141).

**Setup:** the Paired Run, on macOS or Windows.

**Steps:**

1. In Zotero, open **Tools → Developer → Run JavaScript** and read the stored path: `(await Zotero.Items.getAsync(47)).attachmentPath`.
2. Write the same path back with one segment's case changed, for example `Attachments` for `attachments`.
3. In Obsidian, close and reopen `attachments/rougier-2014.pdf`.
4. Refresh the ZotLit database from **Settings → ZotLit → Zotero**, or wait for the watcher.

**Expected:** the `PDF view resolved` record still reads `attachmentKey: "RGRPDF24"`.

**If it fails on Linux:** that is the intended behaviour. A Linux volume holds both casings as two files, so the key keeps its case there.

**If it fails on macOS or Windows:** the platform branch is not reaching the path-key fold in production. The resolver takes the platform from `process.platform` by default.

### A Windows linked file stored with backslashes resolves

**Why it is not automated:** Windows-only behaviour. Zotero writes the separators of the host platform, so the mismatch exists only on a real Windows install. Provenance: [#1141](https://github.com/aidenlx/zotlit/issues/1141).

**Setup:** the Paired Run, on Windows.

**Steps:**

1. Confirm the stored separators in Zotero: **Tools → Developer → Run JavaScript**, `(await Zotero.Items.getAsync(47)).attachmentPath`.
2. Open `attachments\rougier-2014.pdf` in the Development Vault.

**Expected:** the record's `path` uses forward slashes, and `attachment` reads `{ kind: "resolved", attachmentKey: "RGRPDF24", itemKey: "RUGIER24" }`.

**If it fails:** the separator collapse is not reaching one side of the lookup.

### A change in a real Zotero library reaches the next lookup

**Why it is not automated:** it needs a real Zotero library that the Fixture cannot stand in for, because the check moves a linked file out of the Fixture tree. Provenance: [#1141](https://github.com/aidenlx/zotlit/issues/1141).

**Setup:** the Paired Run.

**Steps:**

1. Open `attachments/rougier-2014.pdf` and note the resolved keys.
2. In Zotero, move that attachment's linked file to another folder and relink it.
3. Refresh the ZotLit database, or wait for the Freshness Signal.
4. Close the PDF tab and open the file at its new location.

**Expected:** one `Attachment path index dropped` record with `reason: "database changed"`, then a fresh `Attachment path index built`, then a `PDF view resolved` naming `RGRPDF24` at the new path. The old path now reads `{ kind: "unresolved" }`.

**If it fails:** the index is outliving a database change. The drop is wired to the database service's `changed` event.

### A seam failure costs the reader alone

**Why it is not automated:** no probe can make a private member absent on a shipped Obsidian. Provenance: [#1140](https://github.com/aidenlx/zotlit/issues/1140).

**Setup:** run this check only when a future Obsidian release makes a seam probe fail on its own.

**Steps:**

1. Open any PDF and read the console for `PDF reader seam probe failed`.
2. Scroll the PDF, then use the Annotation View, the attachment resolver, and every other ZotLit surface.

**Expected:** one warning that names the probe and the member. The PDF still opens and scrolls. Every ZotLit surface outside the reader keeps working.

**If it fails:** the fail-closed rule is not holding, and a seam change is costing more than the reader surfaces. Re-verify the member the warning names against [PDF annotation probes](pdf-annotation-probes.md).

### The overlay and the popup in a pop-out window

**Why it is not automated:** dragging a tab out and back is a real trusted-input drag, and Obsidian exposes no dock-back API. The rest of the check is drivable, and the pop-out overlay itself is already probed. Provenance: [#1142](https://github.com/aidenlx/zotlit/issues/1142), [#1148](https://github.com/aidenlx/zotlit/issues/1148).

**Setup:** the Paired Run, with the PDF open in the main window.

**Steps:**

1. Drag the PDF tab out into its own window.
2. Zoom and scroll there. Select a mark, and repeat the overlap and re-render steps of the Mark Popup checks in that window.
3. Drag the tab back into the main window and repeat step 2.

**Expected:** the marks are drawn in the pop-out window and stay aligned through zoom and scroll. The Mark Popup appears in the pop-out window, never in the main window. Both hold after the tab returns. No console error mentions a cross-window type check.

**If a node lands in the wrong window:** something was created against the wrong document. Every element is built from the page's own `ownerDocument`, and a popover with no target element goes to `activeDocument`.

### Obsidian's glyph stream agrees with Zotero's

**Why it is not automated:** this reason is not an intrinsic barrier. The parity test drives the adapter with glyphs rebuilt from Zotero's records, because the only PDF.js build with `getTextContent({ includeChars: true })` runs inside Obsidian. The live reader can answer it, and a driven probe should take it over. Provenance: [#1149](https://github.com/aidenlx/zotlit/issues/1149).

**Setup:** the Paired Run, with `attachments/rougier-2014.pdf` open.

**Steps:** run this in the developer console.

```js
const view = app.workspace.getActiveViewOfType(
  app.viewRegistry.getViewCreatorByType("pdf")().constructor,
);
const viewer = await new Promise((r) => view.viewer.then(r));
const page = await viewer.pdfViewer.pdfDocument.getPage(1);
const { items } = await page.getTextContent({ includeChars: true });
const glyphs = items.flatMap((i) => i.chars ?? []);
const isControl = (code) => code <= 0x1f || (code >= 0x7f && code <= 0x9f);
const kept = glyphs.filter((g) => g.c !== " " && !isControl(g.c.charCodeAt(0)));
console.log(
  "raw", glyphs.length,
  "spaces", glyphs.filter((g) => g.c === " ").length,
  "controls", glyphs.filter((g) => isControl(g.c.charCodeAt(0))).length,
  "kept", kept.length,
);
```

**Expected:** `raw 6242`, `spaces 915`, `controls 0`, `kept 5327`. 5327 is the number of Structured Characters Zotero's own extraction produces for page 1 of that PDF.

**If it fails:** a different `kept` count means the filter rules do not land Obsidian's stream on Zotero's, and every Sort Index offset past the first difference is wrong on that page.

### Mark selection details not yet driven

**Why they are not automated:** this reason is not an intrinsic barrier. Each of these is DOM-observable and was left out of the 2026-09-17 probe run for time. Run them by hand until a driven probe takes them over. Provenance: [#1148](https://github.com/aidenlx/zotlit/issues/1148).

**Setup:** the Paired Run, with the PDF open and the Annotation View beside it in **Active tab** mode. For the two-page step, first highlight a sentence that runs across a page break in the Zotero Reader, then refresh ZotLit.

**Steps:**

1. Select the half of the two-page mark on the first page, then scroll to the second page and select the half there.
2. Focus the reader with nothing selected. Press `↓` four times, then `↑` twice. With a mark selected press `3`, then `Delete`, then `Escape`.
3. Click a card whose mark is on another page.
4. With the Mark Popup open, hover a wiki link in a note in another pane so Page Preview opens.
5. With the popup open, move the pointer well away for five seconds, then click the copy verb, then a blank part of the page, then another pane of the workspace.

**Expected:** step 1 selects one annotation from both halves, and the popup follows whichever half is on screen. Step 2 walks the annotations in reading order and brings the reader to each, recolours the selected mark green, removes it once Zotero confirms, and then deselects and closes the popup. Step 3 selects the mark, opens the popup on it, and moves the reader to its page. Step 4 leaves both popovers standing. In step 5 the wait and the copy verb leave the popup open, and each of the two clicks closes it and deselects.

**If the keyboard walk uses a different order:** compare it with the card order in the Annotation View. The cards keep Zotero's Sort Index and the walk is geometric, so a visible disagreement is worth reporting against [#1139](https://github.com/aidenlx/zotlit/issues/1139).

## The Annotation View

### The menu wears Obsidian's chrome in a real window

**Why it is not automated:** an aesthetic judgement about a rendered window. The tests assert the class names and the DOM shape, not that the result looks like an Obsidian menu. Provenance: [#1146](https://github.com/aidenlx/zotlit/issues/1146).

**Setup:** the Paired Run, with the Annotation View open on a literature note whose item has two or more attachments.

**Steps:**

1. Select the mode button at the start of the Annotation View toolbar.
2. Compare the menu against a native Obsidian menu, such as the file explorer's context menu, side by side.
3. Select the attachment line under the toolbar and compare again.
4. Repeat both with a community theme applied, and in dark mode.

**Expected:** the menu sits under its button, inside the window, with Obsidian's own background, border, radius, item height, hover highlight, and check glyph. It does not collapse onto its border and it does not overflow the window.

**If it fails:** a collapse means Obsidian's own `position: fixed; max-height: 100%` menu rules are reaching the popup; a misplacement means the positioner is not owning placement.

### The menu opens in the window it was opened from, and long lists scroll

**Why it is not automated:** this reason is not an intrinsic barrier for the scroll half, which needs only a real viewport and an item with many attachments. The pop-out half needs a second Electron window and a tab drag. Provenance: [#1146](https://github.com/aidenlx/zotlit/issues/1146).

**Setup:** the Paired Run, with the Annotation View open. For the scroll step, pin an item that holds more attachments than fit the window height, about fifteen on a short window.

**Steps:**

1. Drag the Annotation View out of the sidebar into its own window.
2. In the pop-out, select the mode button, then the attachment line.
3. With the long attachment list open, scroll it with the wheel and with the arrow keys.

**Expected:** both menus appear in the pop-out window, under their buttons, and neither appears in the main window. The long list scrolls inside the menu and every entry is reachable.

**If a menu opens in the main window:** the portal container is not reaching the menu. Obsidian's default is the main window's `document.body`.

### The mode survives a restart, per view instance

**Why it is not automated:** this reason is not an intrinsic barrier beyond the restart itself, which needs Obsidian's own workspace serialization and a quit. Provenance: [#1146](https://github.com/aidenlx/zotlit/issues/1146).

**Setup:** the Paired Run, with two Annotation Views open in a split.

**Steps:**

1. Set the first view to **Zotero reader**.
2. Set the second view to **Pinned**, on any item.
3. Quit and reopen Obsidian.

**Expected:** each view comes back in the mode it was in. The pinned view comes back on the same item with the same attachment chosen.

**If it fails:** Obsidian's layout save did not fire. The view asks for one on every mode change.

### An upgraded vault keeps the mode it had

**Why it is not automated:** it needs a `workspace.json` written by the released build, which the Fixture does not produce. Provenance: [#1146](https://github.com/aidenlx/zotlit/issues/1146).

**Setup:** a vault whose `.obsidian/workspace.json` was written by ZotLit 2.x before this release, carrying `"followMode": "reader"` or `"linked"` under a `zotero-annotation-view` leaf. Install this build over it.

**Steps:** open the vault and read the Annotation View's mode button.

**Expected:** `note` comes back as **Active tab**, `reader` as **Zotero reader**, and `linked` as **Pinned** on the item the stored key names.

**If it fails:** record the actual JSON. The stored shape differs from what the migration test feeds the parser.

Two remembered choices per item change shape in this release and fall back silently rather than migrating. The stored attachment choice held a numeric attachment id and now holds the attachment's Zotero key, so a stale value makes the view fall back to the first attachment until the user picks one. The saved filter held tag ids and now holds tag names, so a stale value makes the view open unfiltered until the user changes a filter. Both cost one gesture to restore. Both belong in the changelog for this release.

### A standalone PDF lists its annotations and refuses the pin

**Why it is not automated:** it needs a real standalone attachment in a Zotero library, which the Fixture does not carry. Provenance: [#1146](https://github.com/aidenlx/zotlit/issues/1146).

**Setup:** the Paired Run. In Zotero, use **File → Add Attachment → Add File** with no item selected, so the PDF lands as a standalone attachment, and annotate it. Open the same file in Obsidian's PDF reader.

**Steps:**

1. With the PDF tab active, read the Annotation View.
2. Open the mode button's menu and hover **Pin current item**.

**Expected:** the annotations list, the identity block is absent, and **Pin current item** is greyed with the tooltip "This PDF has no Zotero item to pin. Give it a parent item in Zotero first." The same entry in the pane menu is greyed, with that reason on the line beneath it.

**If the list is empty:** the resolver did not index the file at all. A pinnable entry instead means a standalone attachment is reaching the view with a parent item key.

### Turn on live updates from the empty state

**Why it is not automated:** this reason is not an intrinsic barrier. The action is covered at its seam; what is unproven is the settings write reaching a real listener, which a Paired Run scenario can drive. Provenance: [#1146](https://github.com/aidenlx/zotlit/issues/1146).

**Setup:** the Paired Run, with live updates off in **Settings → ZotLit → Connection**.

**Steps:**

1. Set the Annotation View to **Zotero reader**.
2. Select **Turn on live updates** in the empty state.
3. Open **Settings → ZotLit → Connection**.

**Expected:** the server toggle and the live-updates toggle are both on, the settings row names a bound port, and the empty state changes to "Open an item in the Zotero reader to see its annotations."

**If it fails:** a port that will not bind is the Local Server's own failure and shows in the settings row.

### The reader-presence round trip

**Why it is not automated:** this reason is not an intrinsic barrier. Both halves are drivable over RDP and neither needs a Write Authorization, so a Paired Run scenario should take them over. Provenance: [#1146](https://github.com/aidenlx/zotlit/issues/1146).

**Setup:** the Paired Run, with live updates on. Set the Annotation View to **Zotero reader**.

**Steps:**

1. In Zotero, open an annotated PDF in the reader. The Annotation View lists that attachment's annotations.
2. In Zotero, select the library tab, the leftmost one.
3. Read the Obsidian console.
4. In Zotero, select the reader tab again.

**Expected:** step 3 logs `Zotero reader presence changed { closed: true }`, the Annotation View still lists the same attachment's annotations, the line "Zotero reader closed. Showing the attachment it had open." stands above the list, and the Follow Mode is still **Zotero reader**. Step 4 removes that line and leaves the list unchanged.

**If the line never appears:** ZotLit Companion, the Zotero add-on, did not send `reader/inactive`. If the line sticks, no return push arrived; the Companion's dedupe is what lets the return through.

### The card keeps its size and reveals its controls

**Why it is not automated:** this reason is not an intrinsic barrier. Each measurement is DOM-observable, and `:hover` is the only live state involved. Run it by hand until a driven probe takes it over. Provenance: [#1145](https://github.com/aidenlx/zotlit/issues/1145).

**Setup:** the Paired Run, with the PDF open and the Annotation View beside it.

**Steps:**

1. Measure every card height and one card's header row height at rest.
2. Hover a card and measure both again.
3. Select a card by clicking its mark in the reader, move the pointer away, and measure both again.
4. Read the action bar's computed `opacity` at rest, while hovered, while selected with the pointer away, and with keyboard focus inside the card.
5. Find a card whose annotation carries tags, measure it, add three more tags in Zotero, refresh, and measure again.

**Expected:** every height in steps 2 and 3 equals the matching height from step 1, to the pixel, and the header row stays 32 px. Step 4 reads `0` at rest and `1` in the other three states. The two heights in step 5 are equal, because tags no longer change a card's height.

**If a height changes:** the action bar is taking layout space rather than layering into the header, or a chip row has come back into the card body.

### A comment edits in place

**Why it is not automated:** this reason is not an intrinsic barrier beyond the caret, which needs a real render. Provenance: [#1145](https://github.com/aidenlx/zotlit/issues/1145).

**Setup:** the Paired Run, with the Annotation View open on `rougier-2014.pdf`. The note annotation `C94NJNYG` carries the comment "some text comment".

**Steps:**

1. Measure that card's height, then click its rendered comment text.
2. Read the editor's value, `selectionStart`, `selectionEnd`, and whether it holds focus. Measure the card again.
3. Press `Escape` and re-read the card.
4. Click the comment again, type a word, and press `Cmd`/`Ctrl` + `Enter`.

**Expected:** step 2 answers the stored comment with both caret offsets equal to its length, and the textarea holds focus. The two heights differ only by what the editor's own text needs; the header and the excerpt do not move. Step 3 leaves Zotero's text standing. Step 4 stores the edit, and the new text appears once Zotero answers.

**If the caret is at position 0:** the value reached the element after the ref that places the caret ran.

## The write path

Every check in this group needs a Write Authorization. Grant one from **Settings → ZotLit → Zotero → Connection → Allow editing** and answer Zotero's dialog with **Always Allow**, unless the check says otherwise.

### The card controls follow the Editing Capability

**Why it is not automated:** this reason is not an intrinsic barrier beyond the read-only case, which needs a real read-only group library. Provenance: [#1145](https://github.com/aidenlx/zotlit/issues/1145), [#1148](https://github.com/aidenlx/zotlit/issues/1148).

**Setup:** the Paired Run, with the Annotation View open and the PDF open beside it.

**Steps:**

1. With Zotero closed, read the `aria-disabled`, `aria-label`, and `data-blocked` of a card's colour dot and comment button. Click each, then open the card's overflow menu.
2. Select an Annotation Mark in the reader and read each popup verb's `aria-disabled` and `aria-label`. Press `Delete`.
3. Start Zotero with the Local API on and grant no authorization. Repeat steps 1 and 2. On the notice that the colour dot raises in the repeated step 1, select **Allow editing**, and answer Zotero's dialog with **Deny**.
4. Select **Allow editing** again and answer **Always Allow**. Repeat steps 1 and 2.

**Expected:** with Zotero closed, the card's colour dot and comment button carry `data-blocked` and rest dimmed. They have no `aria-disabled`, and each keeps its own name in `aria-label`. A click writes nothing and opens no menu. It raises a notice that reads "Check that Zotero is open, then check the connection in ZotLit settings." and has no button. The overflow menu's **Delete annotation** row is disabled. In the reader, the colour, comment, and delete verbs read `aria-disabled="true"`, and each carries that same sentence as its `aria-label`. `Delete` in the reader raises the same capability notice a blocked `h` does, once. Copy and reveal stay live, and the excerpt text stays selectable, in every state.

Under authorization required, the verbs are blocked in the same way, with the sentence "Select Allow editing in the annotation view or ZotLit settings." No verb and no key opens Zotero's dialog. A click on a blocked card verb raises a notice with that sentence as its title and one button, **Allow editing**. That button opens Zotero's dialog directly, with no settings row in between. After **Deny**, nothing is written and the verbs stay blocked. When writable, the write goes straight through.

**If it fails:** the capability decision is tested as data, so a mismatch is in the wiring: the capability slice of the store, the `capability-changed` subscription, or the selected-attachment subscription that re-reads it.

### The reader affordance shows only the waiting and cooldown states

**Why it is not automated:** this reason is not an intrinsic barrier for most values. The values need a live Zotero in seven different states, and one of them needs a real read-only group library. Provenance: [#1147](https://github.com/aidenlx/zotlit/issues/1147).

**Setup:** the Paired Run, with the PDF open and the Annotation View beside it.

**Steps:** reach each capability value in turn. After each, read the reader toolbar, and select the Annotation View's mode button to open its menu.

| Capability | How to reach it |
| --- | --- |
| `read-only:zotero-unavailable` | Zotero closed |
| `read-only:local-api-disabled` | Zotero open, the Local API off in **Settings → Advanced** |
| `authorization-required` | the Local API on, no key stored |
| `authorizing` | select **Allow editing** and leave Zotero's dialog unanswered |
| `writable` | answer **Always Allow** |
| `cooldown` | six **Allow editing** requests inside one minute |
| `read-only:library-read-only` | a write to a read-only group library |

**Expected:** the reader toolbar holds a `zt-pdf-capability` node in two values only. Under `authorizing` it shows a turning loader icon and "Waiting for approval in Zotero", with `data-zt-capability-tone="busy"` and `aria-busy="true"`. Under `cooldown` it shows a clock icon, "Too many permission requests", and a seconds count, with the busy tone. In every other value the toolbar holds no such node. The node is a `role="status"` element, not a button, and a click on it does nothing.

In the Annotation View, the mode button's menu names every value except writable, in the words of the shared copy table: "Cannot connect to Zotero", "Enable communication with Zotero", "Allow editing to change annotations", "Waiting for approval in Zotero", "Too many permission requests", and "This Zotero library is read-only". Only under authorization required does the menu also offer **Allow editing**.

**If the reader shows the affordance in another value:** the reader's selection of the affordance is not limited to `authorizing` and `cooldown`. **If the two surfaces use different words:** one renderer is not using the shared capability copy table.

### A blocked keystroke raises one notice per reason per episode

**Why it is not automated:** the notice is rendered at the UI seam, and the policy forbids mocking a notice to observe it. Provenance: [#1147](https://github.com/aidenlx/zotlit/issues/1147).

A capability episode is one unbroken run in which an attachment cannot be edited. It opens on the first blocked gesture and closes the moment that attachment reads writable again.

**Setup:** the Paired Run with Zotero closed, and `attachments/rougier-2014.pdf` open and focused.

**Steps:**

1. Press `h`. Then press `h` five more times, and press `u`, `c`, and `3`.
2. Start Zotero with the Local API on, but grant no authorization. Press `h`.
3. Press `h` twice more.
4. Select **Allow editing** and answer **Always Allow** so editing works, then close Zotero again and press `h`.
5. Focus the Annotation View's search box and type `huc123`.

**Expected:** step 1 raises exactly one notice, titled "Cannot connect to Zotero", carrying "Check that Zotero is open, then check the connection in ZotLit settings." and one button, **Open editing settings**. Step 2 raises one new notice, titled "Allow editing to change annotations", carrying "Select Allow editing in the annotation view or ZotLit settings.", and opens no Zotero dialog. Step 3 raises nothing. Step 4 raises one notice again, because the episode closed in between. Step 5 raises no notice at all. The button on any of these notices opens the "Zotero editing" settings row.

**If a notice appears per keypress:** the ledger is closing an episode it should hold open.

### A refused write rolls back with one notice

**Why it is not automated:** it needs a real refusal from a real Zotero. Provenance: [#1147](https://github.com/aidenlx/zotlit/issues/1147).

**Setup:** the Paired Run with the Local API open and a Write Authorization in hand. Drive the Zotero half over RDP on `<rdp-port>`.

**Steps:**

1. Make Zotero answer `400` or `428` to a write.
2. Make it answer `501`, by sending an API version other than 3.
3. Swap the Zotero database under the port. Write twice. Then, with no write at all, swap the database back and run a Capability Probe: let a Freshness Signal arrive, or open the "Zotero editing" settings row.
4. Write to a read-only group library twice. Then open the "Zotero editing" settings row, which runs a Capability Probe, and write once more.

**Expected:** step 1 raises one sticky notice, "Zotero did not save the change.", carrying "Zotero sent an answer ZotLit cannot read" and "Check the ZotLit log for details." It stays until dismissed. Step 2 raises one sticky notice naming "Zotero version is not supported". A fresh Capability Probe follows it in the console, and the "Zotero editing" settings row reads "Zotero version is not supported". Step 3 raises one notice for the change and none for the second write, and the probe with no write behind it raises its own notice for the swap back. Step 4 raises one notice on the first refusal only and marks that library read-only in place; after the probe that the settings row runs, the controls are live again, and the write that follows raises a second notice.

**If it fails:** `400` and `428` classify as an invalid response, and `501` as an incompatible Zotero. A read-only library is marked in memory until the next Capability Probe clears it, not for the whole session.

### A delete leaves only after Zotero confirms, and a pending write shows as disabled verbs

**Why it is not automated:** this reason is not an intrinsic barrier. It needs a real render of both surfaces and a write slow enough to observe. Provenance: [#1145](https://github.com/aidenlx/zotlit/issues/1145).

**Setup:** the Paired Run, writable, with the PDF open and the Annotation View beside it.

**Steps:**

1. Count the marks the page draws. Open a card's overflow menu and choose **Delete annotation**. Count again and read the card list.
2. Repeat with Zotero's HTTP server stopped mid-gesture: quit Zotero between opening the menu and choosing the row.
3. Throttle the loopback response, or set a breakpoint in the transport, so a colour patch stays in flight for a few seconds. Pick a swatch, and while the write runs read the three verbs' `aria-disabled`, the colour dot's own background colour, and the mark's fill.

**Expected:** in step 1 the card and its mark leave together. In step 2 nothing leaves, and exactly one notice appears, reading "The edit was not saved." plus the reason. Never two notices, and never a card that leaves and comes back. In step 3 all three verbs read `aria-disabled="true"` and carry "Saving to Zotero…", and the dot and the mark keep the old colour until Zotero answers.

**If a card leaves early:** something is drawing provisionally, which the specification forbids.

### Create from the reader: keyboard, toolbar, and the new mark

**Why it is not automated:** this reason is not an intrinsic barrier. Each step commits a write to Zotero and was deferred rather than run against the Fixture mid-verification. Provenance: [#1150](https://github.com/aidenlx/zotlit/issues/1150).

**Setup:** the Paired Run, writable, with the PDF open and the reader focused.

**Steps:**

1. With no selection, press `h`, then `3`, then `Escape`.
2. Select text and press `u`. Then press `Escape`, then `c`, and save with `Cmd`/`Ctrl` + `Enter`.
3. Put the caret in the reader's own search box and press each of those keys again.
4. Arm the underline tool from the Creation Toolbar, drag across a sentence, and release.

**Expected:** step 1 arms highlight, turns its swatch green, and disarms. In step 2 `u` creates an underline at once and `c` opens the comment sheet. Step 3 changes nothing, because the keys belong to the text field. Step 4 opens no create-mode popup: the annotation is created, the overlay repaints, and the selected-mode popup opens over the new mark with colour, comment, copy, delete, and reveal.

**If the popup does not reopen:** the list read after the create did not answer, and the reveal hook is still waiting on it.

### One mark, three surfaces

**Why it is not automated:** it needs desktop Obsidian and a Zotero Reader open on the same attachment at once, and `pnpm fixture open --local-api` needs a running desktop Obsidian before it will start. Provenance: [#1150](https://github.com/aidenlx/zotlit/issues/1150).

**Setup:** the Paired Run, writable, with `rougier-2014.pdf` open in Obsidian and the same attachment open in Zotero's Reader.

**Steps:**

1. Create a highlight in Obsidian over a sentence in the middle of page 1.
2. Read Zotero's annotation sidebar, then ZotLit's Annotation View.
3. Drag the new mark in the Zotero Reader, then delete it there.

**Expected:** the new mark sits in reading order among the Fixture's seven in both sidebars, not above them, and carries page label `1`. The drag moves it. The delete removes it from Obsidian on the next read.

**If it sorts above everything:** the Sort Index offset came out `000000`, which means the page carried no Structured Characters. Confirm that the P11 seam probe passed for that view.

### A Zotero-side edit reaches an open surface

**Why it is not automated:** it needs a live Zotero writing beside a rendered Obsidian page. Provenance: [#1142](https://github.com/aidenlx/zotlit/issues/1142), [#1143](https://github.com/aidenlx/zotlit/issues/1143).

**Setup:** the Paired Run, with `rougier-2014.pdf` open in Obsidian, the Annotation View beside it, and the same attachment in the Zotero Reader. Confirm that Live Updates are on in **Settings → ZotLit → Connection**.

**Steps:**

1. Confirm the source in the console: one `Annotation marks rebuilt for a PDF view` with `source: "zotero-local-api"`.
2. In the Zotero Reader, change the colour of the highlight `PUPR5FG5` to green, and add a comment.
3. Watch Obsidian without touching the PDF tab.
4. Create an annotation in Zotero, then delete it, and watch again.

**Expected:** each change reaches both surfaces in about a second, without the PDF being reopened. Measured: a create reached the card list and the overlay in under 2 s; a colour and comment change reached the card text and the mark's computed `fill` by 1114 ms, and was still stale at 29 ms.

**If it fails:** confirm the Live Updates listener first. The Freshness Signal is the only trigger on this path, and ZotLit polls nothing, so a lost channel stops every Zotero-side change without an error. See the known limitation below. With the channel up, a change that never arrives means the Companion sent no signal, or the repository did not announce it.

### The Local API off mid-session falls back to the Zotero database

**Why it is not automated:** this reason is not an intrinsic barrier beyond the click in Zotero's own settings and the judgement about the rendered page. Provenance: [#1143](https://github.com/aidenlx/zotlit/issues/1143).

**Setup:** the Paired Run, with the reader reading from the Local API.

**Steps:**

1. In Zotero, open **Settings → Advanced** and switch the Local API off.
2. In Obsidian, open a different PDF and come back, or make any edit in Zotero that raises a Freshness Signal.
3. Read the console.

**Expected:** the Capability Probe reports `state: { kind: "unavailable", failure: { kind: "local-api-disabled" } }`, the source moves, and the next `Annotation marks rebuilt for a PDF view` says `source: "zotero-db"`. Every mark is still on the page and looks the same as it did from the Local API.

**If the page goes blank:** the fallback did not happen. The Capability Probe is the sole authority on "Local API disabled". ZotLit reads Zotero's preference file for the port only, and never for the enablement setting.

### The replay fixtures match a real Zotero

**Why it is not automated:** this reason is not an intrinsic barrier. The recording needs a running Paired Zotero, which the Paired Run provides, so a capture scenario should take it over. Provenance: [#1143](https://github.com/aidenlx/zotlit/issues/1143).

**Setup:** the Paired Run. Take `<port>` from the ready report.

**Steps:**

1. Read the attachment's annotations exactly as the client does:

   ```sh
   curl -i --noproxy '*' \
     -H "Zotero-Allowed-Request: 1" \
     -H "Zotero-API-Version: 3" \
     -H "Cache-Control: no-cache" \
     "http://127.0.0.1:<port>/api/users/0/items/RGRPDF24/children?itemType=annotation&limit=100&start=0&sort=dateAdded&direction=asc"
   ```

2. Compare the answer with `apps/obsidian/src/services/zotero-local-api/__fixtures__.ts`: the header block, `Total-Results`, the `Link` pair, and the item envelope around each `data.annotation*` field.
3. Record the remaining routes the same way: `GET /api/`; `403 Local API is not enabled` with the Local API off; `501` by sending `Zotero-API-Version: 4` to a data route; and `403 Write access denied` by writing to a read-only group library.

**Expected:** each fixture matches the recording field for field. Each builder in that file is marked RECORDED or SYNTHESISED; this check is what promotes a synthesised builder.

**If a shape differs:** correct the fixture file, change its marker as well as its bytes, and say in the pull request which builder changed. A mismatch means the client's schemas are wrong about a field, which reaches the user as an invalid-response failure and a silent fall back to the Zotero database.

### A group library attachment reads from its own route

**Why it is not automated:** it needs a real Zotero group library, which the Fixture cannot stand in for. Provenance: [#1143](https://github.com/aidenlx/zotlit/issues/1143).

**Setup:** the Paired Run, plus a group library in the Fixture profile that holds an annotated PDF attachment.

**Steps:** open that PDF in Obsidian and read the console.

**Expected:** `Annotations read from the Zotero Local API` names the Zotero key with its `g<groupID>` suffix, and the request went to `/api/groups/<groupID>/items/<key>/children`.

**If it fails:** the Zotero key was not split into library and key. Reads are unauthenticated, so a group library reads exactly like the personal one.

### Write conflicts, uncertain creates, and deletions from Zotero

**Why it is not automated:** this reason is not an intrinsic barrier for the first three steps, which need a real write conflict and a race against Zotero. The uncertain create needs a request killed after it left ZotLit and before its answer arrives, which the Fixture cannot stage on its own. The Zotero half of every outcome is already probed. Provenance: [#1151](https://github.com/aidenlx/zotlit/issues/1151).

**Setup:** the Paired Run, writable, with the Annotation View open on `rougier-2014.pdf` and Zotero reachable over RDP on `<rdp-port>`.

**Steps:**

1. In the Zotero Reader, change the colour of the highlight "Identify Your Message" to green. Without refreshing in Obsidian, open that card's colour dot and choose red.
2. Close the Annotation View, leave the PDF open, change the same annotation's colour in Zotero again, then select its mark in Obsidian and recolour it from the Mark Popup. Repeat the attempt once.
3. Delete an annotation in the Zotero Reader, then, without refreshing, delete the same card in Obsidian.
4. Over RDP, wrap the multi-object write endpoint so it performs the write and then never answers. In the reader, select text and press `h`. Let the request time out, or close the reader leaf.
5. With a badged card standing, close Zotero so the Zotero database source answers, then reopen Zotero against a different Zotero data directory.

**Expected:**

- Step 1: the card grows a panel reading "Changed in Zotero", with "In Zotero — Green" above "Your edit — Red", and the verbs **Apply again** and **Discard**. **Apply again** stores red; **Discard** leaves green. The panel goes either way and the list re-reads.
- Step 2: exactly one notice, "This annotation changed in Zotero.", with a **Show annotation** button that opens the Annotation View with that card selected and its conflict panel showing. The second attempt raises no second notice while the conflict stands.
- Step 3: one notice names the annotation as deleted in Zotero, and the card is gone on the next read, which is immediate.
- Step 4: ZotLit re-reads the attachment. If the write landed, one annotation matches on parent, type, rects, text, colour, and a `dateAdded` inside the request's window, and the card appears with no badge. If it did not land, a badged card reading "Not confirmed by Zotero" stands under the list with **Try again** and **Discard**; **Try again** answers `412 Write token already used` and the annotation appears once, never twice. Reloading the plugin drops the badged card.
- Step 5: the badged card goes on the switch to the Zotero database source and does not come back when Zotero returns. A different database raises one "A different Zotero database is open" notice and takes every badged card with it.

**If the card shows the colour you chose:** something is drawing ahead of Zotero. No provisional value may ever be shown. **If two badged cards appear for one gesture, or a retry creates a second annotation:** the write token is not being reused, which is the one guarantee the uncertain-create design rests on.

## The authorization dialog

### The dialog wording and legibility

**Why it is not automated:** a judgement about text on screen. A driven dialog can be answered, but not read for sense. Provenance: [#1144](https://github.com/aidenlx/zotlit/issues/1144), [#1152](https://github.com/aidenlx/zotlit/issues/1152).

**Setup:** the Paired Run, with no remembered authorization. Clear one from Zotero's **Settings → Advanced → Clear Write Authorizations** if a key is stored.

**Steps:**

1. In Obsidian, open **Settings → ZotLit → Zotero → Connection** and select **Allow editing**, so Zotero raises its dialog.
2. Read the dialog end to end: its title, its body text, and every button label.
3. Confirm that ZotLit's own Client Name appears in it, and that it names one application, not two.
4. Repeat with Zotero in another interface language, if the release supports one.

**Expected:** the dialog says which application is asking, and what the permission allows. The three answers are legible and distinct at the default window size. No text is clipped and no placeholder is left unfilled.

**If it fails:** the wording is Zotero's, not ZotLit's, except for the Client Name ZotLit sends. A wrong or doubled name is ZotLit's half; anything else is worth reporting upstream to Zotero.

### Clear Write Authorizations forgets a remembered key

**Why it is not automated:** it needs a click in Zotero's own settings and a real key store on disk. This check is required before every write release. Provenance: [#1144](https://github.com/aidenlx/zotlit/issues/1144), [#1152](https://github.com/aidenlx/zotlit/issues/1152).

**Setup:** the Paired Run. `<profile>` is the Fixture Zotero profile directory that `pnpm fixture paths` names.

**Steps:**

1. In Obsidian, open **Settings → ZotLit → Zotero → Connection** and select **Allow editing**. Answer Zotero's dialog with **Always Allow**.
2. Confirm the key is remembered: `<profile>/localAPIKeys.json` exists and holds an entry for ZotLit. Copy the 32-character key out of it.
3. Edit an annotation colour in Obsidian. It writes with no further dialog.
4. In Zotero, open **Settings → Advanced** and select **Clear Write Authorizations**.
5. Confirm the store: `<profile>/localAPIKeys.json` is gone.
6. Replay the write with the key you copied, where `<port>` and `<server-id>` come from the ready report and from step 3's response headers:

   ```sh
   curl -i --noproxy '*' -X PATCH \
     -H "Zotero-Allowed-Request: 1" \
     -H "Zotero-Server-ID: <server-id>" \
     -H "Zotero-API-Key: <key>" \
     -H "Content-Type: application/json" \
     -H "If-Unmodified-Since-Version: <version>" \
     -d '{"annotationColor":"#5fb236"}' \
     "http://127.0.0.1:<port>/api/users/0/items/<annotation-key>"
   ```

7. In Obsidian, edit an annotation colour again, then re-read the "Zotero editing" settings row.

**Expected:** step 5 leaves no key file. Step 6 answers `401` with `www-authenticate: Zotero-API-Key realm="Zotero Local API"`: a key issued before the clear no longer works. In step 7 the edit is not saved, no Zotero dialog opens, and ZotLit forgets the key that Zotero refused. The row reads "Allow editing to change annotations" again, **Allow editing** is shown, and **Forget authorization** is hidden. Selecting **Allow editing** raises Zotero's dialog once more.

**If the replayed key still writes:** Zotero did not revoke the key it forgot, and a cleared authorization is not a revoked one. Say so in the release notes and report it upstream.

### Allow editing in the Annotation View asks Zotero directly

**Why it is not automated:** this reason is not an intrinsic barrier. It grants a real authorization against the Fixture's key store, and was deferred for that reason. Provenance: [#1147](https://github.com/aidenlx/zotlit/issues/1147).

**Setup:** the Paired Run with no remembered authorization, and the PDF open with the Annotation View beside it.

**Steps:**

1. Select the Annotation View's mode button, and in its menu select **Allow editing**. Leave Zotero's dialog open.
2. Click the affordance in the reader toolbar. Then answer Zotero's dialog with **Deny**.
3. Repeat step 1, and answer **Always Allow**.

**Expected:** step 1 opens Zotero's dialog and no settings modal. While the dialog is open, the reader toolbar shows "Waiting for approval in Zotero", and the mode button's menu reports the same words with no **Allow editing** row. In step 2 the click does nothing. After **Deny** the reader toolbar holds no affordance, and the mode button's menu offers **Allow editing** again. After **Always Allow** in step 3 the reader toolbar holds no affordance, the mode button's menu has no editing row, and the card verbs act.

**If a settings modal opens:** the Annotation View's **Allow editing** goes through the settings row instead of straight to Zotero.

### The cooldown countdown

**Why it is not automated:** it needs six real authorization dialogs inside one minute, and the stub route that drives a dialog consumes the dialog the countdown measures. Provenance: [#1147](https://github.com/aidenlx/zotlit/issues/1147).

**Setup:** the Paired Run, with the PDF open and the "Zotero editing" settings row open beside it. Select **Allow editing** six times inside one minute, answering **Deny** each time, until Zotero answers `429`.

**Steps:**

1. Read the seconds value on the affordance in the reader and in the settings row's detail line, three times about a second apart.
2. Wait for the cooldown to lift and read both once more.
3. Close the PDF leaf mid-cooldown and watch the console.

**Expected:** the number falls by one each second on both surfaces and reaches `0`. Then the reader affordance leaves the toolbar with no seconds element left behind, and the settings row reads "Allow editing to change annotations" and shows **Allow editing** again. Nothing keeps logging or redrawing after the leaf closes.

**If a countdown keeps running:** an interval was armed on the wrong window, or it is not cleared on teardown. Both surfaces arm on the node's own window.

### Allow leaves ZotLit read-only, and says so

**Why it is not automated:** the End-to-end Run answers Zotero's prompt with a stub. This check presses the **Allow** button of Zotero's real dialog and reads Zotero's key store. Provenance: [#1251](https://github.com/aidenlx/zotlit/issues/1251).

**Setup:** the Paired Run with no remembered authorization, and `rougier-2014.pdf` open with the Annotation View beside it. In Zotero, select **Settings → Advanced → Clear Write Authorizations**. In ZotLit's "Zotero editing" row, select **Forget authorization** if it is shown. `<profile>` is the Fixture Zotero profile directory that `pnpm fixture paths` names.

**Steps:**

1. In Obsidian, open **Settings → ZotLit → Zotero → Connection** and select **Allow editing**. Answer Zotero's dialog with **Allow**.
2. Read the notice and the "Zotero editing" row. Then open `<profile>/localAPIKeys.json`.
3. In the notice, select **Allow editing**. Answer Zotero's dialog with **Always Allow**.
4. In the Annotation View, change the colour of one annotation card.

**Expected:** after step 1 a notice says "To edit annotations, choose Always Allow in Zotero." and shows an **Allow editing** button. The row reads "Allow editing to change annotations", shows **Allow editing**, and hides **Forget authorization**. In step 2 the key store holds one key with `"remember": false`. In step 3 Zotero's dialog opens again, and a notice says "Zotero editing is enabled.". The row reads "Ready to edit" and shows **Forget authorization**. In step 4 the colour is saved to Zotero with no dialog.

**If editing is available after step 1:** ZotLit kept the single-use key from **Allow**. **If no notice appears after step 1:** the settings row asks Zotero directly, not through the Allow editing action that reports Zotero's answer.

## Known limitations

State these in the release notes. Each one is accepted for this milestone and is worth carving as a follow-up issue.

### A patch on an annotation deleted in Zotero does not say "Deleted in Zotero"

Measured against Zotero 10, schema 44. A `DELETE` of an annotation that Zotero has erased answers `404 Not found`, so ZotLit shows "Deleted in Zotero" once and the card leaves on the next read. A `PATCH` of the same annotation answers `400 itemType property not provided`, and `500` when `itemType` is supplied, because Zotero's single-object patch route treats a missing object as a new one and never answers `404`.

So a colour or comment edit on an annotation deleted in Zotero raises the sticky invalid-response notice instead, and the card stays until the next Freshness Signal. The user is told the write failed either way. Only the wording and the card's departure differ.

Widening this needs a repository re-read on an "object gone" shaped failure, which no ticket in [#1139](https://github.com/aidenlx/zotlit/issues/1139) carries.

### A dismissed authorization dialog grants Always Allow

Zotero reports a dismissed dialog as its second button, which is **Always Allow**. Closing the dialog with `Esc` or with the window close button therefore writes a remembered key to `localAPIKeys.json`, confirmed twice against the real dialog. The default button, which `Return` activates, is **Deny**.

Dismissal is not distinguishable from **Always Allow**, and it is the opposite of a refusal. ZotLit cannot treat a dismissed dialog as a refusal, because Zotero does not report one, and it must not pretend the grant did not happen. A user who closes the dialog and wants it back clears it from **Settings → Advanced → Clear Write Authorizations**. This looks like a Zotero defect and is worth reporting upstream.

### The key from Allow stays in Zotero's store until Clear

When the user answers Zotero's dialog with **Allow**, Zotero writes a single-use key to `localAPIKeys.json`. ZotLit discards that key and never sends it, so Zotero never spends it. An unused single-use key has no expiry, and the Local API cannot revoke a key. The key stays in the store until **Settings → Advanced → Clear Write Authorizations** in Zotero.

The key permits only writes to a database that every local process can already read. ADR 0062 records this decision.

### A stale list is not signposted when the Live Updates listener is off

Measured on a wired Paired Run: with Live Updates connected, a Zotero-side create, colour change, or comment change reaches the Annotation View and the reader overlay in about a second.

With the listener off, none of them arrives. That is the documented degradation, because the Freshness Signal is the only trigger on the Zotero Local API path. What is not signposted is the state: the card keeps its stale text, the header keeps its old count, and the view gives the user no sign that it can no longer hear Zotero. The live-updates state is surfaced in one place only, the empty state of the **Zotero reader** follow mode. Under **Active tab** or **Pinned**, with a list showing, nothing surfaces it. Turning the channel back on recovers the list on the next Zotero-side save.

The numbers are in [PDF annotation probes](pdf-annotation-probes.md).

## See also

- [The Fixture](fixture.md), for the Paired Run, the Zotero Local API trial, and the End-to-end Run suite.
- [PDF annotation probes](pdf-annotation-probes.md), for the twenty probes and the measurements this checklist does not repeat.
