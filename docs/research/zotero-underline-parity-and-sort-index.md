# Zotero underline parity and PDF sortIndex

Research for [aidenlx/zotlit#827](https://github.com/aidenlx/zotlit/issues/827).

## Sources

All citations are paths inside a local Zotero 10 source checkout at
`/Users/aidenlx/repo/zotlit-repo/zotero-10/`.

| Repository | Path prefix | Commit | Date |
| --- | --- | --- | --- |
| `zotero/zotero` | (repo root) | `22f08d1ce` | 2026-08-17 |
| `zotero/reader` (submodule) | `reader/` | `132bb7879` | 2026-08-14 |

The bundled PDF worker source is in the same checkout at `document-worker/`.
Line numbers are from these two commits.

---

## Answer 1 — Underline parity

Underline creation is the highlight creation path with a different `type`
string. One function builds the annotation object for both types, and the
caller supplies `type` and `color` as plain arguments
(`reader/src/pdf/pdf-view.js:3378`). The position schema, the text extraction,
the sortIndex function, the reader save queue, and the Zotero write path are
all type-agnostic. Zotero's own code treats the pair as one class: every
type test in the write path is `['highlight', 'underline'].includes(...)`, and
`Zotero.Item` permits a type change only between these two values
(`chrome/content/zotero/xpcom/data/item.js:4494`). The divergences are the
numeric type ID in SQLite (`1` against `5`) and render-time behavior. Both are
outside the creation contract.

## Answer 2 — sortIndex

For a PDF attachment the sortIndex is an 18-character string
`PPPPP|OOOOOO|TTTTT`: 5-digit `pageIndex`, 6-digit character `offset`, and
5-digit `top`, each zero padded, joined by `|`
(`reader/src/pdf/selection.js:414-418`). All PDF annotation types use one
function, `getSortIndex(pdfPages, position)`
(`reader/src/pdf/selection.js:399`). `offset` is the index of the page
character nearest to a chosen rectangle, found by `getClosestOffset`. `top` is
`floor(pageHeight - rect[3])`, clamped to `0`. The chosen rectangle is the
`position.rects` entry with the largest index-2 value, or the bounding rectangle
when `rects` is absent (ink). Zotero itself never computes a sortIndex. It only
validates the string against `/^\d{5}\|\d{6}\|\d{5}$/`
(`chrome/content/zotero/xpcom/data/item.js:4524`) and sorts by SQLite `ORDER BY
... sortIndex` and by JavaScript string compare.

---

# Q1 evidence — underline against highlight

## The single creation function

Both types come out of one method. `type` and `color` are parameters.

`reader/src/pdf/pdf-view.js:3378-3400`

```js
_getAnnotationFromSelectionRanges(selectionRanges, type, color) {
	if (selectionRanges[0].collapsed) {
		return null;
	}
	selectionRanges = selectionRanges.slice();
	selectionRanges.sort((a, b) => a.pageIndex - b.pageIndex);
	selectionRanges = selectionRanges.slice(0, 2);
	let selectionRange = selectionRanges[0];
	let annotation = {
		type,
		color,
		sortIndex: selectionRange.sortIndex,
		pageLabel: this._getPageLabel(selectionRange.position.pageIndex, true),
		position: selectionRange.position,
		text: selectionRange.text
	};
	if (selectionRanges.length === 2) {
		let selectionRange = selectionRanges[1];
		annotation.position.nextPageRects = selectionRange.position.rects;
		annotation.text += ' ' + selectionRange.text;
	}
	return annotation;
}
```

The pointer-up handler passes the active tool straight through. One branch
serves both tools.

`reader/src/pdf/pdf-view.js:3556-3562`

```js
if (action.type === 'selectText') {
	if (['highlight', 'underline'].includes(this._tool.type)) {
		if (this._selectionRanges.length && !this._selectionRanges[0].collapsed) {
			let annotation = this._getAnnotationFromSelectionRanges(this._selectionRanges, this._tool.type, this._tool.color);
			annotation.sortIndex = getSortIndex(this._pdfPages, annotation.position);
```

The keyboard shortcuts are the same code twice, with the type string and the
tool key changed.

`reader/src/pdf/pdf-view.js:4151-4168`

```js
	let annotation = this._getAnnotationFromSelectionRanges(this._selectionRanges, 'highlight');
	annotation.sortIndex = getSortIndex(this._pdfPages, annotation.position);
	annotation.color = this._tools['highlight'].color;
	this._onAddAnnotation(annotation, true);
	...
	let annotation = this._getAnnotationFromSelectionRanges(this._selectionRanges, 'underline');
	annotation.sortIndex = getSortIndex(this._pdfPages, annotation.position);
	annotation.color = this._tools['underline'].color;
	this._onAddAnnotation(annotation, true);
```

The find-popup shortcuts follow the same shape
(`reader/src/common/components/view-popup/find-popup.js:82` and `:90`).

## Position object shape

Both types carry the same object. A selection range builds it.

`reader/src/pdf/selection.js:685-695`

```js
for (let selectionRange of selectionRanges) {
	let { chars } = pdfPages[selectionRange.pageIndex];
	let from = Math.min(selectionRange.anchorOffset, selectionRange.headOffset);
	let to = Math.max(selectionRange.anchorOffset, selectionRange.headOffset);
	let rects = getRectsFromChars(chars.slice(from, to));
	selectionRange.position = {
		pageIndex: selectionRange.pageIndex,
		rects
	};
	selectionRange.sortIndex = getSortIndex(pdfPages, selectionRange.position);
	selectionRange.text = getTextFromChars(chars.slice(from, to));
```

Side by side, the two positions are byte-identical in shape:

```
  highlight position                 underline position
  ┌──────────────────────────┐       ┌──────────────────────────┐
  │ pageIndex : 0-based int  │  ==   │ pageIndex : 0-based int  │
  │ rects     : [[x1,y1,     │  ==   │ rects     : [[x1,y1,     │
  │              x2,y2],...] │       │              x2,y2],...] │
  │ nextPageRects? : same    │  ==   │ nextPageRects? : same    │
  └──────────────────────────┘       └──────────────────────────┘
     no fontSize, no rotation,          no fontSize, no rotation,
     no width, no paths                 no width, no paths
```

`nextPageRects` appears only when the selection crosses one page boundary
(`reader/src/pdf/pdf-view.js:3394-3398`). One rectangle exists per text line
(`reader/src/pdf/selection.js:193-215`).

### Rectangle precision

Two rounding steps exist. Both apply to the two types equally.

`reader/src/pdf/selection.js:253` rounds a character-mode range:

```js
rects = rects.map(rect => rect.map(value => parseFloat(value.toFixed(3))));
```

`reader/src/common/annotation-manager.js:104` rounds every new annotation
before the save:

```js
annotation.position = roundPositionValues(annotation.position);
```

`roundPositionValues` uses `Math.round(value * 1e3) / 1e3` on `rects`,
`nextPageRects`, `paths`, and `width`
(`reader/src/pdf/lib/utilities.js:686-712`). The stored result is 3 decimal
places in PDF user-space points.

## Text extraction

The same `getTextFromChars` output fills `text` for both types
(`reader/src/pdf/selection.js:216-232`). The Zotero side then accepts `text`
for exactly this pair.

`chrome/content/zotero/xpcom/data/item.js:4506-4510`

```js
case 'text':
	if (!['highlight', 'underline'].includes(this._getLatestField('annotationType'))) {
		throw new Error("'annotationText' can only be set for highlight and underline annotations");
	}
	break;
```

`Zotero.Annotations.saveFromJSON` writes `text` under the same test
(`chrome/content/zotero/xpcom/annotations.js:238-240`), and `toJSONSync` reads
it back under the same test (`:157-159`). `Zotero.Item.prototype.toJSON`
repeats it (`chrome/content/zotero/xpcom/data/item.js:6070-6072`).

## Color

Both tools default to the first palette entry, `#ffd400`.

`reader/src/common/reader.js:166-173`

```js
highlight: {
	type: 'highlight',
	color: ANNOTATION_COLORS[0][1],
},
underline: {
	type: 'underline',
	color: ANNOTATION_COLORS[0][1],
},
```

`ANNOTATION_COLORS` is the 8-color palette in
`reader/src/common/defines.js:2-11`. Zotero holds the same list in
`chrome/content/zotero/xpcom/annotations.js:39-51`, with the comment "Keep in
sync with the reader's ANNOTATION_COLORS". `DEFAULT_COLOR` is `#ffd400`
(`:53`).

Validation is one un-anchored, case-sensitive regular expression for every
type:

`chrome/content/zotero/xpcom/data/item.js:4512-4518`

```js
case 'color':
	// Require 6-char hex value
	if (!value.match(/#[a-f0-9]{6}/)) {
		let e = new Error(`Invalid annotation color '${value}'`);
		e.name = "ZoteroInvalidDataError";
		throw e;
	}
```

Two consequences apply to both types. Uppercase hex such as `#FFD400` fails.
The regular expression has no anchors, so a string that contains a valid
lowercase hex value passes.

## Reader save queue

`AnnotationManager.addAnnotation` has no type branch at all.

`reader/src/common/annotation-manager.js:77-108`

```js
addAnnotation(annotation) {
	if (this._readOnly) {
		return null;
	}
	// Mandatory properties
	let { color, sortIndex } = annotation;
	if (!color) {
		throw new Error(`Missing 'color' property`);
	}
	if (!sortIndex) {
		throw new Error(`Missing 'sortIndex' property`);
	}

	// Optional properties
	annotation.pageLabel = annotation.pageLabel || '';
	annotation.text = annotation.text || '';
	annotation.comment = annotation.comment || '';
	annotation.tags = annotation.tags || [];
	// Automatically set properties
	annotation.id = this._generateObjectKey();
	annotation.dateCreated = (new Date()).toISOString();
	annotation.dateModified = annotation.dateCreated;
	annotation.authorName = this._authorName;
	...
	annotation.position = roundPositionValues(annotation.position);
```

The only type tests in the whole file are for `text` comment volatility
(`:173`), for the highlight-underline conversion command (`:204-207`), and for
the SDT type filter (`:419`).

## Zotero write path

`Zotero.Annotations.saveFromJSON` is the single entry point for reader saves.

`chrome/content/zotero/xpcom/annotations.js:234-247`

```js
item._requireData('annotation');
item._requireData('annotationDeferred');
item.annotationType = json.type;
item.annotationAuthorName = json.authorName || '';
if (['highlight', 'underline'].includes(json.type)) {
	item.annotationText = json.text;
}
item.annotationIsExternal = !!json.isExternal;
item.annotationComment = json.comment;
item.annotationColor = json.color;
item.annotationPageLabel = json.pageLabel;
item.annotationSortIndex = json.sortIndex;

item.annotationPosition = JSON.stringify(Object.assign({}, json.position));
```

`chrome/content/zotero/xpcom/reader.js:278-334` calls it in a loop with no type
test.

The SQL write is one `REPLACE INTO itemAnnotations` for every type
(`chrome/content/zotero/xpcom/data/item.js:2274-2295`). The type-specific work
after the write concerns image cache files for `image` and `ink` only
(`:2308-2314`).

Type validation allows six values, and restricts type changes to the
highlight-underline pair:

`chrome/content/zotero/xpcom/data/item.js:4492-4505`

```js
case 'type': {
	let currentType = this._getLatestField('annotationType');
	if (currentType && currentType != value
		&& (!['highlight', 'underline'].includes(value)
			|| !['highlight', 'underline'].includes(currentType))) {
		throw new Error("Only changes between highlight and underline annotation types are permitted");
	}
	if (!['highlight', 'underline', 'note', 'text', 'image', 'ink'].includes(value)) {
		let e = new Error(`Unknown annotation type '${value}'`);
		e.name = "ZoteroInvalidDataError";
		throw e;
	}
	break;
}
```

## Local API write path

A ZotLit `POST /api/local/.../items` reaches the same setters. The local API
handler calls `Zotero.Item.prototype.fromJSON`:

`chrome/content/zotero/xpcom/server/server_localAPI.js:1973-1982`

```js
function applyJSONToObject(obj, json, kind) {
	try {
		obj.fromJSON(json, { strict: false });
	}
	catch (e) {
		if (e && e.name === 'ZoteroInvalidDataError') {
			throw new HTTPError(400, e.message);
		}
		throw e;
	}
```

`fromJSON` passes each annotation field straight to its property setter
(`chrome/content/zotero/xpcom/data/item.js:5787-5795`). The validation above
therefore applies to ZotLit writes without change.

**Key-order constraint.** `fromJSON` walks the JSON with `for (let field in
json)` (`chrome/content/zotero/xpcom/data/item.js:5677`), so the object key
order decides the setter order. Every non-type annotation setter first checks
that the type exists:

`chrome/content/zotero/xpcom/data/item.js:4487-4489`

```js
if (name != 'type' && !this._getLatestField('annotationType')) {
	throw new Error("annotationType must be set before other annotation properties");
}
```

Place `annotationType` before the other `annotation*` keys in the request body.
This applies to highlight and underline alike.

## Divergences

| # | Divergence | Location | Affects creation? |
| --- | --- | --- | --- |
| 1 | SQLite type ID: highlight `1`, underline `5` | `chrome/content/zotero/xpcom/annotations.js:31` and `:35`; mapped back at `chrome/content/zotero/xpcom/data/items.js:585-611` | No. Zotero derives the ID from the `type` string. |
| 2 | Underline rendering reads `pdfPages[pageIndex].chars` to find the text rotation; highlight does not | `reader/src/pdf/lib/render.js:76-112`; page-data preload at `reader/src/pdf/pdf-view.js:1179-1182` | No. Render time only. |
| 3 | Underline draws a 1 pt line at the rectangle edge; highlight fills the rectangle with `color + '80'` | `reader/src/pdf/lib/render.js:63-75` against `:76-112` | No. Render time only. |
| 4 | Distinct l10n strings, icons, and toolbar buttons | `reader/src/common/components/toolbar.js:209-215` | No. |
| 5 | Type conversion is allowed only inside the highlight-underline pair | `chrome/content/zotero/xpcom/data/item.js:4494-4498`; reader side `reader/src/common/annotation-manager.js:204-206` | No. This is a symmetric rule, not a divergence between the two. |
| 6 | The Mendeley import helper handles `highlight` only; the general PDF import helper handles both | `document-worker/src/pdf/index.js:833` against `:235` | No. Import path only, not user creation. |

No divergence exists in the position schema, in text extraction, in color, in
sortIndex, in the reader save queue, or in the Zotero write path. Every test
along the creation path is either absent or spelled
`['highlight', 'underline'].includes(...)`.

---

# Q2 evidence — the sortIndex algorithm

## The function

`reader/src/pdf/selection.js:394-419`

```js
function getTopMostRectFromPosition(position) {
	// Sort the rectangles based on their y2 value in descending order and return the first one
	return position?.rects?.slice().sort((a, b) => b[2] - a[2])[0];
}

export function getSortIndex(pdfPages, position) {
	let { pageIndex } = position;
	let offset = 0;
	let top = 0;
	if (pdfPages[position.pageIndex]) {
		let { chars } = pdfPages[position.pageIndex];
		let viewBox = pdfPages[position.pageIndex].viewBox;
		let rect = getTopMostRectFromPosition(position) || getPositionBoundingRect(position);
		offset = chars.length && getClosestOffset(chars, rect) || 0;
		let pageHeight = viewBox[3] - viewBox[1];
		top = pageHeight - rect[3];
		if (top < 0) {
			top = 0;
		}
	}
	return [
		pageIndex.toString().slice(0, 5).padStart(5, '0'),
		offset.toString().slice(0, 6).padStart(6, '0'),
		Math.floor(top).toString().slice(0, 5).padStart(5, '0')
	].join('|');
}
```

## String layout

```
   character index:  0 1 2 3 4  5  6 7 8 9 10 11  12  13 14 15 16 17
                    ┌─────────┐┌─┐┌────────────┐ ┌─┐ ┌────────────┐
                    │ 0 0 0 1 5││|││0 0 2 4 3 1│ │|│ │0 0 0 0 0   │
                    └─────────┘└─┘└────────────┘ └─┘ └────────────┘
                     pageIndex   sep   offset     sep      top
                     5 digits           6 digits          5 digits

   Total length: 5 + 1 + 6 + 1 + 5 = 18 characters
   Separator:    '|' (U+007C)
   Padding:      leading zeros, via String.prototype.padStart
   Overflow:     slice(0, N) BEFORE padStart, so an over-long value keeps
                 its FIRST N digits (1234567 -> "123456")
```

A real example from Zotero's own test data is `"00015|002431|00000"`
(`test/tests/annotationsTest.js:12`).

### Field meanings

| Field | Width | Value | Notes |
| --- | --- | --- | --- |
| `pageIndex` | 5 | 0-based page index | Taken from `position.pageIndex` directly. |
| `offset` | 6 | Index of the nearest character in the page character array | `0` when the page has no text layer, or when the page data is unavailable. |
| `top` | 5 | `floor(pageHeight - rect[3])` | Distance in points from the page top edge to the rectangle top edge. Clamped to `0`. |

## The rectangle choice

`getTopMostRectFromPosition` sorts `position.rects` by index 2 in descending
order and returns the first entry. Under the `[x1, y1, x2, y2]` convention that
the rest of the file uses (see `getPositionBoundingRect`,
`reader/src/pdf/lib/utilities.js:37-42`), index 2 is `x2`. The comment above
the function names `y2`.

The comment and the code disagree. The code is the behavior. ZotLit must copy
the code: pick the rectangle with the largest `x2`. Ties keep the earlier
rectangle, because `Array.prototype.sort` is stable.

The function came from commit `27c54ac` in the reader repo, "Properly order
highlight/underline annotations in the same line", which fixes
zotero/zotero#3472. It replaced a plain `getPositionBoundingRect(position)`
call.

When `position.rects` is absent — this happens for `ink`, which carries `paths`
— the optional chaining yields `undefined` and the fallback
`getPositionBoundingRect(position)` runs. For `paths` that function returns the
bounding box of every path point (`reader/src/pdf/lib/utilities.js:44-59`).

## The offset

`getClosestOffset` scans every character on the page and returns the index of
the character with the smallest rectangle-to-rectangle distance.

`reader/src/pdf/selection.js:37-49`

```js
function getClosestOffset(chars, rect) {
	let dist = Infinity;
	let idx = 0;
	for (let i = 0; i < chars.length; i++) {
		let ch = chars[i];
		let distance = rectsDist(ch.rect, rect);
		if (distance < dist) {
			dist = distance;
			idx = i;
		}
	}
	return idx;
}
```

`rectsDist` returns `0` when the two rectangles overlap or touch
(`reader/src/pdf/selection.js:3-35`). The comparison is strict (`<`), so the
**first** character with distance `0` wins. For a text-selection annotation
this is normally the first character inside the chosen rectangle.

Text-selection and point/area annotations use the **same** offset rule inside
the reader. There is no separate branch.

`chars` is the array that the PDF worker returns for the page. Its order
defines the offset value.

`reader/pdfjs/pdf.js/src/core/module/module.js:62-72`

```js
async getPageData({ pageIndex }) {
	let page = await this._pdfDocument.getPage(pageIndex);
	let r = Math.random().toString();
	let chars = await this._structuredCharsProvider(pageIndex, true);
	let overlays = await getRegularLinkOverlays(this._pdfDocument, chars, pageIndex);
	return {
		partial: true,
		chars,
		overlays,
		viewBox: page.view,
	};
}
```

`reader/pdfjs/pdf.js/src/core/module/structure.js:980-997`

```js
export function getStructuredChars(chars) {
	let chars2 = [];
	let fingerprints = new Set();
  for (let char of chars) {
    // Some PDF files have their text layer characters repeated many times, therefore deduplicate chars
    let fingerprint = char.c + char.rect.join('');
    if (!fingerprints.has(fingerprint)) {
      fingerprints.add(fingerprint);
      chars2.push(char);
    }
  }
  let structuredChars = split(chars2);
  for (let i = 0; i < structuredChars.length; i++) {
    structuredChars[i].offset = i;
  }

  return structuredChars;
}
```

Two transforms run before the index is assigned. `getStructuredChars`
deduplicates characters by `c + rect`. `split` then re-groups characters into
lines and paragraphs, and handles rotation and RTL
(`reader/pdfjs/pdf.js/src/core/module/structure.js:700-978`). The offset is the
index into that final array.

## The top

`pageHeight = viewBox[3] - viewBox[1]`, where `viewBox` is `page.view` — the PDF
page box. Subtracting `viewBox[1]` handles a non-zero page origin. `top` is the
distance from the page top edge down to the rectangle top edge, in points, then
`Math.floor`.

## Type by type

| Type | `position` keys | Rectangle used | Offset source | `top` source |
| --- | --- | --- | --- | --- |
| `highlight` | `pageIndex`, `rects`, optional `nextPageRects` | `rects` entry with the largest index 2 | `getClosestOffset` on that rectangle | `pageHeight - rect[3]` |
| `underline` | same as highlight | same | same | same |
| `note` | `pageIndex`, `rects` (one 22 pt square) | that single rectangle | `getClosestOffset` | `pageHeight - rect[3]` |
| `text` | `pageIndex`, `rects` (one), `fontSize`, `rotation` | that single rectangle | `getClosestOffset` | `pageHeight - rect[3]` |
| `image` | `pageIndex`, `rects` (one) | that single rectangle | `getClosestOffset` | `pageHeight - rect[3]` |
| `ink` | `pageIndex`, `paths`, `width` | bounding box of all path points | `getClosestOffset` on the bounding box | `pageHeight - boundingRect[3]` |

Note dimensions come from `PDF_NOTE_DIMENSIONS = 22` points
(`reader/src/common/defines.js:27`); the reader centers that square on the
click point. Creation call sites for `note`, `text`, and `image` are
`reader/src/pdf/pdf-view.js:4193`, `:4231`, and `:4262`. Ink creation is
`reader/src/pdf/pdf-view.js:3500-3502`.

**Point and area annotations have no special offset rule inside the reader.**
The offset is always the nearest page character. Only the PDF-import path in
the worker branches by type (see below).

## Comparison and sorting

Three comparators exist. All treat the value as an opaque string, apart from
one dead numeric sort.

1. **Reader sidebar and reader state** — JavaScript string compare:

   `reader/src/common/annotation-manager.js:42` (also `:59`, `:340`, `:616`,
   `:650`)

   ```js
   this._annotations.sort((a, b) => (a.sortIndex > b.sortIndex) - (a.sortIndex < b.sortIndex));
   ```

   Because every field has a fixed width and holds only ASCII digits, and
   because `'|'` (U+007C) is above every digit, lexicographic order equals
   field-by-field numeric order.

2. **Zotero child-item list** — SQLite `ORDER BY` on a `TEXT` column:

   `chrome/content/zotero/xpcom/data/items.js:807`

   ```js
   + " ORDER BY parentItemID, sortIndex";
   ```

   The column is `sortIndex TEXT NOT NULL`
   (`chrome/content/zotero/xpcom/schema.js:3637`), with the default `BINARY`
   collation. This gives the same order as the string compare above.

3. **A no-op numeric sort** — `chrome/content/zotero/xpcom/data/items.js:813`:

   ```js
   rows.sort((a, b) => a.sortIndex - b.sortIndex);
   ```

   The rows built at `chrome/content/zotero/xpcom/data/items.js:681-685` hold
   only `itemID`, `title`, and `trashed`. `a.sortIndex` is `undefined`, so the
   comparator returns `NaN` and the sort keeps the SQL order. The effective
   order is the `ORDER BY` above.

### Normalization at write time

The property setter trims and NFC-normalizes every string value before the
regular-expression test.

`chrome/content/zotero/xpcom/data/item.js:4474-4479`

```js
// Normalize values
if (typeof value == 'string') {
	value = value.trim().normalize();
	if (value === "") {
		value = null;
	}
}
```

## Validation, by attachment type

`chrome/content/zotero/xpcom/data/item.js:4521-4544`

```js
case 'sortIndex': {
	let parentItem = this.parentItem;
	if (parentItem?.isPDFAttachment()) {
		if (!/^\d{5}\|\d{6}\|\d{5}$/.test(value)) {
			throw new Error(`Invalid sortIndex '${value}'`);
		}
	}
	else if (parentItem?.isEPUBAttachment()) {
		if (!/^\d{5}\|\d{8}$/.test(value)) {
			throw new Error(`Invalid sortIndex '${value}' for EPUB annotation`);
		}
	}
	// TODO: Use isSnapshotAttachment() once that matches all annotatable HTML attachments
	else if (parentItem?.attachmentContentType === 'text/html') {
		if (!/^\d{7,8}$/.test(value)) {
			throw new Error(`Invalid sortIndex '${value}' for HTML annotation`);
		}
	}
	// Otherwise, allow any supported sortIndex format
	else if (!/^(\d{5}\|\d{6}\|\d{5}|\d{5}\|\d{8}|\d{7,8})$/.test(value)) {
		throw new Error(`Invalid sortIndex '${value}'`);
	}
	break;
}
```

| Attachment | Format | Example |
| --- | --- | --- |
| PDF | `\d{5}\|\d{6}\|\d{5}` | `12345\|123456\|12345` |
| EPUB | `\d{5}\|\d{8}` | `12345\|12345678` |
| HTML snapshot | `\d{7,8}` | `1234567` |

Examples are from `test/tests/itemTest.js:1663-1665`.

## Reader against backend, and against the importer

**Zotero's backend never computes a sortIndex.** It stores, validates, and
sorts. A whole-tree search for `sortIndex` under
`chrome/content/zotero/xpcom/` returns only `annotations.js` (JSON mapping),
`data/item.js` (validation and SQL), `data/items.js` (load and order),
`schema.js` (DDL), and `import/mendeley/mendeleyImport.mjs` (pass-through of a
worker result).

**The PDF worker uses a different algorithm.** `document-worker` computes the
sortIndex for annotations imported from a PDF file. Zotero calls it through
`Zotero.PDFWorker` (`chrome/content/zotero/xpcom/pdfWorker/manager.js:340`,
action `pdf.importAnnotations`, handled at `document-worker/src/index.js:190`).

`document-worker/src/pdf/index.js:225-275`

```js
	let page = await pdfDocument.getPage(pageIndex);
	pageHeight = page.view[3];
	...
	let offset = 0;
	if (['highlight', 'underline'].includes(annotation.type)) {
		let range = getRangeByHighlight(chars, annotation.position.rects);
		if (range) {
			offset = range.offset;
			annotation.text = range.text;
	...
	else if (['note', 'image', 'text'].includes(annotation.type)) {
		offset = getClosestOffset(chars, annotation.position.rects[0]);
	}
	// Ink
	else {

	}

	let top = 0;
	if (['highlight', 'underline', 'note', 'image', 'text'].includes(annotation.type)) {
		top = pageHeight - annotation.position.rects[0][3];
	}
	// Ink
	else {
		// Flatten path arrays and sort
		let maxY = [].concat.apply([], annotation.position.paths).filter((x, i) => i % 2 === 1).sort()[0];
		top = pageHeight - maxY;
	}
```

Differences from the reader function:

| Aspect | Reader (`selection.js:399`) | Importer (`document-worker/src/pdf/index.js:226`) |
| --- | --- | --- |
| `pageHeight` | `viewBox[3] - viewBox[1]` | `page.view[3]` |
| Rectangle | `rects` entry with largest index 2 | always `rects[0]` |
| Offset, highlight and underline | `getClosestOffset` on that rectangle | `getRangeByHighlight(...).offset` — the first character whose center intersects `rects[0]` |
| Offset, note / image / text | `getClosestOffset` | `getClosestOffset` on `rects[0]` — same rule |
| Offset, ink | `getClosestOffset` on the path bounding box | stays `0` |
| `top`, ink | `pageHeight - boundingRect[3]` | `pageHeight - maxY`, where `maxY` comes from a default **string** sort of the y values, taking element `[0]` |

The output format is identical in both. The inputs differ. Two dead copies of
the format helper also exist, `document-worker/src/pdf/utils.js:49` and
`document-worker/src/pdf/structure/util.js:78`; nothing imports either.

A comment in the reader records a known imprecision:

`reader/src/pdf/selection.js:742-744`

```js
// This currently gets sortIndex by position.rects, which is probably less precise than using an offset
selectionRange.sortIndex = getSortIndex(pdfPages, selectionRange.position);
```

---

# What ZotLit must reproduce

To make a ZotLit-created PDF annotation sort exactly like a Zotero-created one,
copy the **reader** algorithm, not the importer one.

1. **Format.** Emit `PPPPP|OOOOOO|TTTTT` — 18 characters, `|` separator, zero
   padded with `padStart`, truncated with `slice(0, N)` before padding.
2. **pageIndex.** The 0-based page index of `position.pageIndex`.
3. **Rectangle.** From `position.rects`, take the entry with the largest index-2
   value, stable on ties. When `rects` is absent, use the bounding box of
   `position.paths`.
4. **offset.** The index of the page character nearest to that rectangle, by
   `rectsDist`, first match wins. Use `0` when the page has no characters.
5. **top.** `Math.floor(pageHeight - rect[3])`, clamped to `0`, where
   `pageHeight = viewBox[3] - viewBox[1]` and `viewBox` is the PDF page box.
6. **Rounding.** Round every rectangle value to 3 decimals with
   `Math.round(v * 1e3) / 1e3` before the write, to match
   `roundPositionValues`. Compute the sortIndex from the unrounded values, as
   the reader does; `Math.floor` on `top` absorbs the difference in nearly every
   case.
7. **Color.** Lowercase 6-digit hex with a leading `#`. Default `#ffd400`.
8. **text.** Send it for `highlight` and `underline` only.
9. **Key order.** Put `annotationType` before every other `annotation*` key in
   the local-API request body.

## What ZotLit cannot compute without the PDF text layer

The `offset` field is the blocker. It needs Zotero's exact page character array:

- the PDF.js text-item character extraction that produces `char.c` and
  `char.rect`;
- the `c + rect.join('')` deduplication in `getStructuredChars`
  (`reader/pdfjs/pdf.js/src/core/module/structure.js:980-990`);
- the `split()` line, paragraph, rotation, and RTL grouping that fixes the final
  order (`reader/pdfjs/pdf.js/src/core/module/structure.js:700-978`).

Any other text extractor will produce a different index for the same visual
character. `pageIndex` and `top` need only the page box and the rectangle
geometry, so those two fields are reproducible outside Zotero.

Practical options, in order of fidelity:

1. Ask the running Zotero reader for the value. `PDFView.getAnnotationMeta(position)`
   returns `{ sortIndex, pageLabel }` for a position
   (`reader/src/pdf/pdf-view.js:727-737`), and `Reader._getSourceAnnotationMeta`
   wraps it (`reader/src/common/reader.js:1070-1076`). **Unverified:** whether
   this reaches an external caller through any Zotero IPC or local-API surface.
   Nothing in `chrome/content/zotero/xpcom/reader.js` or
   `chrome/content/zotero/xpcom/server/server_localAPI.js` exposed it in this
   checkout.
2. Port `getStructuredChars` and `split` into ZotLit and run them on the same
   PDF.js character output.
3. Emit `offset` as `000000` and accept a page-level plus vertical ordering that
   places the annotation before every Zotero-created annotation on the same page.

---

# Unverified items

| Item | Where the answer was expected | Result |
| --- | --- | --- |
| A public Zotero API that returns a computed sortIndex for a given position | `chrome/content/zotero/xpcom/reader.js`, `chrome/content/zotero/xpcom/server/server_localAPI.js` | Not present. `getAnnotationMeta` exists only inside the reader iframe. |
| Annotation field list in the bundled item-type schema | `resource/schema/global/schema.json` (version 44) | The `annotation` item type carries `"fields": []`. The annotation fields are hard-coded in `chrome/content/zotero/xpcom/data/item.js:4465`. |
| Sync-server-side sortIndex validation | The local checkout holds the client only. | Out of scope for this source tree. The Zotero web-API server is a separate repository. |
| Behavior of `getTopMostRectFromPosition` on a real multi-line highlight | Source reading only; no run against a real PDF. | The algorithm is stated exactly as written. Empirical rectangle choice for a specific document was not measured. |
| Whether the reader tool color persists across sessions from a Zotero preference | `chrome/content/zotero/xpcom/reader.js` | Not traced. The reader's in-memory default is `#ffd400` for both highlight and underline (`reader/src/common/reader.js:166-173`). |
