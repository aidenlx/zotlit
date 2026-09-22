[Spec #1157](https://github.com/aidenlx/zotlit/issues/1157) | [First PR #1153](https://github.com/aidenlx/zotlit/pull/1153) | [Sub-branch PR #1167](https://github.com/aidenlx/zotlit/pull/1167) | Closes #1155–#1166

## Why the change

The reader and the Annotation View could show a Zotero attachment's annotations only while one data source kept answering, and they could not change them; this PR keeps that list on screen through source changes and adds editing, Mark Landing, and the review findings from the first PR.

## Special things to note

- Editing lands with an accepted risk. Overlapping writes to one annotation in Zotero and Obsidian can silently lose a comment, and a delete in Obsidian can remove an annotation that Zotero has just updated ([#1165](https://github.com/aidenlx/zotlit/issues/1165)). The [editing guide](apps/docs/content/docs/how-to/edit-pdf-annotations.mdx) tells users to edit in one application at a time. The Paired Run keeps the tests that reproduce both races.
- Two prototype patches stand on undocumented Obsidian behaviour, both read out of the 1.14.2 bundle and neither live-measured: `window.open` for File Link Capture ([ADR 0045](apps/obsidian/docs/adr/0045-file-link-capture-patches-window-open.md)) and `WorkspaceLeaf.setEphemeralState` for Mark Landing ([ADR 0046](apps/obsidian/docs/adr/0046-landing-on-a-mark-is-an-ephemeral-state-contract-read-at-the-leaf.md)). [docs/pdf-annotation-probes.md](docs/pdf-annotation-probes.md) lists them for re-verification when `minAppVersion` moves.
- The uncertain-create workflow is removed. A create whose answer never arrives now ends as a failed write that asks for a refresh, so the badged card and its retry path are gone ([ADR 0048](apps/obsidian/docs/adr/0048-annotation-drafts-and-pending-writes-stay-in-memory.md) supersedes [ADR 0039](apps/obsidian/docs/adr/0039-an-uncertain-create-is-reconciled-by-stable-fields-and-retried-only-by-the-user.md)).

## Change outline

### One repository holds an attachment's annotations

`AnnotationRepository` replaces the per-view read and write state. The Annotation View and the PDF reader read one held list, one Editing Capability, and one comment draft. Nothing patches a list in place: a consumer re-reads the whole list on `annotations-changed`.

```ts
// apps/obsidian/src/services/annotation-repository/service.ts
interface AnnotationList {
  source: AnnotationSource            // zotero-db or zotero-local-api; atomic per Attachment
  annotations: readonly AnnotationRecord[]
}

interface DatabaseAnnotationSource {
  kind: "zotero-db"
  database: { userID: number | null; localUserKey: string | null; serverID: string | null }
  libraryID: number
  libraryRevision: number | null      // committed server revision this snapshot holds
}

interface CommentDraft {              // one per Annotation, shared by the card and the popup
  annotationKey: string
  attachmentKey: string
  serverID: string                    // the database that answered when editing began
  baseline: string                    // the confirmed comment
  text: string                        // the user's current text
  state: CommentDraftState            // editing | pending | conflict | failed
}

type MutationState =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "conflict"; conflict: WriteConflict }
  | { kind: "failed"; failure: WriteFailure }
  // "uncertain" is gone; ADR 0048 supersedes ADR 0039's create recovery
```

### What a refresh keeps on screen

The held list stays visible while the replacement is prepared, so a source change never empties the reader or the view.

```diff
 on(refresh(attachmentKey))
-  read the active source and publish its answer
+  join the refresh already running for this Attachment
+  read the Local API while the held list stays published
+  publish a replacement only from the same Zotero database and Library
+  publish a database list only when it covers the writes the API acknowledged
+  publish an API list only when it carries the writes this session confirmed
+  a failed read keeps the held list and marks it stale
```

### Comment edits submit themselves

```diff
 on(editComment(key, text))
   write the shared draft, so both editors show the text at once
+  request a save 1s after the last keystroke, and at most 10s after the first unsaved change
+  submit the latest text on blur, Mod+Enter, Escape, or when the last pane closes
+  run one request per Annotation; text typed during a request replaces the queued value
+  a read never discards a draft: an equal remote value drops it, a different baseline asks the user
+  a confirmed delete removes the card, the Mark, the draft, and the queued save
```

### A link lands on its Mark

```diff
 the fileLink an Annotation renders
- [[paper.pdf#page=4]]
+ [[paper.pdf#page=4&zt-annotation=KEY]]

 on(open a link that carries an Anchor)
   Obsidian's own #page=N jump fires first, as it always did
+  the leaf patch holds the Anchor; the PDF binding drains it on file-open
+  decideMarkLanding(anchor, attachment, read, records, marks, rendered)
+    the Annotation's own page wins over the page in the link
+    select the Mark when its page is rendered, wait for the page, else stay on the page
+  a miss degrades to the page in silence, with a debug reason and no notice
```

The default annotation templates now render the page label as that link, in both Eta and Liquid. The notes a user already made keep a stale region until Update Note rewrites it, and the Fixture seeds one such note.

### Where the work sits

```diff
 apps/obsidian/
 ├── src/services/
 │   ├── annotation-repository/       # held list, shared drafts, write path, capability
 │   ├── database/read-source.ts      # + committed snapshots: fingerprinted main file and WAL
+│   ├── attachment-open/capture.ts   # File Link Capture: a link click reaches Obsidian's reader
-│   └── pdf-annotation-editor/       # tools, popups, marks
+│   └── pdf-annotation-editor/
+│       ├── mark-landing.ts          # which Mark an Anchor lands on, from data alone
+│       ├── anchor-capture.ts        # the Anchor a link carries
+│       ├── rect-union-outline.ts    # a Mark's silhouette, traced round its rects
+│       └── free-text-layout.ts      # a free-text note's box and text run
+├── src/lib/editor-scope.ts          # Mod+Enter through Obsidian's own Scope
+├── src/setting-tab/reader.ts        # the new Reader settings page
 ├── src/views/annot-view/
+│   ├── menus.ts                     # Follow Mode and pane menus, built on Obsidian's Menu
 │   ├── card-controls.ts             # which card verbs run, as data
-│   └── view.test.ts, view.follow-mode.test.ts, pane-menu.test.ts, actions.test.ts
+│   └── policies/ui-testing.md       # view verification moves to the Paired Run
+├── docs/adr/0044..0048              # primitives, capture, landing, reading/editing, drafts
+└── components/obsidian/menu.tsx     # deleted: the plugin's own menu
+packages/db/src/lib/zt-annot-anchor.ts  # the Anchor's one spelling, written and read
 apps/zotero/src/menus/item.ts          # + the ZotLit submenu stands down when all its entries hide
```

The database layer keeps a path for both supported schemas: `clientVersion` and a Library's revision are read where Zotero userdata 129 has them, and the older query stands in on userdata 125.

### The surfaces use Obsidian's own primitives

```diff
 <PdfViewBinding>   (services/pdf-annotation-editor/binding.ts)
   <CreationToolbar>       # one toggle per tool, each with its own colour
   <CreatePopup>
   <MarkPopup>
+  <CommentEditor>         # Mod+Enter registered through Obsidian's Scope
 <AnnotView>        (views/annot-view/AnnotView.tsx)
   <SidebarToolbar>
   <CapabilitySlot>        # one "enable editing" action, or nothing while editing works
   <FilterBar>
   <Annotation>            # the card
-    <MenuContainer>       # the plugin's own menu, deleted
+    <icon-button row>     # the card's verbs
+    <conflict panel>      # both values, with the verbs that resolve them
```

### What proves it

```text
docs/research/continuous-annotation-acceptance.md       # 28 paired tests and 18 standalone tests
docs/research/zotero-database-snapshot-verification.md  # a committed snapshot, and the Zotero 9 path
docs/research/annotation-source-handoff-verification.md # Local API loss, handoff, and recovery
docs/research/annotation-write-outcome-verification.md  # acknowledged, lost, and unconfirmed writes
docs/research/shared-annotation-comment-verification.md # one draft, two editors, autosave timing
docs/research/native-annotation-concurrency.md          # the races that stay open
```

The Fixture seeds the journeys these run: a tagged and an untagged annotation PDF, a multi-line highlight, a stale note region, and a profile that already holds the Local API write grant.
