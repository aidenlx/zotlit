# The Template Pack envelope and its install lifecycle

Research note for [issue #842](https://github.com/aidenlx/zotlit/issues/842).
Part of the wayfinder map [#835](https://github.com/aidenlx/zotlit/issues/835).
Drafted 2026-08-25 on branch `research/template-pack-envelope`.

The primary source is the code in this repository at commit `0f892c6eb`. Line
citations are repo-relative. Read them as `path:line`.

This note is a draft of an envelope, not a decision. It stays
candidate-agnostic: it does not assume which simplification approach #837
shortlists, and it does not assume the note-identity answer that #841 still
owes. Where identity changes the result, the note states both branches.

## Method

| Item | Value |
| --- | --- |
| Repository | `aidenlx/zotlit`, worktree at commit `0f892c6eb`, plugin version `2.1.0` (`apps/obsidian/package.json:3`) |
| Code read | `packages/templates/src/`, `packages/db/src/contract/`, `apps/obsidian/src/services/{template,template-workbench,note-feature,settings}/`, `apps/obsidian/src/setting-tab/templates.ts`, `apps/obsidian/src/lib/constants.ts` |
| Design records read | ADR 0004, ADR 0012, ADR 0015, ADR 0018, ADR 0019 |
| Prior findings used | #836 (`research/note-content-pipeline`), #840 (`research/ozi-export-presets`) |

No code was changed and no test was run.

---

## Verdict

One rule decides almost every field in this envelope:

> **A Pack may carry values whose schema ZotLit already owns. A Pack may not
> invent a schema of its own.**

That rule admits the managed-frontmatter field list and the Profile bindings,
because both records already exist and are already validated
(`packages/templates/src/constants.ts:42-47`,
`apps/obsidian/src/services/settings/schema.ts:104-117`). The same rule
declines optional parameters, a capability list, and a Pack-level merge
strategy, because each one is a new vocabulary that the plugin must then
interpret, migrate, and keep forever. This is the #840 lesson applied: every
configuration field is a permanent migration liability, so the record must be
the smallest one that works.

Two structural facts constrain the rest.

1. **The template folder is one flat namespace keyed by file name.** The
   rebuild scans `root.children` only, with no recursion, and takes the name
   from the file name grammar `zotlit-<name>.(liquid|eta).md`
   (`apps/obsidian/src/services/template/service.ts:562-580`,
   `apps/obsidian/src/services/template/defaults.ts:48-50`). A Pack therefore
   cannot be a subfolder. A Pack is an **overlay onto one shared namespace**.
2. **The absent file is the "use the built-in default" state.** When no vault
   file exists for a canonical name, the service registers the embedded default
   (`service.ts:761-780`). Reset and delete are cheap only because the plugin
   always knows what "no customization" means. A Pack that only copies files
   into the folder destroys this: after the copy, "delete the file" no longer
   returns the user to the Pack.

From those two facts: **a Pack install is a recorded, reversible, bulk eject.**
The vault keeps holding the same flat template files, because that is what the
watcher, the setting rows, the include resolver, and the Workbench all read.
The Pack is the transaction and the record of the transaction. It is not a new
storage format, and it needs no renderer change.

---

## 1. What varies between two users, and where it lives today

A literature note's appearance comes from three stores. Only one of them is
shareable now.

| Store | Holds | Shareable today |
| --- | --- | --- |
| Vault files under `template.folder` | the six template bodies plus any user partial (`service.ts:562-580`) | yes, by copying files |
| `data.json` settings | `note.frontmatter-fields`, `note.literature-folder`, `citation.references-style` (`settings/schema.ts:104-117`, `:90`) | no |
| Per-device `localStorage` | the JavaScript Templates consent flag (`service.ts:47-48`, `:166-167`) | no, and by design (ADR 0004) |

The map scores shareability by one test: can a user share a **complete**
Literature Note configuration with no hidden external setting? Today the answer
is no, because no template writes frontmatter. The host writes it, from a
setting list, outside every template (`services/note-feature/operations.ts:311-313`).

So the Pack has exactly one job at the data level: **make store 1 and the
note-shaped part of store 2 travel together, and make store 3 an install-time
consent check that can never travel.**

### 1.1 Non-canonical names already work

`templateFileFromPath` accepts any name that matches `[A-Za-z0-9-]+`
(`defaults.ts:48-50`, `:100-108`), the folder rebuild registers every name it
finds (`service.ts:568-580`), and `#useDefault` removes a non-canonical name
when its file disappears (`service.ts:761-767`). Includes resolve by bare name
through the facade (`packages/templates/src/facade.ts:262-329`).

Two consequences for the envelope:

- A Pack may ship partials, not only the six canonical names. The payload shape
  must allow it.
- A partial name is claimed **globally**. Two Packs that both ship `header`
  collide. Section 6 treats this as a first-class failure mode.

---

## 2. Manifest fields, judged

Each candidate field gets one of three verdicts.

- **Envelope** — the field belongs in the manifest, and its meaning does not
  depend on which candidate #837 picks.
- **Payload** — the value is real, but its shape is what a candidate defines.
  Out of scope for this note.
- **Declined** — the field does not earn its permanent cost.

### 2.1 The table

| Candidate field | Verdict | Reason in one line |
| --- | --- | --- |
| `name` | **Envelope**, as two fields | Split into a stable `id` and an editable display `name`; #840 §4.2 records what happens when an id is derived from a label |
| `author` | **Envelope** | One free-text string plus an optional URL. It is the trust signal at the consent moment, and it has no runtime meaning |
| `version` | **Envelope** | Update, diff, and revert all compare an installed record against a candidate record. None of them work without it |
| ZotLit compatibility range | **Envelope**, but as the **data contract**, not the plugin version | `CONTRACT_VERSION` already versions the `zt` shape (`packages/db/src/contract/roots.ts:8`). A plugin semver range goes stale on every unrelated release |
| Templates overridden | **Envelope** for the name list; **payload** for the bodies | The installer needs the names before it reads any body, to diff, to detect collisions, and to know what uninstall owns |
| Managed-frontmatter definitions | **Envelope**, optional | No template can produce them (`operations.ts:311-313`). Without them, "share a complete configuration" fails by construction |
| Merge strategies | **Declined** as a Pack-level field | `merge` is already a property of each frontmatter field (`constants.ts:45`). A second axis needs a resolution rule forever |
| Template-engine requirement | **Declined** as a declared field; **derived** by the installer | The language is recorded only in the file extension (`defaults.ts:48-50`). A declared field can disagree with the payload; a derived one cannot |
| Advanced capabilities / permissions | **Declined** | ZotLit has one privilege boundary and it is binary. A permission the runtime does not enforce reads as a safety guarantee that does not exist |
| Optional parameters | **Declined** | This is OZI's deprecated trio in a new shape. Composition belongs in the template (#840). The one real need has a home: see §4 |
| Preview metadata | **Envelope** for one `description`; **declined** for the rest | Catalogue text belongs to the directory. An installed record that carries it bumps its version for a listing edit |
| Sample screenshots / example output | **Declined**, with one small replacement | A screenshot is a claim. The Workbench renders the real thing against a real item (`services/template-workbench/cli.ts:307-352`). Ship a `sampleItemType` string instead |

### 2.2 The resulting envelope

```jsonc
{
  "id": "aidenlx.apa-literature-note",   // stable; never derived from `name`
  "name": "APA literature note",          // display label; editable; never an id
  "version": "1.2.0",
  "author": "aidenlx",
  "homepage": "https://…",                // optional
  "description": "One or two sentences.",
  "contract": 2,                          // the `zt` data contract, not plugin semver
  "minAppVersion": "2.3.0",               // optional escape hatch only
  "templates": [
    { "name": "note", "language": "liquid" },
    { "name": "content", "language": "liquid" },
    { "name": "apa-header", "language": "liquid" }
  ],
  "frontmatter": [
    { "key": "title", "expr": "zt.title", "merge": "replace", "language": "liquid" }
  ],
  "profileDefaults": { "folder": "literatures", "citationStyle": "apa" },
  "sampleItemType": "journalArticle"      // optional; picks the preview item
}
```

The template bodies live beside the manifest and are addressed by the
`templates` list. **What a body contains is payload.** If #837 picks a unified
template, the list holds one name. If it picks the current split, the list
holds two. The envelope does not change either way.

### 2.3 The kept fields, in detail

**`id` and `name` are two fields, not one.** #840 §4.2 recorded the exact
failure: OZI uses the display name as the command id, so a rename destroys the
hotkey, every debounced keystroke registers a transient command
(`ozi/src/settings/settings.tsx:524-531`), and a duplicate name resolves to
whichever record comes first (`ozi/src/main.ts:219`). ZotLit must not repeat
this. The `id` is stable, is the key of the install record, and is never shown
as an editable field. The `name` is a label and may be localized later.

**`contract`, not a plugin-version range.** The value a Pack really depends on
is the shape of `zt`. That shape is versioned already: `CONTRACT_VERSION = 2`,
stamped in every generated schema `$id` (`packages/db/src/contract/roots.ts:3-8`),
and one schema file per root ships as a release asset of the plugin version
that emitted it (`services/template-workbench/schema.ts:28-46`, ADR 0019).
A Pack declares the contract it was written against. ZotLit accepts it when it
can still serve that contract.

A plugin-version range would be worse in both directions. Too narrow, and every
patch release breaks every Pack in the directory. Too wide, and it says
nothing. `minAppVersion` stays available for the rare Pack that needs a genuinely
new feature, and it is absent by default. Obsidian's own manifest sets the
precedent for that field name.

Two limits to record. The contract number covers the `zt` data shape only. It
does not cover the Liquid dialect: an unknown filter is a render error, not a
contract error (`services/template-workbench/guide.ts:211`,
`packages/templates/src/liquid.ts:33-41`). Dialect drift surfaces at **preview**
time, not at install time. That is acceptable, and §3 relies on it.

**`templates` carries names and languages, not paths.** One entry per name, with
exactly one language. A Liquid file wins over an Eta file of the same name
(`service.ts:700-705`), so a Pack that shipped both editions of one name would
make the Eta one dead weight and would still trip the shadow warning
(`service.ts:664-675`, `setting-tab/templates.ts:246-254`). One language per
name removes the case.

**`frontmatter` reuses the record that already exists.** The shape is
`{ key, expr, merge, language }` with `merge` in `replace | append | keep` and
`language` in `liquid | javascript` (`packages/templates/src/constants.ts:23-47`).
Duplicate keys are already a schema error
(`services/settings/schema.ts:31-38`), and the three reserved keys are already
refused on the write path (`services/template-workbench/cli.ts:534-543`,
`lib/constants.ts:66-72`). The envelope adds no validation of its own. It
borrows all of it.

This block stays candidate-agnostic. If a candidate moves frontmatter authoring
into the unified template, the block becomes the **compiled output** of that
template instead of a hand-written list. The record shape does not change,
because the settings store does not change (`services/settings/schema.ts:105`).

### 2.4 The declined fields, and what each would cost forever

**Merge strategy as a Pack-level field.** `merge` already lives on the field
(`constants.ts:45`). A Pack-level default would create a second place to answer
the same question, plus a precedence rule between the two, plus a migration the
first time somebody wants to change the precedence. The cost is permanent and
the benefit is zero.

There *is* a real merge question, and it is not a Pack field: **how an install
merges the Pack's field list into the user's existing list.** That is install
policy. The diff shows it and the user approves it. See §3.

**Template-engine requirement as a declared field.** The installer computes it:
the union of the `templates` languages and the `frontmatter` languages. A
declared field can disagree with the payload, and then the plugin must decide
which one is true. A derived value cannot disagree. What the installer does
with the derived value is the important part: a Pack that contains any `eta`
template or any `javascript` expression cannot install on a device whose
JavaScript Templates gate is off. It is refused by name, not degraded
(`service.ts:677-698`, `cli.ts:694-701`; ADR 0004, amendment 2026-07-12).

**Capabilities and permissions.** ZotLit has exactly one privilege boundary: the
JavaScript Templates gate, per device, off by default, consented through a modal
(ADR 0004). There is no sandbox — ADR 0004 defers sandboxing and keeps the gate
as the seam. A capability list would therefore either restate one boolean, or
name powers that nothing checks. The second is worse than no list, because it
reads as enforcement. What a user needs at install is one honest derived
sentence: "this pack runs JavaScript". Cost if added: a capability vocabulary to
version, a UI to render it, and a permanent gap between what the manifest claims
and what the renderer verifies.

**Optional parameters.** This is the strongest decline, and #840 supplies the
evidence. OZI's header / annotation / footer trio was three configuration-level
template slots that the host joined in a fixed order. OZI deprecated it and gave
the template `{% include %}` and `{% persist %}` instead. ZotLit already has the
include half (`packages/templates/defaults/note.liquid:5`, `facade.ts:262-329`).
A parameter block is the same mistake in a new shape: configuration the template
must then branch on.

Cost if added: a parameter type system, a settings surface per installed Pack, a
persistence slot for each answered parameter, a migration path when a Pack
renames or removes a parameter, and a second place where "why does my note look
like this" can be answered. Liquid already answers the need with `{% if %}` and
`{% assign %}`, and a Pack that wants two shapes can be two Packs.

The one need that looks like a parameter is real: folder and citation style.
Those have a home already, and it is not a parameter block. See §4.

**Preview metadata beyond one description.** Tags, categories, and popularity
counters are directory-catalogue data. Put them in the catalogue, where editing
them costs nothing. Put them in the installed manifest, and a listing tweak
becomes a version bump that every installed copy sees as an update.

**Screenshots and example rendered output.** Two costs. Bytes in the vault
forever, and a stale artifact that contradicts the Pack after the first user
edit. And ZotLit does not need them: the Workbench renders any template against
a real Zotero item and returns the exact bytes, with no disk write
(`cli.ts:307-352`, `:221-228`). A screenshot is a claim; a live render is
evidence. The replacement is one string, `sampleItemType`, which tells the
preview which kind of item to render against.

---

## 3. The install lifecycle

### 3.1 The flow that exists

The setting tab renders one row per canonical name, and the row's buttons
change with the state of the vault file (`setting-tab/templates.ts:217-386`).

| Step | Action | Code |
| --- | --- | --- |
| **eject** | Create `zotlit-<name>.liquid.md` from the embedded Liquid default, then open it | `templates.ts:370-385`, `ejectAndRefresh` `:466-486` |
| **edit** | The watcher queues the name, debounces, and recompiles. No reload | `service.ts:596-615`, `:625-641`, `#reconcileName` `:651-732` |
| **reset** | Overwrite the file with the default of **its own edition** (Liquid or Eta) | `templates.ts:314-342`, `resetAndRefresh` `:488-508` |
| **delete** | Move the file to Obsidian's recoverable trash; the name falls back to the built-in | `templates.ts:343-369`, `deleteAndRefresh` `:510-524` |

Two details matter for the Pack.

- "Delete to restore the default" is implemented as `fileManager.trashFile`
  (`templates.ts:516`), so it is recoverable, not destructive. The Pack should
  keep that property for every removal it performs.
- "Eject all" skips a name when **either** extension already exists, so it never
  shadows a user's `.eta.md` (`templates.ts:528-535`). A bulk install must apply
  the same care, for the same reason.

### 3.2 preview → diff → apply → revert

**Preview.** Render the Pack against a real Zotero item and write nothing.
Two mechanisms already exist.

- `TemplateFacade` is a plain constructible class, and the managed-region
  behaviour is a constructor option, not a hard-coded rule
  (`packages/templates/src/facade.ts:88-95`;
  `packages/templates/src/obsidian.ts:9-23`, which names a second consumer that
  omits the transform). A throwaway facade seeded from the Pack renders the Pack
  without touching the live registry.
- The Workbench renders through the production path, including the real
  `renderFilename`, and returns either the exact bytes or an envelope with the
  active template identity and root-variable warnings
  (`cli.ts:221-228`, `:307-352`, `:829-847`).

One gap to name, because it is the only new plumbing the lifecycle needs:
`zotlit:template-render` renders the template that is **already installed**, by
slot name (`cli.ts:308-325`). Previewing an uninstalled Pack needs a
source-override seam — either a second facade seeded from the Pack, or a
`source=` parameter on the render command. Both are small, and both keep the
side-effect-free property that the map lists as a ZotLit strength.

**Diff.** The diff is against the **effective configuration**, not against
files. It has three parts.

1. *Per template name.* Compare the current winner
   (`getTemplateFileStatuses`, `service.ts:196-220`; the Workbench reports
   `winner.source.path` and `editablePath`, `guide.ts:151-156`) against what the
   Pack would make it. Three cases:
   - built-in default → Pack body: clean;
   - previous edition of the same Pack → new edition: an upgrade;
   - the user's own ejected file → Pack body: **this is the case that must be
     refused by default.**
2. *Frontmatter field list.* A key-by-key comparison of three lists: the user's
   current list, the previously installed Pack's list, and the new Pack's list.
   Additions, replacements, and removals are all shown. Reserved keys are
   refused (`cli.ts:534-543`). Duplicates are already a schema error
   (`settings/schema.ts:31-38`).
3. *Engine requirement against the device gate.* Derived, per §2.4.

**Apply.** One transaction that records what it did. Two rules make revert a
fact instead of a guess.

- Write a file only where the diff said the target was the built-in default or a
  previous edition of the same Pack.
- Store, per touched template name, the previous state — `built-in`, or a vault
  path plus a body hash, or a previous Pack `id` and `version` — and, per
  frontmatter key, the previous record.

The body hash is what later lets an update tell "unchanged since install" from
"the user edited this". Nothing in the folder carries that information today,
because the folder holds only files (`service.ts:562-580`).

**Revert.** Restore each name to the state the install record captured. Every
removal goes to Obsidian's recoverable trash, as delete already does
(`templates.ts:516`). The end state of a full revert is the **absent** state
again: no file for the names the Pack introduced, and the user's own file
untouched for every name the install refused to take.

### 3.3 Relation to eject, and the one semantic the Pack adds

A Pack install is a bulk, reversible, recorded eject. Eject writes one built-in
body to one path and opens it for editing. Install writes N Pack bodies to N
paths, records what each one replaced, and opens nothing.

After install, every existing button still works, and every one of them still
means the same thing, except one. **The row's reset currently writes ZotLit's
built-in default** (`templates.ts:496-500`). Once a Pack owns a name, reset must
write the **Pack's** body, while delete must still mean "back to the built-in".
Both flows already exist and only one can win the button. This is the single
user-visible semantic the Pack adds to the current model, and it should be
decided at the grilling rather than discovered during implementation.

---

## 4. Pack and Profile

#840 recommends a runtime **Literature Note Profile** that holds folder,
citation style, and the frontmatter field set — the three values a template
cannot reach, because each is read before or outside the render
(`services/note-feature/context.ts:113`, `settings/schema.ts:90`, `:105`).

**The answer: a Pack ships Profile defaults. A Profile is not the installed
instance of a Pack. The two are joined by one direction of dependency, and the
direction is install-time seeding only.**

### 4.1 Why not "the Profile is the installed instance"

The two objects have opposite life cycles.

| | Pack | Profile |
| --- | --- | --- |
| Authored by | someone else | the user |
| Mutability | immutable, versioned | mutable, unversioned |
| Identity | a stable `id` from the author | belongs to the vault |
| Change rate | on update | whenever the user retunes a folder |

Making the Profile the instance of a Pack forces the mutable object to inherit
the immutable object's identity. That is exactly the coupling #840 §4.2 recorded
as OZI's root cause of preset sprawl.

It also produces one unacceptable consequence directly from the definition: if
the Profile is the Pack's instance, then uninstalling a Pack must destroy a
Profile, and with it the user's folder choice and citation style — two values
the user never got from the Pack.

### 4.2 Why not "orthogonal"

If the two never touch, the map's shareability criterion fails. #840 already
established that folder and citation style are precisely what a template cannot
express. A "complete Literature Note configuration" that omits them is
incomplete by the handoff's own test.

### 4.3 The seeding rule

The manifest may carry `profileDefaults` holding the **same** bindings the
Profile holds. The installer treats them as suggested values: shown in the diff,
applied only where the user has not already set their own, never as ownership.
After install, the Profile is the user's. Revert does not touch a binding the
user has since changed, and uninstall never removes one.

**This does not contradict the decline of optional parameters**, and the test
that separates them is the Verdict's rule. A parameter block is new
configuration invented by the Pack author, which ZotLit must then interpret. A
`profileDefaults` block is existing configuration that ZotLit already owns,
pre-filled. It adds no vocabulary, no type system, no UI, and no migration
surface, because its schema *is* the Profile's schema. If the Profile schema
changes, the block changes with it, once.

### 4.4 Where #841 changes this

The note-identity question is open. Record the dependency precisely: **#841 does
not change the manifest. It changes whether install is an overlay onto one
namespace or a constructor for a scoped one.**

- **If one Zotero item maps to exactly one note** — one Profile is effective at
  a time, or Profiles select by item type. A Pack installs into the flat
  namespace, `profileDefaults` seeds the single Profile, and §4.3 stands as
  written.
- **If one item may have several notes, one per Profile** — the template
  namespace stops being global. Two Profiles running two Packs need two
  different bodies for the name `note`, and the flat, file-name-keyed scan
  cannot express that: the name grammar has no Profile segment
  (`defaults.ts:48-50`, `service.ts:562-580`). The envelope survives unchanged,
  but the install target becomes a Profile-scoped name space, and "a Pack
  install creates a Profile" becomes defensible — the one reading in which
  Profile-as-instance is coherent. #840 §5.5 already sketched the cheap scoping
  mechanism: a name suffix such as `zotlit-note@book.liquid.md` that falls back
  to the bare name.

Two envelope choices are made now so that either branch stays reachable: `id` is
mandatory, and the `templates` list is explicit. A scoping rule keys on exactly
those two.

---

## 5. What a Pack must not contain

1. **Anything that flips the JavaScript Templates gate.** The gate is stored per
   device in `localStorage` precisely so a synced `data.json` or a shared vault
   can never pre-enable it (`service.ts:47-48`, `:428-433`; ADR 0004). A Pack is
   a stronger vector than a synced vault, because it arrives from a stranger.
   The manifest has no gate field, and the installer never sets one. It refuses.
2. **Executable code outside a template file.** No install script, no
   post-install hook, no bundled JavaScript. ADR 0012 records that
   community-plugin review forbids remote code, and that ZotLit's answer is
   interpreted, consent-gated, eval-free data packs; ADR 0018 and ADR 0019 give
   the house delivery pattern. Eta bodies are the one exception, and they are
   exception-shaped: already gated, already inert by default, already refused
   with a named error.
3. **Vault paths.** A Pack names templates by name, never by path. #840 §5.5
   declined a free vault path for a template because a path field has no
   "absent means built-in" state. A Pack that carried paths would reintroduce
   that, and would also let a Pack write outside the template folder.
4. **The managed-region markers as template text.** The markers are host policy
   on one line (`packages/templates/src/obsidian.ts:20-23`, installed at
   `service.ts:126-127`). A Pack that hard-coded `%%zt-managed%%` in a body would
   move the create-time and update-time byte identity that #836 identified as the
   basis of the splice out of the engine and into the author's hands.
5. **Reserved frontmatter keys** — `zotero-key`, `zotero-note-key`,
   `zotero-lastmod` (`lib/constants.ts:66-72`), already refused on the write
   path (`cli.ts:534-543`).
6. **Settings outside the Profile schema.** No `log.level`, no `server.port`, no
   `zotero.library-scope`. The envelope carries a value only when ZotLit already
   owns its schema **and** the value belongs to how a literature note looks.
   That is two tests, not one.
7. **Unmodified copies of the built-in defaults.** A Pack that ships an untouched
   `annotation.liquid` "for completeness" converts an absent state into a managed
   one and permanently owns a name it does not change. The installer should
   compare each body against `DEFAULT_TEMPLATES` (`defaults.ts:67-74`) and drop
   the byte-identical entries.

---

## 6. Failure modes of the envelope

### 6.1 Version skew

A Pack authored against a later `zt` contract lands on a build that serves an
earlier one, or the reverse. The `zt` shape is versioned
(`packages/db/src/contract/roots.ts:8`) and each version's schemas ship as
release assets (`services/template-workbench/schema.ts:28-46`, ADR 0019), so the
hard case is checkable: `contract` is an install gate, tested before preview.

The soft cases are not covered by that number, and preview catches them instead.
A field that quietly disappeared shows up as a root-variable warning
(`cli.ts:835-845`); a filter removed from the Liquid dialect is a render error at
preview (`guide.ts:211`). This is why preview comes **before** the diff in
the lifecycle, not after it.

### 6.2 A Pack update clobbers an ejected template

Today nothing distinguishes "this file is the user's" from "this file is the
Pack's": the folder holds only files (`service.ts:562-580`). The install record
is the only defence. At update time, classify each owned name from the recorded
body hash:

| Classification | Action |
| --- | --- |
| unchanged since install | replace |
| user-modified | refuse by default; offer a side-by-side; never overwrite silently |
| absent | recreate |

The sharpest instance comes from #836: a user who removed the
`{% render "content" %}` line from `note`
(`packages/templates/defaults/note.liquid:5`) ships notes that no update can
ever refresh, because the region is only in the note through that include. A
Pack update that restores the line is the right fix and the wrong thing to do
without telling the user.

### 6.3 Engine unavailability

The gate is per device, and a Pack is per vault. A synced vault therefore reaches
a device that cannot run it. With the gate off, an Eta-only name has **no
compiled template at all**: render fails with `ETA_OPT_IN_REQUIRED` and never
falls back (`service.ts:677-698`; ADR 0004, amendment 2026-07-12).

The derived engine requirement is therefore two checks, not one: an install-time
refusal on the installing device, and a **first-run** refusal on every other
device that later opens the vault. The setting row already surfaces inert Eta
files per template (`service.ts:682-698`, `templates.ts:255-261`). Pack status
should surface the same fact once per Pack, not once per row.

A quieter variant: a Liquid file wins over an Eta file of the same name
(`service.ts:700-705`), so a Pack that shipped both editions of one name would
make the Eta edition dead weight and raise a shadow warning
(`service.ts:664-675`). One language per name in `templates` removes the case.

### 6.4 Duplicate names

Two different collisions, and they must not be conflated.

- **Pack id collision.** Two Packs claim the same `id`. This is resolvable
  because the `id` is stable and is never derived from a label. Refuse the second
  install and offer replacement. The failure to avoid is OZI's: the first record
  that matches wins, silently (`ozi/src/main.ts:219`).
- **Template name collision.** Two installed Packs both claim `header`. This one
  is structural: the folder is one flat namespace keyed by file name
  (`service.ts:562-580`), and includes resolve by bare name
  (`facade.ts:262-329`). Either the envelope forbids more than one Pack owning a
  name at a time, or names must be scoped.

Recommendation: **one Pack owns a template name at a time.** It is simple, it is
correct while #841 is open, and lifting it later is the same lever as the
Profile-scoping branch in §4.4.

### 6.5 Uninstall leaves orphans

Three kinds, each needing a different default.

| Orphan | Default |
| --- | --- |
| A template file the Pack introduced and the user then edited | Keep the file and drop ownership. Move to trash only with explicit consent |
| A frontmatter key the Pack added that the user's own template now reads | Show the removal in the diff, and leave the key by default. Removing it breaks a note the user wrote, not the Pack |
| A Profile binding the Pack seeded | Never removed, by the §4.3 rule |

And one quiet orphan: an `.eta.md` shadowed by a Liquid file of the same name is
invisible to render but visible as a warning (`service.ts:664-675`,
`templates.ts:246-254`). Uninstall must consult the install record, not the
current winner, or it will leave the shadowed file behind.

---

## 7. Input for the final grilling

1. **One rule decides the manifest.** A Pack may carry values whose schema
   ZotLit already owns. It may not invent a schema of its own. That rule declines
   parameters, capabilities, and a Pack-level merge strategy, and it admits the
   frontmatter list and the Profile defaults.
2. **Declare the data contract, not the plugin version.** `CONTRACT_VERSION`
   already exists and already means the right thing.
3. **Install is a recorded, reversible bulk eject.** Files stay where the watcher
   already looks. The Pack is the transaction and its record, not a storage
   format. No renderer change is required.
4. **A Pack ships Profile defaults. It never owns a Profile.** Seeding is one
   direction, applied only where the user has not chosen.
5. **Decide what a row's reset means once a Pack owns the name** — the Pack's
   body, or ZotLit's built-in. Both flows exist and only one can win the button.
6. **One Pack owns a template name at a time.** Lifting that restriction is the
   same lever as the note-identity question in #841.
7. **The one new seam the lifecycle needs** is a render against a source that is
   not installed. Everything else in preview, diff, apply, and revert reuses code
   that already runs.

Briefing input only. The envelope is ratified at the map's final decision
grilling.
