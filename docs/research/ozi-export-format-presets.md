# OZI export-format presets, evaluated from first principles

Research note for [issue #840](https://github.com/aidenlx/zotlit/issues/840).
Part of the wayfinder map [#835](https://github.com/aidenlx/zotlit/issues/835).
Investigated 2026-08-25 on branch `research/ozi-export-presets`.

Two primary sources are used. Read the citations as `path:line`.

| Source | Location | Version |
| --- | --- | --- |
| Obsidian Zotero Integration (OZI) | read-only checkout at `/Users/aidenlx/repo/zotlit-repo/obsidian-zotero-integration`, commit `2043211d` | `manifest.json` reports `3.2.1` |
| ZotLit v2 | this repository, commit `0f892c6e` | v2.1 |

OZI paths in this note start with `ozi/`. ZotLit paths are repo-relative.
The ZotLit ground truth is the note/content pipeline study for
[issue #836](https://github.com/aidenlx/zotlit/issues/836), on branch
`research/note-content-pipeline`.

---

## Verdict

An OZI preset is not one concept. It is a **bundle of five configuration
values that share one name**, and the name is also a command id
(`ozi/src/types.ts:47-60`, `ozi/src/main.ts:192-196`).

Three of the five values already exist in ZotLit v2, but ZotLit holds each of
them in a **global** setting or in a **globally named** template. So the real
question is not "is a preset good?". The real question is:

> Which of these values must become **per-configuration** instead of
> **per-vault**, and does the user get a container for them?

The answer from the code is: **one part earns adoption in an adapted shape**
(the named bundle, as a Literature Note Profile), **two parts earn adaptation**
(the output-path template and the per-bundle CSL style), and **two parts are
declined** (the per-preset command, and the template path as a free vault
path).

The strongest single lesson is not in the preset model at all. It is in what
OZI **removed** from the preset: the header / annotation / footer template
trio. OZI deprecated three configuration-level template slots and replaced them
with one template that composes itself with `{% include %}` and `{% persist %}`
(`ozi/docs/Templating.md:1-11`, `ozi/src/settings/ExportFormatSettings.tsx:200-297`).
That is direct evidence for the map's destination: **composition belongs in the
template, not in the configuration object.**

---

## 1. What a preset bundles

### 1.1 The record

```ts
// ozi/src/types.ts:47-60
export interface ExportFormat {
  name: string;
  outputPathTemplate: string;
  imageOutputPathTemplate: string;
  imageBaseNameTemplate: string;

  templatePath?: string;
  cslStyle?: string;

  // Deprecated
  headerTemplatePath?: string;
  annotationTemplatePath?: string;
  footerTemplatePath?: string;
}
```

The plugin holds an array of these records in one setting,
`exportFormats` (`ozi/src/types.ts:81`). The array is empty on a new install
(`ozi/src/main.ts:38`).

### 1.2 What each part does, and what it buys the user

| Part | Mechanism | What it buys |
| --- | --- | --- |
| `name` | Becomes the command id and the command name (`ozi/src/main.ts:194-195`). Also the lookup key for the scripting API (`ozi/src/main.ts:219`) | One word that identifies a whole output configuration. The user can say "run my Book import" |
| `outputPathTemplate` | Rendered with Nunjucks, then sanitized and normalized (`ozi/src/bbt/export.ts:663-675`) | The file path is computed from item data. One preset can write to `Books/{{citekey}}.md` and another to `Papers/{{citekey}}.md` |
| `imageOutputPathTemplate` | Rendered the same way; becomes the folder for extracted images (`ozi/src/bbt/export.ts:704-718`) | Image assets follow the note, per configuration |
| `imageBaseNameTemplate` | Rendered the same way; becomes the image file-name stem (`ozi/src/bbt/export.ts:720-730`) | Stable, readable image names |
| `templatePath` | A vault path. The file is read at render time (`ozi/src/bbt/template.helpers.ts:22-33`) and rendered once for the whole note (`ozi/src/bbt/export.ts:412-438`) | One file the user can copy from the community and paste into the vault |
| `cslStyle` | Passed to the Better BibTeX JSON-RPC call that builds `item.bibliography` (`ozi/src/bbt/export.ts:623`, `:316`) | A different bibliography style per configuration |
| Deprecated trio | Loaded only when `templatePath` is empty (`ozi/src/bbt/template.helpers.ts:22-49`), then rendered and concatenated by the host (`ozi/src/bbt/export.ts:440-538`) | Nothing new. It is legacy composition, kept for compatibility |

### 1.3 The four claims made for the preset model

**Claim 1 — mental model.** The user learns one sentence: "an import format
produces my note". The evidence supports this. The whole chain from command to
file is one record plus one template file, and the settings panel shows the
five fields together (`ozi/src/settings/ExportFormatSettings.tsx:90-198`).

**Claim 2 — shareability as one copyable unit.** The evidence does **not**
support this. Only `templatePath` points at a copyable file. The four other
values live in `data.json`, and the community shares the template file, not the
preset. The plugin has no export, import, or share action for a preset. So the
copyable unit in practice is the **template**, not the preset.

**Claim 3 — per-preset commands.** Each preset registers one command
(`ozi/src/main.ts:82-84`, `:192-210`). This is real value: the user gets a
palette entry and a hotkey per configuration.

**Claim 4 — previewability as a unit.** The Data Explorer has a
"Preview Import Format" dropdown that renders the selected preset against a
real item (`ozi/src/DataExplorerView.tsx:176-198`, `:102-139`). The preset is
the unit the preview names. This is the strongest argument in the code for the
preset as a first-class object.

### 1.4 What the preset does **not** hold

A preset run reads many values from global settings, which the preset does not
name:

| Global value | Read at | Effect on preset output |
| --- | --- | --- |
| `shouldConcat` | `ozi/src/bbt/export.ts:749-751`, `:777-779` | Merges annotations that start with `+` |
| `pdfExportImageDPI`, `…Format`, `…Quality`, `…OCR`, `…OCRLang`, `…TesseractPath`, `…TessDataDir` | `ozi/src/bbt/export.ts:753-769` | Image resolution, format, and OCR text |
| `exeOverridePath` | `ozi/src/bbt/export.ts:768` | Which extractor binary runs |
| `openNoteAfterImport`, `whichNotesToOpenAfterImport` | `ozi/src/main.ts:242-264` | What opens after the import |
| `database`, `port` | `ozi/src/main.ts:197-200` | Which Zotero the data comes from |

So the bundle is not complete. Two users with the same preset record and the
same template file can get different files.

---

## 2. The same jobs in ZotLit v2

### 2.1 Part-by-part mapping

| OZI preset part | ZotLit v2 equivalent | Scope in ZotLit | Overlap / gap |
| --- | --- | --- | --- |
| `name` | none | — | **Gap.** ZotLit has no named output configuration. The six template names are a fixed registry (`apps/obsidian/src/services/template/defaults.ts:58-64`) |
| `outputPathTemplate` | `filename` template plus the `note.literature-folder` setting | Template is global by name; folder is one global string (`apps/obsidian/src/services/settings/schema.ts:104`, default `:161`) | **Partial overlap.** ZotLit splits one OZI value across two mechanisms. ZotLit is stronger on collisions: the `filename` template carries `{% suffix %}` (`packages/templates/defaults/filename.liquid:1`) and the resolver can retry with a suffix (`apps/obsidian/src/services/note-feature/context.ts:113-128`). OZI has no collision concept; it writes to the computed path and overwrites |
| `imageOutputPathTemplate`, `imageBaseNameTemplate` | `attachment.folder-path` setting plus the attachment-import service | One global nullable string (`apps/obsidian/src/services/settings/schema.ts:128`) | **Overlap, lower power.** ZotLit has no per-configuration image path |
| `templatePath` | the `note` template, plus its include of `content` and `annotation` | Resolved by **name** from `template.folder` (`apps/obsidian/src/services/settings/schema.ts:114`; path built at `apps/obsidian/src/services/template/defaults.ts:90-99`) | **Conflict.** OZI addresses a template by free path; ZotLit addresses it by fixed name. Only one `note` template can exist per vault |
| `cslStyle` | `citation.references-style`, with `citation.locale` | Global (`apps/obsidian/src/services/settings/schema.ts:91`, `:96`) | **Gap.** ZotLit cannot use one style for a law library and another for a science library |
| Deprecated trio | `note` + `content` + `annotation` | Template names, composed by `{% render %}` inside the templates | **Not the same.** See 2.3. This is the most important row |

### 2.2 What ZotLit already does better

- **Zero-config path.** OZI starts with an empty `exportFormats` array
  (`ozi/src/main.ts:38`), so a new user has **no import command at all** until
  they build a preset and author or copy a template. ZotLit ships built-in
  templates for all six names (`apps/obsidian/src/services/template/defaults.ts:67-84`)
  and a working note on first use.
- **Safe update.** OZI rewrites the whole file on every import
  (`ozi/src/bbt/export.ts:813-818`) and gives the user `{% persist %}` to carve
  out islands that survive (`ozi/src/bbt/template.env.ts:148-203`,
  `ozi/docs/Templating.md:116-176`). ZotLit does the opposite: it replaces only
  the marked region and keeps everything else
  (`packages/templates/src/obsidian.ts:50-63`). The ZotLit default is safe; the
  OZI default is destructive.
- **Update scope.** ZotLit has four flows, and two of them refresh frontmatter
  without touching the body (`packages/protocol/src/url.ts:49`; sites at
  `apps/obsidian/src/services/note-feature/operations.ts:311`, `:443`, `:477`,
  and `context.ts:120`). OZI has one flow.
- **Structural frontmatter.** ZotLit merges frontmatter key by key with three
  strategies (`packages/templates/src/frontmatter-merge.ts:35-51`). In OZI,
  frontmatter is plain template text inside the rewritten file.

### 2.3 The trio is the key comparison

At first sight the OZI deprecated trio and the ZotLit trio look the same:

```
OZI (deprecated)                    ZotLit v2
headerTemplatePath   -> config      note        -> template name
annotationTemplatePath -> config    content     -> template name
footerTemplatePath   -> config      annotation  -> template name
```

They are not the same, and the difference decides the recommendation.

- In OZI, the three parts were **three configuration fields**. The host loaded
  three files and joined the three outputs in a fixed order
  (`ozi/src/bbt/export.ts:520-537`). The user could not change the order, could
  not put text between the parts, and could not reuse a part.
- In ZotLit, the three parts are **three template names in one include graph**.
  `note` includes `content` with an ordinary tag
  (`packages/templates/defaults/note.liquid:5`), and `content` includes
  `annotation` once per annotation (`packages/templates/defaults/content.liquid:12`).
  The user controls the order and the surrounding text by editing the template.

OZI's fix for its trio was to give the template two powers — file include by
wikilink (`ozi/src/bbt/template.env.ts:205-268`, `ozi/docs/Templating.md:178-192`)
and a named persistent region (`{% persist %}`) — and then to delete the
configuration fields. The migration recipe is three lines
(`ozi/docs/Templating.md:5-11`).

**ZotLit already has the include half.** ZotLit does not have the "region
declared inside the template" half; its region is host policy on one line
(`apps/obsidian/src/services/template/service.ts:127`). The map's #836 ground
truth records the same fact.

---

## 3. Presets against "one primary authoring object"

The map's destination is a single primary authoring object called the
Literature Note. Three readings of a preset are possible.

### 3.1 Reading A — the preset is the natural container

Under this reading, a ZotLit preset holds everything that decides what a
Literature Note looks like: the body template, the file-name rule, the folder,
the frontmatter fields, and the CSL style. The user edits one object. This is
exactly the "one sentence" that the map asks for.

Evidence in favor: OZI's preview dropdown already treats the preset as the
render unit (`ozi/src/DataExplorerView.tsx:176-198`), and ZotLit's Data
Explorer already treats `note` and `content` as one data root
(`packages/db/src/contract/roots.ts:21-26`).

Evidence against: nothing in ZotLit is per-preset today. Adopting Reading A
means moving four global settings into a per-preset record and deciding what a
note that already exists belongs to.

### 3.2 Reading B — the preset is a parallel feature

Under this reading, the Literature Note stays one object, and a preset is an
optional second axis: "the same note object, applied with a different folder
and style". This keeps the beginner path at one object and gives the advanced
user a way to separate a Book workflow from a Paper workflow.

This reading is compatible with the code as it stands. The template registry
stays global; only the **bindings** (folder, style, frontmatter set) become
selectable.

### 3.3 Reading C — the preset is a complication

Under this reading, presets multiply the objects the user must understand, and
the same result is available inside one template with a conditional:

```liquid
{% if zt.itemType == "book" %}…{% else %}…{% endif %}
```

ZotLit's Liquid engine supports this, and the item data is one tree. Under
Reading C, a preset adds a second dispatch mechanism that does the same job as
an `if`, and the user must then learn which of the two to use.

### 3.4 What the code says

The deciding fact is **destination and identity**, not appearance.

A conditional inside one template can change the **text** of a note. It cannot
change:

1. the folder the note goes into, because the folder is read before the render
   (`apps/obsidian/src/services/note-feature/context.ts:113`);
2. the CSL style used to build `zt.bibliography`, because the style is chosen
   before the data is fetched (in OZI at `ozi/src/bbt/export.ts:623`; in ZotLit
   the style is a global setting);
3. the frontmatter field list, because that list lives in settings and is
   evaluated outside the template (`apps/obsidian/src/services/settings/schema.ts:105`).

So Reading C is wrong for those three values and right for everything else.
**Reading B is the shape the code supports.** A preset is worth having exactly
for the values that a template cannot reach, and it must not become a second
way to do what an `if` already does.

One more constraint: the Literature Note is **identified by `zotero-key` in the
frontmatter**, and the reserved keys are fixed
(`apps/obsidian/src/lib/constants.ts:68-72`). If two presets can both produce a
note for the same item, ZotLit must decide whether an item has one note or many.
OZI never had to answer this, because its notes are only files at a computed
path. This is the single largest new question a preset brings to ZotLit.

---

## 4. Failure modes visible in OZI

### 4.1 The deprecated trio

The three legacy fields still exist in the type
(`ozi/src/types.ts:56-59`), in the loader
(`ozi/src/bbt/template.helpers.ts:22-49`), in the renderer as a second code
path of about 100 lines (`ozi/src/bbt/export.ts:440-538`), and in the settings
UI as three conditional blocks with a "Remove Template" button
(`ozi/src/settings/ExportFormatSettings.tsx:200-297`).

The lesson: **a preset field is forever.** A configuration key that reaches
`data.json` cannot be removed while any user still has it. Every field that a
ZotLit preset gains is a permanent migration liability. This argues for the
smallest possible preset record.

A second lesson is in the fallback rule. `getTemplates` prefers `templatePath`
and falls back to the trio only when all three legacy paths are empty
(`ozi/src/bbt/template.helpers.ts:24-33`). Fallback chains inside a preset are
how a preset stops being readable.

### 4.2 Preset sprawl

- New presets are named `Import #1`, `Import #2`, and so on
  (`ozi/src/settings/settings.tsx:92-101`). Nothing checks that names are
  unique.
- The name is the command id (`ozi/src/main.ts:194`). Two presets with the same
  name collide in the command palette, and `runImport` returns the first match
  (`ozi/src/main.ts:219`).
- The name is also the **hotkey** id. Every debounced keystroke in the name
  field removes the old command and adds a new one
  (`ozi/src/settings/settings.tsx:524-531`). Renaming a preset therefore
  destroys its hotkey, and typing a name creates a trail of transient commands.
- The settings panel is a flat unpaginated list of full-height forms
  (`ozi/src/settings/settings.tsx:249-259`). Ten presets means ten seven-field
  forms in one scroll.

The lesson: **do not derive an identifier from a user-editable display name.**
If ZotLit adopts a named bundle, the bundle needs a stable id and a separate
label.

### 4.3 Hidden coupling to global settings

Section 1.4 lists the global values a preset run reads. One case is a visible
defect:

```ts
// ozi/src/bbt/export.ts:873-885
function getAStyle(settings: ZoteroConnectorSettings) {
  const exportStyle = settings.exportFormats.find((f) => !!f.cslStyle);
  if (exportStyle) return exportStyle.cslStyle;
  const citeStyle = settings.citeFormats.find((f) => !!f.cslStyle);
  if (citeStyle) return citeStyle.cslStyle;
}
```

The Data Explorer builds its item data with `getAStyle`
(`ozi/src/bbt/export.ts:903`) — that is, with the **first** preset that has any
style. The preview then renders the **selected** preset against that data
(`ozi/src/DataExplorerView.tsx:102-130`). So the `bibliography` value shown in
the preview belongs to a different preset than the template being previewed.
The preview can disagree with the real import.

The lesson: **a preview is only trustworthy when it takes every input from the
same object the user selected.** ZotLit's Workbench is side-effect free today,
and any preset work must keep the preview's inputs and the import's inputs
identical.

### 4.4 The output path has no identity

OZI computes a path and writes it (`ozi/src/bbt/export.ts:813-818`). If two
items render the same path, the second import silently overwrites the first.
ZotLit avoids this with `{% suffix %}` and a retry
(`packages/templates/defaults/filename.liquid:1`,
`apps/obsidian/src/services/note-feature/context.ts:113-128`). Any per-preset
output path in ZotLit must keep the suffix and collision behavior.

---

## 5. Recommendation, per part

The scores use the map's criteria. `+` means the part helps that criterion,
`-` means it hurts it, `o` means no effect.

| Part | Verdict | Mental model | Predictability | Shareability | Previewability | Impl. cost |
| --- | --- | --- | --- | --- | --- | --- |
| Named bundle | **Adapt** | + | + | + | + | medium |
| Output path as a template | **Adapt** | + | o | + | o | low |
| Per-bundle CSL style | **Adapt** | o | + | + | + | low |
| Image path / base name | **Decline for now** | - | o | o | o | low |
| Template as a free vault path | **Decline** | - | - | + | o | high |
| Per-preset command | **Decline** | o | - | o | o | low |
| Deprecated trio | **Decline** | - | - | - | - | — |

A direct port is ruled out by premise. Each "adopt" below names its adapted
shape.

### 5.1 Named bundle — **adapt**, as a Literature Note Profile

**Adapted shape.** A Profile is a small record with a stable id and a separate
display label. It holds only the values a template cannot reach:

```
Profile
  id                (stable, never derived from the label)
  label             (user-editable, display only)
  literatureFolder  (string; today's `note.literature-folder`)
  citationStyle     (CSL id + locale; today's `citation.references-style`)
  frontmatterFields (today's `note.frontmatter-fields`)
```

Templates stay outside the Profile and stay addressed by name. See 5.5.

**Why it earns adoption.** It is exactly the map's "one primary authoring
object", made addressable. It gives the Workbench and the Data Explorer one
name to render against, which fixes the previewability criterion at the same
time. It also gives the shareability criterion an answer that OZI never had:
the Profile is a small JSON record that can be copied whole, and it names the
templates it needs.

**What must be decided before it ships.** One item, one note, or one item, many
notes? Section 3.4 names this as the open question. Recommend: **one Profile is
the default; a second Profile is an explicit choice, and the note records which
Profile made it.**

**Vault settings default.** Do **not** ship more than one Profile out of the
box. The zero-config path must stay at zero objects, and a beginner must never
see the word "profile".

### 5.2 Output path as a template — **adapt**, by widening `filename`

**Adapted shape.** Keep one template. Let the `filename` template render a
path with `/` separators, resolved relative to the Profile's folder. Keep
`{% suffix %}` and the collision retry unchanged.

**Why.** ZotLit already renders a name from item data; only the folder segment
is missing. This is one relaxation in `resolveRenderedRelPath`
(`apps/obsidian/src/services/note-feature/context.ts:113-128`), not a new
configuration field. It buys the same power as OZI's `outputPathTemplate`
without adding a field to the record.

**Risk to control.** A rendered path can escape the vault or the folder.
Sanitize as OZI does (`ozi/src/bbt/export.ts:663-675`) and keep the result
inside the Profile folder.

### 5.3 Per-bundle CSL style — **adapt**, as a Profile field

**Adapted shape.** `citationStyle` moves from a global setting into the
Profile, and the global setting becomes the default that a Profile inherits
when its own field is empty.

**Why.** This is a real gap; a template cannot reach it, because the style is
consumed before the data reaches the template. The failure in 4.3 shows what
happens when the style resolution is not tied to the selected object, so the
Profile's style must be the **only** style the render and the preview use.

### 5.4 Image output path and base name — **decline for now**

ZotLit's attachment import is one global folder
(`apps/obsidian/src/services/settings/schema.ts:128`). No evidence in this
study shows a user need for a per-Profile image path. Section 4.1 says every
field is permanent. Leave the field out until a request names the use.

### 5.5 Template as a free vault path — **decline**

OZI points a preset at any markdown file. ZotLit resolves a template by name
from one folder, and the language lives in the extension
(`apps/obsidian/src/services/template/defaults.ts:90-99`).

**Why decline.** Free paths would break the eject model. The eject flow's whole
contract is "no file means the built-in default, delete the file to restore it"
(`apps/obsidian/src/setting-tab/templates.ts:370-385`). A path field has no
"absent" state that means "use the built-in", and a broken path is a silent
failure — OZI shows a notice and renders nothing
(`ozi/src/bbt/template.helpers.ts:14-17`).

**The adapted alternative, if per-Profile templates are wanted later.** Keep
name resolution and add a Profile-scoped prefix: a Profile named `book` looks
for `zotlit-note@book.liquid.md` first, then falls back to `zotlit-note`. This
keeps the "absent means default" contract at every level and needs no new path
field.

### 5.6 Per-preset command — **decline**

OZI registers one command per preset. ZotLit should register **one** command
and let it ask which Profile, in the same way the item picker already asks
which item.

**Why.** 4.2 shows the cost: the command id is the display name, so renaming
destroys hotkeys and typing creates transient commands. The benefit — a hotkey
per configuration — is real but small, and Obsidian users can reach the same
result with a note-level default. If a per-Profile command is added later, it
must key on the Profile **id**, never on the label.

### 5.7 The deprecated trio — **decline, and read it as a warning**

Do not add configuration fields that name parts of a note body. ZotLit's
`note` / `content` / `annotation` names are already the better version of this
idea, because they compose inside the template. The map's real target is the
remaining gap that OZI closed and ZotLit has not: **the managed region is
declared by host policy, not by the template.** OZI's `{% persist "name" %}`
shows one working shape for a template-declared region
(`ozi/src/bbt/template.env.ts:170-183`). That belongs to the map's candidate
sketches, not to the preset question.

---

## 6. Input for the final grilling ticket

Five points, ordered by how much they change the decision.

1. **A Profile is a container for bindings, not for the note body.** The body
   is templates; the Profile is folder, style, and frontmatter set. If the
   decision puts the body inside the Profile, it repeats the trio mistake at a
   larger scale.
2. **Identity is the unresolved question.** ZotLit notes are keyed by
   `zotero-key`. Two Profiles that can both produce a note for one item change
   what a Literature Note is. Decide this before any Profile field is named.
3. **The preview must consume the same object as the import.** OZI's preview
   does not (4.3). ZotLit's Workbench is currently correct, and a Profile is
   the natural argument to pass to it.
4. **Do not derive an id from a label.** Every OZI preset failure in 4.2 has
   this one root cause.
5. **The zero-config path must stay at zero objects.** A beginner must reach a
   good note without meeting the word "profile". OZI has no zero-config path at
   all (`ozi/src/main.ts:38`), and that is its clearest weakness against
   ZotLit.

This note is briefing input. The decision belongs to the map's final grilling
ticket.
