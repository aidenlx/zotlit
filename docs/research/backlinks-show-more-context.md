# Obsidian Backlinks view: how "Show more context" works

Primary-source analysis of the Backlinks-view context feature, for the Cited By sidebar
([#689](https://github.com/aidenlx/zotlit/issues/689)). It is a companion to
[`backlinks-view-parity.md`](./backlinks-view-parity.md), which defines the parity scope. This note
gives the implementation.

## Scope and sources

The workspace compiles against `obsidian@1.13.1`. An extraction of that patch was not available, so
this research uses the patch-compatible local extraction for **Obsidian 1.13.6**. All `app.js`,
`app.css` and `enhance.js` line numbers refer to that extraction:

- `node_modules/.ob-rev-1.13.6/app.js` — runtime implementation (oxfmt-formatted).
- `node_modules/.ob-rev-1.13.6/app.css` — runtime stylesheet.
- `node_modules/.ob-rev-1.13.6/enhance.js` — the DOM prototype helpers (`hide`, `show`, `toggle`).
- `node_modules/.ob-rev-1.13.6/i18n.js` — the default English strings.
- `packages/obsidian-api/obsidian.d.ts` — the public API type definitions.

Patch versions can change minified names and line numbers. The algorithms and the DOM contract are
the stable part.

### Verification of the prior citations

The parity note gives approximate locations. This research verified each one:

| Prior citation | Result |
| --- | --- |
| `app.js:101451-101617` chevron and expansion logic | Correct. Class `Gq` spans `app.js:101429-101617`. The chevrons are at `app.js:101452-101473`, the expansion methods at `app.js:101516-101598`. |
| `app.js:101112-101237` global toolbar action | Points at the excerpt algorithm, not the action. `getMatchExtraPositions` is at `app.js:101193-101234`. The toolbar action is at `app.js:156904-156908` and `app.js:157001-157010`. |
| `app.js:101722-101727` | Correct. This is the fan-out `setExtraContext` on the result container. |
| `app.js:101061-101159` result rendering | Correct for the file row and the match loop. |
| `app.js:101347-101410` navigation | Points at the property-match row (`Kq`). The content-match click handler is at `app.js:101483-101498`; the file-row handler is at `app.js:101241-101252`. |
| `app.js:156879-156975` Backlinks DOM construction | Correct. Class `Z3` starts at `app.js:156878`. |
| `app.css:16611-16704` search result CSS | Correct. |
| Truncated ends show `…` | The runtime appends three full stops, `"..."` (`app.js:101607`, `app.js:101611`). |

## Component map

Six classes matter here. A result container holds file rows, and each file row holds match rows:

| Class | Role | Location |
| --- | --- | --- |
| `Yq` | Result container. Holds the global `extraContext` flag and the virtual scroller. | `app.js:101618-101764` |
| `_q` | File row (`.tree-item.search-result`). Computes the excerpt range for each match. | `app.js:100997-101329` |
| `Gq` | Content-match row (`.search-result-file-match`). Holds the two chevrons and the per-match range. | `app.js:101429-101617` |
| `Kq` | Property-match row. It has no chevrons and no context. | `app.js:101330-101428` |
| `Z3` | Backlinks component: toolbar, both sections, and the two `Yq` instances. It extends the public `Component` (`app.js:14979`). | `app.js:156878-157605` |
| `$3` | Backlinks view (`"backlink"`). It delegates its state to `Z3`. Its base chain reaches the public `FileView` (`app.js:14993`, `app.js:139054-139136`). | `app.js:156822-156877` |

The global Search view (`app.js:138577`), an embedded search query block (`app.js:104830`), both
Backlinks sections (`app.js:156950`, `app.js:156969`) and the unlinked section of the Outgoing
links pane (`app.js:177930`) all build a `Yq`. They therefore share the context feature.

## 1. The global toggle

### State

`Z3` holds a boolean field `extraContext`, initialized to `false` (`app.js:156882`). The toolbar
button is created with the `lucide-move-vertical` icon and the label `labelMoreContext`
(`app.js:156904-156908`), which is "Show more context" (`i18n.js:1`).

`onToggleMoreContextClick` inverts the flag (`app.js:157001-157002`). `setExtraContext` then does
four things (`app.js:157004-157010`):

1. It stores the new value.
2. It calls `setExtraContext` on the linked-mentions container and on the unlinked-mentions
   container.
3. It calls `extraContextButtonEl.toggleClass("is-active", value)`. The `is-active` class is the
   only visual state; `Element.prototype.toggleClass` adds or removes it (`enhance.js:1`). The
   stylesheet gives an active nav action `--icon-color-focused` and
   `--background-modifier-hover` (`app.css:9172-9175`).
4. It calls `app.workspace.requestSaveLayout()`.

The guard `e !== this.extraContext` makes the method idempotent.

### Where the state lives

`Z3.getState()` returns the key **`extraContext`** together with `collapseAll`, `sortOrder`,
`showSearch`, `searchQuery`, `backlinkCollapsed` and `unlinkedCollapsed` (`app.js:157012-157021`).
`Z3.setState()` reads the same keys and applies `extraContext` when it is a boolean
(`app.js:157031`, `app.js:157038`).

The view merges that object into its own state: `$3.getState()` is
`Object.assign(super.getState(), this.backlink.getState())` (`app.js:156844-156847`), and
`$3.setState()` forwards the whole state object to `Z3` (`app.js:156848-156861`). The key is
therefore a top-level member of the Backlinks **view state**, and `requestSaveLayout` persists it in
the workspace layout.

The global Search view uses the same key name for the same purpose. It exposes the option as a
toggle row named `labelMoreContext` inside the search filter panel (`app.js:138633-138641`), stores
it as `state.extraContext` from `this.dom.extraContext` (`app.js:138751`), restores it through the
toggle component (`app.js:138770`, `app.js:138776`), and saves the layout (`app.js:138809-138811`).

The Backlinks-in-document component builds a second `Z3` inside the Markdown view
(`app.js:158254`). The Markdown view state keeps only the boolean `backlinks` for visibility
(`app.js:158239`, `app.js:156775`), so that embedded instance starts each session with
`extraContext` false.

### Fan-out

`Yq.setExtraContext` stores the value and calls `setExtraContext` on every file row, then
invalidates all scroll measurements (`app.js:101722-101728`). `_q.setExtraContext` re-renders the
file row when the value changes (`app.js:101321-101323`). New results receive the current value at
creation time (`app.js:101695`).

Take care: a directly constructed `_q` defaults to `extraContext = true` (`app.js:101004`), while a
`Yq` defaults to `false` (`app.js:101642`). Only `Yq.addResult` aligns the two.

### Command surface

The Backlinks core plugin registers three global commands: `backlink:open`,
`backlink:open-backlinks` and `backlink:toggle-backlinks-in-document`
(`app.js:156644-156663`). No command toggles the context. A plugin can reach the state only through
the view state, for example with `leaf.setViewState({ type: "backlink", state: { extraContext: true } })`.
That path is undocumented and it is not part of the public API.

## 2. Per-match expansion with the hover chevrons

### Construction

The `Gq` constructor creates both buttons in the match element and hides them immediately
(`app.js:101452-101473`):

- `.search-result-hover-button.mod-top` with the `lucide-chevron-up` icon.
- `.search-result-hover-button.mod-bottom` with the `lucide-chevron-down` icon.

Both get the tooltip `labelMoreContext`, that is the same "Show more context" string as the toolbar
button, with placement `top` and `bottom` (`app.js:101456`, `app.js:101466`).

`hide()` sets `style.display = "none"` and `show()` restores it (`enhance.js:1`). Visibility is
therefore JavaScript state, not a CSS hover rule.

### When the buttons are visible

`toggleShowMoreContextButtons` shows the top button when `start > 0` and the bottom button when
`end < content.length` (`app.js:101512-101515`). The limits are the ends of the **whole file
content**, not the ends of the current chunk.

`onFocusEnter` calls that method (`app.js:101505-101511`). Two events call `onFocusEnter`:

- A `mouseover` on the match element (`app.js:101476`). The handler first tests `Dv(e, this.el)`,
  which returns true when the pointer comes from outside the element (`app.js:38816-38818`), and
  also triggers the `hover-link` preview through the parent (`app.js:101508`,
  `app.js:101254-101269`).
- Keyboard focus: `Yq.setFocusedItem` adds the `has-focus` class and calls `onFocusEnter` on a `Gq`
  (`app.js:101743-101752`).

`onFocusExit` runs on `mouseout` (`app.js:101477`). It hides both buttons, and it keeps them in two
cases: the pointer moves to another node inside the same match element, or the element has the
`has-focus` class (`app.js:101500-101504`).

### What one click does

Each click extends the range by one chunk in that direction (`app.js:101516-101537`):

```ts
showMoreBefore(): void {
  let pos = this.start;
  while (pos > 0) {
    pos--;                            // step over the boundary character
    const prev = this.getPrevPos(pos); // start of the chunk that contains pos
    if (prev < pos) { pos = prev; break; }
    // pos already sits on a chunk start (a blank line): keep walking back
  }
  this.start = pos;
  this.render();        // no ellipsis arguments
  this.onFocusEnter();  // re-evaluate the two buttons
}

showMoreAfter(): void {
  let pos = this.end;
  while (pos < this.content.length) {
    pos++;
    const next = this.getNextPos(pos);
    if (next > pos) { pos = next; break; }
  }
  this.end = pos;
  this.render();
  this.onFocusEnter();
}
```

The inner loop consumes blank lines in the same click, because `getPrevPos` returns `pos` itself
when `pos` sits at a line start.

### Relation to the global toggle

The per-match range lives in the `Gq` instance fields `start` and `end` (`app.js:101447-101448`).
Nothing persists it.

A global toggle discards it. `Yq.setExtraContext` calls `_q.setExtraContext`
(`app.js:101724-101725`), which calls `renderContentMatches` (`app.js:101322`). That method starts
with `this.vChildren.clear()` (`app.js:101094`) and then constructs new `Gq` objects
(`app.js:101115`). Every expanded match returns to the computed range of the new mode. The reverse
toggle does the same, so the compact mode is also a full reset.

## 3. The context algorithm (`extraContext` on)

`_q.getMatchExtraPositions(content, match, cache)` returns the `[start, end]` offsets of the one
logical chunk that holds the match (`app.js:101193-101234`). `cache` is the object from
`app.metadataCache.getFileCache(file)` (`app.js:101166`). The order is list item, then section,
then a raw-text fallback. This confirms the order recorded in the parity note.

```ts
// app.js:101193-101234, reconstructed
function getMatchExtraPositions(
  content: string,
  match: [number, number],
  cache: CachedMetadata,
): [number, number] {
  const { listItems, sections } = cache;

  // 1. List item, including its descendants.
  if (listItems) {
    const i = binarySearchByOffset(listItems, match[0]);      // yD, app.js:71631
    const item = listItems[i];
    if (item && match[0] >= item.position.start.offset && match[1] <= item.position.end.offset) {
      let last = item;
      let j = i + 1;
      const lines = new Set<number>([item.position.start.line]);
      while (j < listItems.length) {
        const child = listItems[j];
        if (!lines.has(child.parent)) break;   // ListItemCache.parent is a line number
        lines.add(child.position.start.line);
        j++;
        last = child;
      }
      // start.col moves the start to the first column of that line
      return [item.position.start.offset - item.position.start.col, last.position.end.offset];
    }
  }

  // 2. Root-level section.
  if (sections) {
    const i = binarySearchByOffset(sections, match[0]);
    const s = sections[i];
    if (s && match[0] >= s.position.start.offset && match[1] <= s.position.end.offset) {
      return [s.position.start.offset, s.position.end.offset];
    }
  }

  // 3. Raw-text fallback. It runs when the cache has no such array, or when no cached range
  //    holds the match. The scan stops 1000 characters from the match start on each side.
  let lineStart = match[0];
  const backLimit = lineStart - 1000;
  while (lineStart > 0 && lineStart > backLimit && content.charCodeAt(lineStart - 1) !== 10) lineStart--;

  let lineEnd = match[0];
  const fwdLimit = lineEnd + 1000;
  while (lineEnd < content.length && lineEnd < fwdLimit && content.charCodeAt(lineEnd) !== 10) lineEnd++;

  // 3a. The match line is a list line: extend down over the deeper-indented lines.
  const own = content.substring(lineStart, lineEnd).match(LIST_PREFIX); // bO, app.js:87463
  if (own && own[2]) {
    let end = lineEnd;
    while (end < content.length) {
      let nl = content.indexOf("\n", end + 1);
      if (nl === -1) nl = content.length;
      const next = content.substring(end + 1, nl).match(LIST_PREFIX);
      if (next && next[1].length <= own[1].length) break;  // same or shallower indent ends it
      end = nl;
    }
    return [lineStart, end];
  }

  // 3b. Otherwise take the paragraph between two blank lines.
  let from = lineStart;
  while (from > 0 && from > backLimit && !blankLineAt(content, from)) from--;  // jq, app.js:100978
  while (content.charCodeAt(from) === 10 && from < lineStart) from++;
  let to = lineEnd;
  while (to < content.length && to < fwdLimit && !blankLineAt(content, to)) to++;
  return [from, to];
}
```

Notes on the details:

- **Binary search.** `yD(items, offset, biasHigh)` compares against `position.start.offset` and
  `position.end.offset` and returns the containing index, or the insertion index on a miss
  (`app.js:71631-71647`). The third argument has no effect in this build, because the two bounds
  meet at the same index. The callers therefore repeat the containment test on the returned item.
- **`start.col`.** The list branch subtracts `position.start.col` so that the excerpt begins at the
  first column of the line. That keeps the indentation and any blockquote markers
  (`app.js:101207`).
- **Descendants.** The walk accepts an item only when its `parent` line is already in the set, so
  it collects children and grandchildren and it stops at the next sibling of the top item
  (`app.js:101202-101206`). `ListItemCache.parent` is documented as a line number, negative for a
  root-level item (`obsidian.d.ts:3746-3775`).
- **List prefix regex** `bO`: `/^([>\s]*)(([*+-] |(\d+)([.)] ))(?:\[(.)\] )?)?/` (`app.js:87463`).
  Group 1 is the blockquote and whitespace run, group 2 is the bullet or number plus an optional
  task box. Group 2 decides whether the line is a list line. Group 1 lengths compare the indents.
- **Blank-line regex** `jq`: `/\r?\n\r?\n/y` (`app.js:100978`). It is sticky, so `jq.lastIndex = w;
  jq.test(content)` asks "does a blank line begin exactly at `w`".
- **Ellipsis.** The extra-context path calls `render()` with no arguments (`app.js:101124-101125`),
  so an extra-context excerpt shows no `"..."` at either end.
- The fallback branch runs rarely for Markdown, because the metadata cache gives `sections` for the
  whole document. It covers files without a cache and matches that fall between two cached ranges.

`getPrevPos` and `getNextPos` implement the same three-step order for one direction, with two
differences (`app.js:101538-101598`):

- They skip a section of type `"list"`, so a whole list does not enter the excerpt in one click.
  The list-item branch handles list content instead (`app.js:101554`, `app.js:101590`).
- Their line fallback is a plain line scan with no character limit and no paragraph rule
  (`app.js:101560-101561`, `app.js:101596-101597`).

```ts
// app.js:101538-101598, reconstructed
function getPrevPos(pos: number): number {
  const { listItems, sections } = this.cache;
  const item = listItems?.[binarySearchByOffset(listItems, pos)];
  if (item && item.position.start.offset - item.position.start.col <= pos
      && item.position.end.offset >= pos) {
    return item.position.start.offset - item.position.start.col;
  }
  const s = sections?.[binarySearchByOffset(sections, pos)];
  if (s && s.type !== "list" && s.position.start.offset - s.position.start.col <= pos
      && s.position.end.offset >= pos) {
    return s.position.start.offset - s.position.start.col;
  }
  let i = pos;
  while (i > 0 && this.content.charCodeAt(i - 1) !== 10) i--;   // start of the line
  return i;
}

function getNextPos(pos: number): number {
  // the same order; the list branch walks the descendants and returns last.position.end.offset,
  // the section branch returns position.end.offset, the fallback returns the end of the line.
}
```

## 4. The compact excerpt (`extraContext` off)

`cb(content, match, limit = 100)` returns four values (`app.js:57217-57229`):

```ts
// app.js:57217-57229, reconstructed
function compactExcerpt(
  content: string,
  match: [number, number],
  limit = 100,
): [start: number, end: number, ellipsisBefore: boolean, ellipsisAfter: boolean] {
  let start = match[0] - 1;
  let back = 0;
  while (back < limit && start >= 0) {
    if (content.charAt(start) === "\n") break;
    start--; back++;
  }
  start++;

  let end = match[1];
  let fwd = 0;
  while (fwd < limit && end < content.length) {
    if (content.charAt(end) === "\n") break;
    end++; fwd++;
  }
  return [start, end, back === limit, fwd === limit];
}
```

- The excerpt never crosses a line break. It is the match plus at most 100 characters before it and
  at most 100 characters after it.
- The ellipsis flags mean "the 100-character limit cut the text here". A line that is shorter than
  the limit produces no ellipsis.
- There is no whitespace trimming at either end. The raw source text, with its indentation, goes
  into the DOM, and `white-space: pre-wrap` shows it (`app.css:16644`).

### How several matches share one row

`renderContentMatches` sorts the match array by start offset and then walks it
(`app.js:101096-101133`). For each row it computes a window, and it merges the following matches
that begin inside that window:

```ts
// app.js:101096-101133, reconstructed
matches.sort((a, b) => a[0] - b[0]);
let i = 0;
const emit = (start: number, end: number, ellipsisBefore?: boolean, ellipsisAfter?: boolean) => {
  let j = i + 1;
  if (!this.separateMatches) {
    while (j < matches.length) {
      const next = matches[j];
      if (next[0] >= end) break;          // begins after the window: keep it for the next row
      if (next[1] > end) { end = next[1]; j++; break; }  // straddles the window: extend and stop
      j++;                                 // fully inside: absorb
    }
  }
  const row = new Gq(this, content, cache, start, end, matches.slice(i, j), mutateEState);
  row.onMatchRender = this.onMatchRender;
  row.render(ellipsisBefore, ellipsisAfter);
  this.vChildren.addChild(row);
  i = j;
};

while (i < matches.length) {
  if (this.extraContext) {
    const [start, end] = this.getMatchExtraPositions(content, matches[i], cache);
    emit(start, end);                              // no ellipsis in this mode
  } else {
    const [start, end, before, after] = compactExcerpt(content, matches[i]);
    emit(start, end, before, after);
  }
}
```

The merge runs in both modes. In extra-context mode every match of one chunk lands in one row, so
the excerpt appears once and carries several highlights. The flag `separateMatches` turns the merge
off; the unlinked-mentions section sets it, because each mention needs its own "Link" button
(`app.js:157528-157530`).

Match ranges themselves come from the metadata cache. For linked mentions the Backlinks component
pushes `[reference.position.start.offset, reference.position.end.offset]` into `result.content` for
every reference that resolves to the target file (`app.js:157366-157376`). Frontmatter references
go to `result.properties` and render through `Kq` without context (`app.js:101185-101186`).

## 5. Rendering

### DOM per match

`Gq.render(ellipsisBefore, ellipsisAfter)` produces the row (`app.js:101599-101613`):

```text
div.search-result-file-match.tappable
├─ "..."                                    (text node, only when ellipsisBefore)
├─ span                                     (plain context text)
├─ span.search-result-file-matched-text     (one matched range)
├─ span                                     (plain context text)
├─ div.search-result-hover-button.mod-top   (chevron up, display:none when inactive)
├─ div.search-result-hover-button.mod-bottom(chevron down)
└─ "..."                                    (text node, only when ellipsisAfter)
```

`render` empties the element first, so it re-appends both buttons on every render
(`app.js:101606-101610`). Their `display` state survives, because it is an inline style on the
retained element objects.

The surrounding structure comes from `_q`: `div.tree-item.search-result` with
`div.tree-item-self.search-result-file-title.is-clickable`, a `div.tree-item-icon.collapse-icon`,
and the match list `div.search-result-file-matches` (`app.js:101027-101077`).

### Matched ranges

`Uq(el, text, start, end, matches)` writes the spans (`app.js:100979-100996`):

```ts
// app.js:100979-100996, reconstructed
function renderRange(
  el: HTMLElement,
  text: string,
  start: number,
  end: number,
  matches: SearchMatches,
): void {
  let cursor = start;
  for (const [rawFrom, rawTo] of matches) {
    if (rawFrom >= end) break;      // the array is sorted, so stop here
    if (rawTo < start) continue;
    const from = Math.max(rawFrom, start);
    const to = Math.min(rawTo, end);
    if (from > cursor) el.createSpan({ text: text.substring(cursor, from) });
    el.createSpan({ cls: "search-result-file-matched-text", text: text.substring(from, to) });
    cursor = to;
  }
  if (cursor < end) el.createSpan({ text: text.substring(cursor, end) });
}
```

Every piece of the excerpt becomes a `span`. Only a matched piece gets
`search-result-file-matched-text`. The offsets are absolute file offsets, and the function clamps
them to the excerpt window, so an expansion needs no offset arithmetic.

### The per-match render hook

After the spans, `render` calls `onMatchRender(firstMatch, el)` when the file row supplies one
(`app.js:101605`, `app.js:101612`). The unlinked-mentions section uses it to add the
`button.search-result-file-match-replace-button` with the text "Link" (`app.js:157566-157572`,
`i18n.js:1`).

### Navigation

A click on a match row opens the file with an ephemeral state
`{ match: { content, matches } }` (`app.js:101483-101498`). A click on the file title opens the
file with the full match list (`app.js:101241-101252`). A `mouseover` triggers `hover-link` with
`{ scroll: lineOfOffset(content, matches[0][0]) }` (`app.js:101254-101269`, `app.js:37816-37819`).

### CSS

| Rule | Effect | Location |
| --- | --- | --- |
| `.search-result-file-matches` | Card container: `--font-ui-smaller`, `--line-height-tight`, `--search-result-background`, `--radius-s`, `--background-modifier-border` ring, `--text-muted`. | `app.css:16624-16633` |
| `.search-result-file-match` | `position: relative`, `white-space: pre-wrap`, padding `--size-4-2 --size-4-5 --size-4-2 --size-4-3`, bottom border. The larger inline-end padding reserves the chevron column. | `app.css:16640-16647` |
| `.search-result-file-match:hover` | `--text-normal` and `--text-selection` background, inside `@media (hover: hover)`. | `app.css:16651-16659` |
| `.search-result-hover-button` | `position: absolute`, `inset-inline-end: 2px`, `--radius-s`, `--text-faint`, padding `1px 3px`. | `app.css:16679-16686` |
| `.search-result-hover-button:hover` | `--background-modifier-hover`. | `app.css:16687-16692` |
| `.mod-top` / `.mod-bottom` | `top: 2px` / `bottom: 2px`. | `app.css:16693-16698` |
| `.search-result-file-matched-text` | `--text-normal` on `--text-highlight-bg`. | `app.css:16699-16702` |
| `.search-result-file-match.has-focus` | Keyboard focus ring with `--background-modifier-border-focus`, in an active leaf. | `app.css:16766-16771` |
| `.search-result-file-match` in the bidi list | `unicode-bidi: plaintext`, for mixed-direction excerpts. | `app.css:4593-4618` |

The hover buttons carry no `display` rule. Their visibility comes from the JavaScript
`hide()`/`show()` calls described above.

## 6. Public API surface

The export table in `app.js` gives the public name of each relevant symbol:

| Public name | Minified | Export entry | Implementation |
| --- | --- | --- | --- |
| `renderMatches` | `lb` | `app.js:15110` | `app.js:57190-57216` |
| `renderResults` | `sb` | `app.js:15112` | `app.js:57187-57189` |
| `sortSearchResults` | `nb` | `app.js:15120` | `app.js:57154-57158` |
| `prepareFuzzySearch` | `Zy` | `app.js:15106` | — |
| `prepareSimpleSearch` | `ab` | `app.js:15108` | `app.js:57181-57186` |
| `MetadataCache` | `eR` | `app.js:15012` | — |
| `SearchComponent` | `ow` | `app.js:15032` | — |
| `Component` | `mg` | `app.js:14979` | — |

A reverse lookup for `() => Uq`, `() => cb`, `() => Gy`, `() => yD`, `() => Gq`, `() => _q`,
`() => Yq` and `() => Z3` returns no export entry. These parts are internal.

### What a plugin can reuse

- **The match data types.** `SearchMatchPart` is `[number, number]` and `SearchMatches` is an array
  of them (`obsidian.d.ts:5579-5587`). `SearchResult` is `{ score, matches }`
  (`obsidian.d.ts:5593-5600`). `SearchResultContainer` is `{ match: SearchResult }`
  (`obsidian.d.ts:5604-5608`). The internal code uses the same `[start, end]` offset pairs.
- **The metadata cache.** `MetadataCache.getFileCache(file)` returns `CachedMetadata`
  (`obsidian.d.ts:4417`), which exposes `sections?: SectionCache[]` and `listItems?: ListItemCache[]`
  (`obsidian.d.ts:1435-1442`). `CacheItem.position` is a `Pos` of two `Loc` values with `line`,
  `col` and `offset` (`obsidian.d.ts:1469-1476`, `obsidian.d.ts:5231-5245`,
  `obsidian.d.ts:3884-3902`). `SectionCache.type` and `ListItemCache.parent` are documented
  (`obsidian.d.ts:5668-5681`, `obsidian.d.ts:3746-3775`). Everything that
  `getMatchExtraPositions` reads is public.
- **`sortSearchResults`** for ordering result containers (`obsidian.d.ts:6786`).
- **`prepareFuzzySearch` / `prepareSimpleSearch`** for a filter field
  (`obsidian.d.ts:5252`, `obsidian.d.ts:5260`).

### What a plugin must write again

- **The highlight markup.** `renderMatches(el, text, matches, offset?)`
  (`obsidian.d.ts:5416`) writes `span.suggestion-highlight` (`app.js:57208`), which is the
  suggestion style. The result-card style needs `span.search-result-file-matched-text`, and the
  internal `Uq` produces it (`app.js:100993`). A plugin that wants the result-card look writes its
  own span loop, or restyles the suggestion class. `renderMatches` also takes no window: it renders
  the whole `text` and shifts the match offsets by `offset`, so the caller passes a pre-cut
  substring and a negative offset.
- **The excerpt algorithms.** `getMatchExtraPositions`, `getPrevPos`, `getNextPos` and the compact
  `cb` have no public counterpart. The pseudocode above is enough to write them again over
  `CachedMetadata`.
- **The result DOM.** `Yq`, `_q` and `Gq` are internal, together with the virtual scroller. A
  plugin builds its own rows. The parity note already decides that Cited By owns its markup.
- **The state.** The `extraContext` key belongs to the Backlinks and Search views. A plugin view
  defines its own key in its own `getState`/`setState`, and calls
  `app.workspace.requestSaveLayout()` after each change.

## 7. Points to watch

1. **The ellipsis disappears after the first expansion.** `showMoreBefore` and `showMoreAfter` call
   `render()` with no arguments, and the two flags default to `undefined`
   (`app.js:101525`, `app.js:101536`, `app.js:101599-101611`). A compact excerpt that showed
   `"..."` loses both marks as soon as the reader expands it, even when the text is still cut. Keep
   the flags in the row state to avoid this.
2. **The marker is `"..."`, not `"…"`** (`app.js:101607`, `app.js:101611`).
3. **The global toggle destroys the per-match ranges** (`app.js:101094`, `app.js:101322`). Users who
   expanded single matches lose that work when they press the toolbar button. A plugin can keep a
   per-match map instead, keyed by the first match offset.
4. **The chevron test uses the file length.** `end < content.length` keeps the bottom chevron
   visible for a trailing newline, so the last click can add an empty line
   (`app.js:101513-101514`).
5. **`white-space: pre-wrap` is required.** The excerpt keeps the raw indentation, the list bullets
   and the internal newlines of a chunk. Without `pre-wrap` an expanded multi-line chunk collapses
   into one line (`app.css:16644`).
6. **Reserve the chevron column.** The chevrons sit at `inset-inline-end: 2px` over the text, and
   only the `--size-4-5` inline-end padding stops an overlap (`app.css:16643`,
   `app.css:16679-16682`).
7. **Sort the matches first.** Both `Uq` and the merge loop assume ascending start offsets and use
   `break` on the first out-of-window entry (`app.js:100984`, `app.js:101097-101099`).
8. **Merge overlapping ranges before you render.** The runtime passes file-title matches through
   `Gy`, which sorts and joins overlapping pairs (`app.js:57076-57084`). Two overlapping highlight
   spans in one row produce duplicated text.
9. **CRLF files.** The paragraph fallback skips only character code 10 after a blank-line match
   (`app.js:101231`), so a file with `\r\n` line ends can keep a leading blank line in the excerpt.
10. **The 1000-character caps** in the fallback bound the scan on each side of the match start
    (`app.js:101216-101217`, `app.js:101230-101232`). They protect long single-line files.
11. **Render lazily.** `_q.onRender` renders the matches of a file row only once, when the virtual
    scroller reaches the row (`app.js:101080-101082`, `app.js:75502-75524`). The Backlinks scan
    itself runs in batches of two files with a pause callback (`app.js:157313`). A sidebar with
    many results needs the same shape of laziness.
12. **`renderContentMatches` runs on `setExtraContext` even before the first render**
    (`app.js:101321-101323`), because it does not read the `rendered` flag. The row then renders a
    second time from `onRender`. Guard your own equivalent.
13. **Property matches have no context.** `Kq` renders `key: value` with highlights and no chevrons
    (`app.js:101379-101425`). Cited By occurrences that come from frontmatter need the same
    decision.

## Mapping table

Public names come from the export table in `app.js`. Entries with no public name are internal.

| Minified | Public name | Role | Location |
| --- | --- | --- | --- |
| `lb` | `renderMatches` | Highlights with `suggestion-highlight`. | `app.js:15110`, `57190` |
| `sb` | `renderResults` | `renderMatches` over a `SearchResult`. | `app.js:15112`, `57187` |
| `nb` | `sortSearchResults` | Sorts containers by descending score. | `app.js:15120`, `57154` |
| `ab` | `prepareSimpleSearch` | Word search factory. | `app.js:15108`, `57181` |
| `Zy` | `prepareFuzzySearch` | Fuzzy search factory. | `app.js:15106` |
| `Uq` | — | Highlights with `search-result-file-matched-text` over a window. | `app.js:100979` |
| `cb` | — | Compact excerpt with a 100-character cap per side. | `app.js:57217` |
| `Gy` | — | Sorts and merges overlapping ranges. | `app.js:57076` |
| `yD` | — | Binary search of cache items by offset. | `app.js:71631` |
| `WA` | — | Counts the matches of a result object. | `app.js:73795` |
| `Yd` | — | Converts an offset to a line number. | `app.js:37816` |
| `Dv` | — | Tests that a pointer event crosses the element border. | `app.js:38816` |
| `bO` | — | List-prefix regex. | `app.js:87463` |
| `jq` | — | Sticky blank-line regex. | `app.js:100978` |
| `Gq` | — | Content-match row with the two chevrons. | `app.js:101429` |
| `Kq` | — | Property-match row. | `app.js:101330` |
| `_q` | — | File row; owns `getMatchExtraPositions`. | `app.js:100997` |
| `Yq` | — | Result container; owns the global `extraContext`. | `app.js:101618` |
| `Z3` | — | Backlinks component: toolbar, sections, state. | `app.js:156878` |
| `$3` | — | Backlinks view. | `app.js:156822` |
| `X3` | — | The view type string `"backlink"`. | `app.js:156627` |
| `Q3` | — | The Backlinks core plugin. | `app.js:156628` |
