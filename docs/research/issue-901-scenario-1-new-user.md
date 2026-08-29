# Issue #901, Scenario 1: new user, first use

Issue: [aidenlx/zotlit#901](https://github.com/aidenlx/zotlit/issues/901)

Status: live walkthrough complete on 2026-08-29.

## Scope

This walkthrough used the disposable Fixture `fresh` Vault Case. It covered these tasks:

1. Start ZotLit with no settings or notes.
2. Create the first Literature Note with the default Profile.
3. Customize the default Profile document.
4. Add a second Profile and create a note with it.
5. Insert one Zotero annotation into a note.

The Fixture already had ZotLit installed and enabled. Therefore, this run did not include Obsidian's community-plugin installation screens.

## Environment

| Field | Observed value |
| --- | --- |
| Command | `pnpm fixture open --vault-case fresh --purge` |
| Plugin | ZotLit 2.1.0 |
| Obsidian | 1.14.0, installer 1.13.7 |
| Operating system | macOS |
| Appearance | Light theme |
| Vault ID | `08c893cdf7a595cf` |
| Vault | `tests/fixture-vault-feat-simple-template-fresh` |
| Zotero | Paired Fixture run, ready |

The `fresh` case has no seeded notes and no ZotLit settings file. The Paired Run supplies the Fixture database through Device Overrides. [Fixture source](../../packages/scripts/lib/fixture/spec.ts#L1247-L1276)

## 1. First launch

The first ZotLit view was **Welcome to ZotLit**. The connection row settled without a notice or modal and showed:

```text
Connect to Zotero
~/worktrees/zotlit-v2/feat-simple-template/tmp/acceptance-fixture/zotero-data
21 items
Open settings
```

The remaining first-use sections were:

```text
Install ZotLit Companion
ZotLit Companion, the Zotero add-on, keeps recent Zotero changes available to ZotLit.
Install it before you create your first literature note.
Open installation guide

Choose where literature notes live
New notes default to the literatures folder. Change it any time.
Pick folder

Create your first literature note
Search your library and turn any item into a fully-templated note.
Search your library
```

[First Welcome view](profile-walkthrough/new-user-00-first-window.png)

No Profile or template term appeared in this view. The page described the immediate outcomes: connect, choose a folder, and create a note.

## 2. First Literature Note

I selected **Search your library** and chose **Alpha of the personal library**. The picker became searchable in about 34 ms.

[First library picker](profile-walkthrough/new-user-01-library-picker.png)

The note became active in about 6.5 seconds:

```text
literatures/personalAlpha2024.md
```

[First Literature Note](profile-walkthrough/new-user-02-first-literature-note.png)

The note had these frontmatter keys:

```text
title
related
collections
citekey
zotero-key
```

It did not have `zotlit-profile`, which means it uses the default Profile. The raw `%%zt-managed%%` and `%%/zt-managed%%` markers were visible in Live Preview. The screen did not define these markers.

The first workflow did not ask the user to choose a Profile. This kept the first note path short. The created note also gave no explanation of the Profile that controlled it.

## 3. Customize the default Profile document

The main ZotLit settings page introduced **Literature note profiles** with this text:

> Set the folder, citation style, imported notes folder, highlight syntax, and template document for each profile.

[ZotLit settings](profile-walkthrough/new-user-03-settings-root.png)

The Profile list showed **Default** and this description:

> Sets the values that other profiles inherit.

[Profile list](profile-walkthrough/new-user-04-profiles-list.png)

The Default page showed these rows:

- Literature note folder
- Citation and references style
- Imported note folder
- Use colored highlight syntax
- Render annotations from template
- Template document

The Template document row said **Uses the built-in Literature Note Template.**

[Default Profile](profile-walkthrough/new-user-05-default-profile.png)

Selecting **Customize** took about 20 ms. It created `templates/literature-note-default.md` and opened the document behind the still-open settings window. During this transition, the row briefly said:

> The template document literature-note-default.md is missing.

[Customize transition](profile-walkthrough/new-user-06-customize-prompt.png)

After I closed settings, the generated document was visible. It contained a manifest with `id: zotlit.default-profile`, a Managed Block, and an Annotation Block. The document did not explain the template statements.

[Generated default Profile document](profile-walkthrough/new-user-07-template-document.png)

I changed the title line to:

```liquid
# {{ zt.title }} — customized
```

A later note created with the default Profile showed the changed title:

```text
# Ten Simple Rules for Better Figures — customized
```

This proved that the document controlled later default-Profile output. The run did not update the first note after this edit.

## 4. Add a second Profile

The **Add profile** icon created a Profile immediately. It did not open a creation dialog. The list showed **New profile** with inherited values and the built-in template.

[Profile list after Add profile](profile-walkthrough/new-user-08-add-profile-dialog.png)

The new Profile page described each inherited value as **Use default profile** or **Leave empty to use the default profile folder.**

[New Profile page](profile-walkthrough/new-user-09-new-profile-page.png)

I renamed the Profile to **Articles**. The saved ID was:

```text
9e5b907e-4e61-4c0a-98c7-a7d60dedc8e0
```

After the rename, the settings content became blank and its title still said **New profile**. Reopening the page restored the saved Profile.

[Blank page after rename](profile-walkthrough/new-user-10-profile-created.png)

The next Literature Note selection displayed a second picker. It showed only these labels:

```text
Default
Articles
```

[Second item picker](profile-walkthrough/new-user-11-second-note-picker.png)

[Profile picker](profile-walkthrough/new-user-12-profile-picker.png)

The Profile picker appeared about 11 ms after item selection. The screen did not show the folder, template document, or inherited values for either choice.

The automated keyboard selection closed the picker without creating a note. To complete the evidence run, I called the same note operation with the saved Profile ID. This automation result is not evidence of a user-facing picker defect.

The operation created:

```text
literatures/duplicateWithin2020.md
```

Its Properties view showed the raw stamp:

```text
zotlit-profile: 9e5b907e-4e61-4c0a-98c7-a7d60dedc8e0
```

[Note created with Articles](profile-walkthrough/new-user-13-profile-note.png)

The created note did not map the UUID back to **Articles**. The value is stable for the application, but it is opaque to a user who inspects Properties.

## 5. Insert an annotation

The first Annotation View state for a note with no linked attachment said:

> No attachments available

[Annotation View without an attachment](profile-walkthrough/new-user-14-annotation-view.png)

The screen did not explain how to attach or select another Zotero item. I then opened **Ten Simple Rules for Better Figures**. The view showed **7 of 7** annotations.

[Annotation list](profile-walkthrough/new-user-15-annotation-list.png)

I used the drag handle for the text annotation **Identify Your Message**. The real annotation card produced this `text/plain` payload:

```markdown
> [!note] Page 1
>
> Identify Your Message
```

The walkthrough sent that payload through the editor drop path. Text appeared in about 10 ms. ZotLit showed no success notice.

[Inserted annotation](profile-walkthrough/new-user-16-annotation-drop.png)

This annotation had no excerpt image. Therefore, this run verified annotation rendering and drag insertion, but it did not verify image copying.

## Timing summary

| Event | Observed time |
| --- | ---: |
| Select **Search your library** to searchable picker | about 34 ms |
| Select first item to active Literature Note | about 6.5 s |
| Select **Customize** to editor transition | about 20 ms |
| Select second item to Profile picker | about 11 ms |
| Annotation drop to inserted text | about 10 ms |

The run did not instrument the full Obsidian launch interval or settings navigation interval.

## Friction observed

1. Raw Managed Region markers were visible in Live Preview, with no definition.
2. **Customize** opened the document behind settings and briefly reported that the new file was missing.
3. The generated document exposed advanced template syntax with no explanation in the editor.
4. **Add profile** created a Profile immediately. The icon and action did not preview that effect.
5. Renaming the Profile left a blank settings page with a stale title until the page was reopened.
6. The Profile picker used labels only. It did not show the settings that would affect the new note.
7. The `zotlit-profile` stamp exposed an opaque UUID without its Profile label.
8. **No attachments available** did not give a recovery action.
9. The annotation drag handle did not provide visible drag instructions. A successful drop had no notice.

## Score

| Area | Score | Observation |
| --- | ---: | --- |
| Mental model | 2/5 | The first-note flow is clear, but Profile documents, Managed Regions, and stamps appear later without one connected explanation. |
| Predictability | 2/5 | Users cannot preview Profile effects in the picker. Several settings actions have unexpected navigation results. |
| Progressive disclosure | 2/5 | The Welcome view is simple, but customization exposes the complete template language at once and provides few in-context definitions. |

These scores describe the observed run. They are evidence for the parent issue, not a product decision.
