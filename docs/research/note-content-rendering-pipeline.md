# The note/content rendering pipeline in ZotLit v2

Research note for [issue #836](https://github.com/aidenlx/zotlit/issues/836).
Part of the wayfinder map [#835](https://github.com/aidenlx/zotlit/issues/835).
Investigated 2026-08-25 on branch `research/note-content-pipeline`.

The primary source is the code in this repository at commit `0f892c6eb`. Line
citations are repo-relative. Read them as `path:line`.

## Verdict

`note` and `content` are not two independent template objects. They are one
template that includes another, plus one structural rule about where the
included output starts and stops.

Three facts control the whole design:

1. `content` is a normal include of `note`
   (`packages/templates/defaults/note.liquid:5`). It is not a variable that the
   host injects.
2. The `%%zt-managed%%` markers are not in any template file. The render engine
   adds them to the output of the template that is named `content`
   (`packages/templates/src/obsidian.ts:20-23`,
   `apps/obsidian/src/services/template/service.ts:127`).
3. `note` and `content` receive the same data root
   (`packages/db/src/contract/roots.ts:21-26`). No data difference separates
   them.

Therefore the pair carries exactly one piece of information that a single
template cannot carry: **which part of the body an update is permitted to
replace.** Everything else about the pair is a consequence of that one
boundary.

Frontmatter is a third, independent layer. No template writes it
(`apps/obsidian/src/services/note-feature/operations.ts:312-314`).

## Method

| Item | Value |
| --- | --- |
| Repository | `aidenlx/zotlit`, worktree at commit `0f892c6eb` |
| Code read | `packages/templates/`, `packages/db/src/contract/`, `packages/protocol/`, `apps/obsidian/src/services/{template,template-workbench,note-feature,note-import}/`, `apps/obsidian/src/setting-tab/`, `apps/obsidian/src/views/template-data-explorer/` |
| Copy read | `messages/en.json`, `apps/docs/content/`, `skills/zotlit-template/SKILL.md`, `apps/obsidian/src/services/template-workbench/guide.ts` |
| Design records read | `apps/obsidian/CONTEXT.md`, `docs/adr/0002`, `docs/adr/0004`, `docs/adr/0005`, `docs/adr/0015` |

No code was changed and no test was run. This note records the state of the
code, not a proposal.

## 1. The six templates

The registry is `TEMPLATE_NAMES` at
`apps/obsidian/src/services/template/defaults.ts:58-65`. The array order is also
the row order in the setting tab. Each name has two built-in editions, Liquid
and Eta, held at byte parity
(`apps/obsidian/src/services/template/defaults.ts:67-84`).

| Name | Built-in file | What it renders | Role |
| --- | --- | --- | --- |
| `filename` | `packages/templates/defaults/filename.liquid` | the file name of a new Literature Note | root |
| `note` | `packages/templates/defaults/note.liquid` | the full Literature Note body | root; includes `content` |
| `content` | `packages/templates/defaults/content.liquid` | the Managed Region body | root on update; fragment inside `note`; includes `annotation` |
| `annotation` | `packages/templates/defaults/annotation.liquid` | one annotation | fragment; also a root for drag-insert and note import |
| `cite` | `packages/templates/defaults/cite.liquid` | the primary in-text citation | root |
| `cite2` | `packages/templates/defaults/cite2.liquid` | the secondary in-text citation | root |

A vault file at `zotlit-<name>.<liquid|eta>.md` replaces the built-in edition
(`apps/obsidian/src/services/template/defaults.ts:48-50`, `:86-98`). A Liquid
file wins over an Eta file with the same name
(`apps/obsidian/src/services/template/service.ts:651-706`).

The language is recorded only in the file extension. No setting holds it.

## 2. How `note` incorporates `content`

`content` is an engine-level include. The parent passes its own data down.

```liquid
# packages/templates/defaults/note.liquid:5
{% render "content" with zt as zt %}
```

```js
// packages/templates/defaults/note.eta:5
<%~ include("content", zt) %>
```

`content` includes `annotation` the same way, once for each annotation, but it
changes the data object: inside `annotation`, `zt` is the annotation
(`packages/templates/defaults/content.liquid:12`).

Both engines bind the data to `zt`. Liquid renders with `{ zt: data }`
(`packages/templates/src/facade.ts:246`); Eta sets `varName: "zt"`
(`packages/templates/src/index.ts:53`). An include can cross languages, because
the facade resolves an include by template name and then dispatches to the
winning engine for that name (`packages/templates/src/facade.ts:262-329`).

## 3. Where the managed boundary lives

The markers are constants in the templates package:

```ts
// packages/templates/src/obsidian.ts:2-3
export const MARKER_START = "%%zt-managed%%";
export const MARKER_END = "%%/zt-managed%%";
```

`formatManagedRegion` writes `MARKER_START`, a newline, the trimmed output, a
newline, and `MARKER_END` (`packages/templates/src/obsidian.ts:5-7`).

The wrap is a render hook, not template text. `managedRegionTransform` wraps the
output of one named template and passes every other name through
(`packages/templates/src/obsidian.ts:20-23`). The plugin installs it once, for
the name `content`:

```ts
// apps/obsidian/src/services/template/service.ts:127
transformRender: managedRegionTransform(MANAGED_CONTENT_TEMPLATE),
```

`MANAGED_CONTENT_TEMPLATE` is the literal `"content"`
(`apps/obsidian/src/services/template/defaults.ts:53`).

The hook fires on a direct render and on an include
(`packages/templates/src/index.ts:72-88`). Therefore the region that `note`
embeds at create time and the region that an update writes are the same bytes.
That identity is what makes the update splice possible.

**Consequence to remember:** the region exists in a note only because the `note`
template includes `content`. A user who removes that include line creates notes
that no update can refresh.

### The splice

`replaceManagedRegion` locates the region with a lazy pattern
(`packages/templates/src/obsidian.ts:25-28`) and replaces the first match only
(`packages/templates/src/obsidian.ts:50-63`). It calls the render function only
when a region exists, so a note without a region causes no render and no
attachment-import side effect. A function replacer is used, so `$` sequences in
the rendered body stay verbatim.

The write-back runs inside `vault.process`, which is the atomic
read-modify-write of Obsidian
(`apps/obsidian/src/services/note-feature/operations.ts:438-448`).

### How user text survives

The splice replaces a substring of the file text and returns the full string.
All text before `MARKER_START` and all text after `MARKER_END` is carried
through unchanged.

| Condition | Result |
| --- | --- |
| No markers | The file does not change. The user sees "Frontmatter updated. No managed region found." (`messages/en.json:48`) |
| Only one marker | The file does not change |
| More than one region | Only the first region is replaced. The others stay stale. A warning is logged (`apps/obsidian/src/services/note-feature/operations.ts:450-456`) |
| Text inside the markers | It is destroyed on each update. This is the contract |

## 4. Which template runs in which flow

There are four flows, not three. The update flow has two scopes,
`full` and `metadata` (`packages/protocol/src/url.ts:49`).

```
CREATE                     UPDATE full            UPDATE metadata     OVERWRITE
------                     -----------            ---------------     ---------
render "filename"          refresh frontmatter    refresh frontmatter refresh frontmatter
render "note"                                                         render "note"
  -> includes "content"    render "content"            (no body        replace whole body,
     (wrapped by the hook)   into the region           write)          keep the frontmatter
build frontmatter                                                       block
vault.create
```

Entry points:

| Flow | Function | Template render |
| --- | --- | --- |
| Create | `writeNewNote` | `renderFilename` at `apps/obsidian/src/services/note-feature/context.ts:120`; `render("note", …)` at `apps/obsidian/src/services/note-feature/operations.ts:311` |
| Update `full` | `applyManagedUpdate` → `replaceManagedBody` | `render("content", …)` at `apps/obsidian/src/services/note-feature/operations.ts:443` |
| Update `metadata` | `applyManagedUpdate` | no template render; body untouched (`apps/obsidian/src/services/note-feature/operations.ts:411-414`) |
| Overwrite | `overwriteNote` | `render("note", …)` at `apps/obsidian/src/services/note-feature/operations.ts:477` |

Create writes the frontmatter itself and prepends it:

```ts
// apps/obsidian/src/services/note-feature/operations.ts:312-314
const fm: Record<string, unknown> = {};
applyFrontmatter(ctx, fm, { context, itemKey: item.indexedKey });
const content = `---\n${stringifyYaml(fm)}---\n${body}`;
```

Overwrite keeps the frontmatter block and replaces all of the body:

```ts
// apps/obsidian/src/services/note-feature/operations.ts:478-481
await ctx.app.vault.process(file, (content) => {
  const prefix = FRONTMATTER_BLOCK.exec(content)?.[0] ?? "";
  return `${prefix}${body}`;
});
```

Overwrite does not look for the markers. It destroys all user prose in the body.
It is the only literature-note flow that does this.

Summary of what each flow keeps:

| Flow | Managed Region | User body outside the region | Frontmatter |
| --- | --- | --- | --- |
| Create | written fresh through the include | not applicable | built from an empty object |
| Update `full` | first region replaced | preserved | merged per key |
| Update `metadata` | untouched | preserved | merged per key |
| Overwrite | not consulted | **destroyed** | refreshed and re-prefixed |

An Imported Note is a different artifact with its own rules. It has no Managed
Region, and an overwrite replaces the whole file, frontmatter included
(`apps/obsidian/src/services/note-import/service.ts:404-424`).

## 5. Managed frontmatter

Frontmatter is produced structurally. No template emits a `---` block. The
built-in `note` template starts at the level-one heading.

A field is `{ key, expr, merge, language }`
(`packages/templates/src/constants.ts:42-47`). The settings key is
`note.frontmatter-fields` (`apps/obsidian/src/services/settings/schema.ts:105`).
The defaults are `title`, `related`, `collections`, and `citekey`, all with
`merge: "replace"` and `language: "liquid"`
(`apps/obsidian/src/services/template/defaults.ts:26-46`).

### The three merge strategies

The set is a closed list (`packages/templates/src/constants.ts:23-27`), applied
at `packages/templates/src/frontmatter-merge.ts:35-51`.

| Strategy | Behavior |
| --- | --- |
| `replace` | Write the new value over the old value, always |
| `append` | If both values are arrays, add the new items that are not present. If the old value is blank, write the new value. Otherwise write nothing and report a shape mismatch |
| `keep` | Write only when the old value is blank |

"Blank" means `null`, `undefined`, an empty string, an empty array, or an empty
plain object (`packages/templates/src/frontmatter-merge.ts:76-87`). A zero,
`false`, and a space are not blank.

Two rules protect the user:

- A key that the expression does not produce is not written
  (`packages/templates/src/frontmatter.ts:155`).
- The write is a patch, not a replacement. Unmanaged keys are never cleared
  (`apps/obsidian/src/services/note-feature/frontmatter.ts:29`), and the update
  path goes through `processFrontMatter`.

`zotero-key` is a system field. It is written after the user patch, so a user
field cannot overwrite it
(`apps/obsidian/src/services/note-feature/frontmatter.ts:31`). The reserved set
is `zotero-key`, `zotero-note-key`, and `zotero-lastmod`
(`apps/obsidian/src/lib/constants.ts:68-72`).

### Relation to the templates

Frontmatter shares only the `zt` data with the templates. It shares no file, no
include graph, and no marker. A Liquid frontmatter expression compiles through
the same Liquid instance
(`packages/templates/src/frontmatter.ts:109-114`), and a JavaScript expression
compiles with `new Function` behind the JavaScript Templates gate
(`packages/templates/src/frontmatter.ts:87`).

So a Literature Note has three ownership layers with three different
lifecycles:

```
+--------------------------------------------------+
| frontmatter   -> structural, merged key by key    |
+--------------------------------------------------+
| body above the region  -> written once by `note`, |
|                           then owned by the user  |
+--------------------------------------------------+
| %%zt-managed%% ... %%/zt-managed%%                |
|   -> written by `content`, replaced on each       |
|      full update                                  |
+--------------------------------------------------+
| body below the region  -> owned by the user       |
+--------------------------------------------------+
```

## 6. Surfaces that expose the distinction

The vocabulary is not the same on all surfaces.

| Surface | Word for `note` | Word for `content` |
| --- | --- | --- |
| Settings UI | "Literature note" (`messages/en.json:597`) | "Managed region" (`messages/en.json:599`) |
| Template Workbench CLI | `template=note` | `template=content` |
| Docs | "the note template" and "Literature note" | "the content template" and "Managed region" |
| Template Data Explorer | "Note root" — a data root, not a template | absent |
| Workbench Skill | absent | absent |

### Settings UI

The setting tab is `apps/obsidian/src/setting-tab/templates.ts`. It is a flat
list with one row per template name, in registry order
(`apps/obsidian/src/setting-tab/templates.ts:126-132`). There is no picker for
the template kind. The only per-row dropdown selects the language
(`apps/obsidian/src/setting-tab/templates.ts:269-301`).

The labels and descriptions come from `TEMPLATE_META`
(`apps/obsidian/src/setting-tab/templates.ts:567-595`):

| Row | Label | Description |
| --- | --- | --- |
| `note` | Literature note | "Body of a new literature note." (`messages/en.json:603`) |
| `content` | Managed region | "Managed region that will be overwritten on note update." (`messages/en.json:605`) |

The words "note template" and "content template" never appear in the settings
UI. The internal names reach the user only through the file path that the row
shows, such as `templates/zotlit-content.liquid.md`
(`apps/obsidian/src/setting-tab/templates.ts:239-245`).

### Eject flow

There is no eject chooser. Each row carries its own button, and the button
appears only while no vault file exists for that name
(`apps/obsidian/src/setting-tab/templates.ts:370-385`). The model is recorded in
the code comment at `apps/obsidian/src/setting-tab/templates.ts:217-221`.

- Per-row tooltip: "Create editable template file" (`messages/en.json:576`).
- Group tooltip: "Create all editable template files" (`messages/en.json:577`).
- Not-ejected state: "Using the built-in default." (`messages/en.json:585`).
- Bulk eject skips a name that already has a file of either language, and it
  always writes the Liquid edition
  (`apps/obsidian/src/setting-tab/templates.ts:531-548`).
- Deleting the file returns the name to the built-in default with no reload
  (`apps/docs/content/docs/concepts/how-templates-work.mdx:76`).

Because eject is per name, a user who wants to change the body of a literature
note must decide, before the first edit, whether the change belongs in
"Literature note" or in "Managed region". The decision comes first, and the
consequence of a wrong choice appears only at the next update.

### Template Workbench

The Workbench calls the names "Template slots". The raw identifiers are visible
to the agent, and the CLI text is English only
(`apps/obsidian/src/services/template-workbench/register.ts:3-5`).

- `zotlit:template-render template=<note|content|annotation|filename>`
  (`apps/obsidian/src/services/template-workbench/register.ts:122-126`).
- `zotlit:template-source template=<note|content|annotation|filename>`
  (`apps/obsidian/src/services/template-workbench/register.ts:134-138`).
- `zotlit:template-data root=<note|annotation|filename>`
  (`apps/obsidian/src/services/template-workbench/register.ts:83-89`). There is
  no `root=content`.

The guide explains the pair in four lines
(`apps/obsidian/src/services/template-workbench/guide.ts:126-131`):

```
note        Complete literature-note body. Used on create and overwrite. The
            built-in note template includes content.
content     Managed region only. Note updates replace this output and preserve
            text outside the region.
```

The two names share one data root
(`apps/obsidian/src/services/template-workbench/guide.ts:380-382`).

The Workbench Skill (`skills/zotlit-template/SKILL.md`) names no template kind
at all. It sends the agent to the guide. The docs page
`apps/docs/content/docs/concepts/template-workbench.mdx` does the same.

### Template Data Explorer

The Explorer has no `content` vocabulary. Its roots are the Note Root and the
Annotation Root (`messages/en.json:718-721`). Its snippet kinds are `output`,
`if-present`, `loop`, and `joined`
(`apps/obsidian/src/views/template-data-explorer/snippets.ts:13`), offered per
engine. A snippet is engine-specific; a copied path is engine-neutral.

So the Explorer already presents one object for the pair. It calls that object
the note root, and it is correct to do so: `TEMPLATE_SLOT_ROOTS` maps both
`note` and `content` to the root `note`
(`packages/db/src/contract/roots.ts:21-26`).

### Docs

| Page | What it says |
| --- | --- |
| `apps/docs/content/docs/concepts/how-templates-work.mdx:23-32` | the six-row table with the columns Template, Settings label, Vault filename, and What it renders. This is the only place that bridges the two vocabularies for a reader |
| `apps/docs/content/docs/concepts/literature-notes-and-the-managed-region.mdx:40-42` | the region holds the output of `content`; the heading, backlink, and attachment links come from `note` and sit outside the markers |
| `apps/docs/content/docs/reference/templates/data.mdx:16-20` | "Note and content templates" share one context |
| `apps/docs/content/docs/reference/templates/defaults.mdx:16-63` | one section for each of the two, with the include line quoted |
| `apps/docs/content/docs/reference/settings.mdx:254-264` | the row order and the row actions |
| `apps/docs/content/docs/how-to/keep-notes-updated.mdx:35,99-109` | update touches the region; overwrite replaces the whole body |
| `apps/docs/content/docs/how-to/migrate-v1-eta-templates.mdx:29-34` | v1 `annots` became `content` |

### i18n

Twelve messages carry the kind vocabulary
(`messages/en.json:597-608`). Nine more mention the distinction indirectly, of
which two matter most:

- `notice_updated_note_no_region` — "Frontmatter updated. No managed region
  found." (`messages/en.json:48`)
- `modal_overwrite_note_desc` — "Replace the note body with the ZotLit note
  template. Frontmatter keys managed by ZotLit are refreshed, and other
  frontmatter keys are kept." (`messages/en.json:57`)

## 7. The compile and render seam

A unified representation must target these functions. Nothing else compiles or
renders a template.

### Compile

| Function | Location | Note |
| --- | --- | --- |
| `TemplateFacade.define(name, source, language)` | `packages/templates/src/facade.ts:122` | the one compile entry point; sends Liquid to `Liquid.parse` and Eta to `TemplateEngine.define` |
| `TemplateEngine.define(name, source)` | `packages/templates/src/index.ts:91` | the Eta half |
| `createLiquidEngine(options)` | `packages/templates/src/liquid.ts:214` | the Liquid half, with the ZotLit tags and filters |
| `compileFrontmatterFields(fields, options)` | `packages/templates/src/frontmatter.ts:54` | the frontmatter expressions, which are not templates |

### Render

| Function | Location | Note |
| --- | --- | --- |
| `TemplateFacade.render(name, data)` | `packages/templates/src/facade.ts:160` | applies `transformRender`, so the managed wrap happens here |
| `TemplateService.render(name, data)` | `apps/obsidian/src/services/template/service.ts:339` | the application-wide entry point |
| `TemplateService.renderFilename(data)` | `apps/obsidian/src/services/template/service.ts:372` | collapses the output to one line |
| `evalFrontmatterFields(fields, zt, onError)` | `packages/templates/src/frontmatter.ts:144` | the frontmatter half |
| `replaceManagedRegion(content, region)` | `packages/templates/src/obsidian.ts:50` | the only reader of the markers |

### Call sites

| Feature | Site |
| --- | --- |
| Create body | `apps/obsidian/src/services/note-feature/operations.ts:311` |
| Update body | `apps/obsidian/src/services/note-feature/operations.ts:443` |
| Overwrite body | `apps/obsidian/src/services/note-feature/operations.ts:477` |
| File name | `apps/obsidian/src/services/note-feature/context.ts:120`, `:241` |
| Citation insert | `apps/obsidian/src/services/note-feature/operations.ts:507-509` |
| Annotation drag-insert | `apps/obsidian/src/lib/annotation-render.ts:123`, `:143` |
| Note import | `apps/obsidian/src/services/note-import/service.ts:375`, `:392` |
| Workbench render | `apps/obsidian/src/services/template-workbench/cli.ts:225-228` |

The Workbench renders in memory through the same `TemplateService.render`. Its
data comes from `buildInertNoteResolvers`
(`apps/obsidian/src/services/template/inert-resolvers.ts:86`), which gives the
side-effect-free behavior recorded in `docs/adr/0005`.

### Where the language is recorded

Only in the file extension
(`apps/obsidian/src/services/template/defaults.ts:48-50`), resolved by
`TemplateService.#reconcileName`
(`apps/obsidian/src/services/template/service.ts:651`). A unified representation
must either keep that convention or add an explicit language field, because
nothing else holds the choice.

## 8. Observations for the redesign

These follow from the code above. They are facts, not recommendations.

1. **The pair carries one bit of information.** That bit is the boundary of the
   replaceable region. A single template that can mark a region internally
   carries the same bit.
2. **The data model already treats the pair as one object.** Both names map to
   the root `note` (`packages/db/src/contract/roots.ts:21-26`), and the
   Explorer shows one tree for both.
3. **The wrap is host policy, not template syntax.** One line selects the
   wrapped name (`apps/obsidian/src/services/template/service.ts:127`). A
   different rule for where a region begins can replace that line without a
   renderer change.
4. **The include is ordinary.** `note` includes `content` with the same tag a
   user can write for any other name. No special case exists in the engine for
   this pair.
5. **The user-facing labels already hide the internal names**, except in the
   Workbench CLI and in the reference docs. The settings UI says "Literature
   note" and "Managed region" only.
6. **Overwrite is the sharp edge.** It is the one flow that reads no marker and
   keeps no user prose
   (`apps/obsidian/src/services/note-feature/operations.ts:460-488`). Any
   unified object must still be able to express "regenerate everything".
7. **Frontmatter is a separate axis and stays separate.** It is not produced by
   a template, and its merge strategies have no template counterpart. A unified
   note object that claims to hold "everything about a literature note" must
   decide whether it also holds the frontmatter field list, which today lives in
   settings, not in the vault.
8. **A user can break the update path silently.** Removing the include line from
   an ejected `note` template produces notes with no Managed Region. The update
   then reports "No managed region found." and changes nothing
   (`messages/en.json:48`).
