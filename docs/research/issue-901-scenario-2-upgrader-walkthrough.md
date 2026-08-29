# Issue #901, Scenario 2: v2.1 upgrader

Issue: [aidenlx/zotlit#901](https://github.com/aidenlx/zotlit/issues/901)

Status: live walkthrough complete on 2026-08-29.

## Scope

This walkthrough used the disposable Fixture `upgrader` Vault Case. It started with version 9 settings from ZotLit 2.1.0, four edited legacy template slots, and no Profile document. It covered these paths:

1. Observe the first-load conversion prompt and settings reminder.
2. Postpone conversion and update an existing Literature Note.
3. Convert the legacy templates.
4. Inspect the generated Profile document, settings, and old files.

## Environment and starting state

| Field | Observed value |
| --- | --- |
| Command | `pnpm fixture open --vault-case upgrader --purge` |
| Fixture ready | about 6.765 s |
| Vault ID | `9c564f6395708903` |
| Vault | `tests/fixture-vault-feat-simple-template-upgrader` |
| Zotero | Paired Fixture run, ready |

The starting `data.json` had `__VERSION__: 9`, `release.previous-version: "2.1.0"`, and five frontmatter fields: `title`, `related`, `collections`, `citekey`, and `year`.

The vault had four edited legacy files:

```text
templates/zotlit-annotation.liquid.md
templates/zotlit-content.liquid.md
templates/zotlit-filename.liquid.md
templates/zotlit-note.liquid.md
```

Their visible edits were a `lit-` filename prefix, `(v2.1 template)` in the note heading, `## Zotero notes` in the content, and `[!quote] Page` in the annotation callout. [Fixture source](../../packages/scripts/lib/fixture/spec.ts#L1288-L1343)

## 1. First load and prompt

On first load, ZotLit migrated the settings to version 10 and set:

```text
note.template-conversion-pending: true
```

The first visible ZotLit UI was the upgraded Welcome view. No modal or notice appeared. The conversion banner said:

> **Convert your literature note templates**
>
> ZotLit will combine your current note, content, and filename templates into one profile document. It verifies identical output before it changes any files.
>
> **Convert templates**

[First-load conversion banner](profile-walkthrough/upgrader-00-first-load.png)

The settings resources strip repeated the title and body. Its action was **Review conversion**.

[Settings conversion reminder](profile-walkthrough/upgrader-01-settings-reminder.png)

Selecting **Review conversion** closed settings and returned to the upgraded Welcome view. It did not open a separate review or confirmation dialog.

[Conversion prompt after Review conversion](profile-walkthrough/upgrader-02-conversion-prompt.png)

There was no **Decline**, **Later**, or **Keep current templates** action. Postponement meant closing or leaving the Welcome view.

## 2. Work before conversion

I postponed conversion and updated the existing note `literatures/AAAAAAAA.md`. The overwrite confirmation said:

> **Overwrite literature note**
>
> Replace the note body with the ZotLit note template. Frontmatter keys managed by ZotLit are refreshed, and other frontmatter keys are kept.
>
> **Overwrite** / **Cancel**

[Legacy overwrite confirmation](profile-walkthrough/upgrader-03-legacy-overwrite-confirm.png)

The overwrite took about 5.059 seconds. It preserved the custom `year: 2024` field and rendered these legacy edits:

```text
# Alpha of the personal library (v2.1 template)
## Zotero notes
```

The four legacy files remained in the vault. This showed that default-Profile work could continue while conversion was pending.

## 3. Convert templates

Selecting **Convert templates** started conversion directly. The action had a loading state, but no second confirmation step. The pending flag was still true after about 33 ms. Conversion was complete after about 8.207 seconds.

The success notice was too short to capture during the sampled checks. Its source-defined text is:

> Literature note templates converted. The old files are in the system trash.

[Message source](../../messages/en.json#L49-L58)

After success, the still-open Welcome view changed in place to this unrelated banner:

> **Upgrading from ZotLit v1**
>
> Custom Eta templates are not loaded until you rename them and enable the JavaScript Templates gate.
>
> **Open migration guide**

[Welcome view after conversion](profile-walkthrough/upgrader-04-after-conversion.png)

This Fixture represented a v2.1 Liquid-template upgrade. The replacement v1 Eta message did not describe the completed conversion.

## 4. Generated Profile document

Conversion created:

```text
templates/literature-note-default.md
```

Its manifest contained:

```yaml
id: zotlit.converted-default
name: Converted default
description: Converted from legacy literature note templates.
contract: 2
language: liquid
```

It also contained the `lit-` filename expression and all five frontmatter fields, including `year`. Its body preserved the visible edits and wrapped the old content and annotation sources in a Managed Block and an Annotation Block:

```liquid
# {{ zt.title }} (v2.1 template)
## Zotero notes
{% managed %}
...
{% endmanaged %}
{% annotation %}
> [!quote] Page {{ annotation.pageLabel }}
...
{% endannotation %}
```

The conversion cleared `note.template-conversion-pending` and set the default Profile document to `literature-note-default.md`.

## 5. Settings and old files after conversion

The Templates page no longer showed the four legacy Literature Note Template slots. It showed the general template settings and citation templates.

[Templates settings after conversion](profile-walkthrough/upgrader-05-template-settings-after.png)

The Frontmatter page still showed `title`, `related`, `collections`, `citekey`, and `year`.

[Frontmatter fields after conversion](profile-walkthrough/upgrader-06-frontmatter-fields-after.png)

The default Profile page now said:

> Uses templates/literature-note-default.md.

[Default Profile after conversion](profile-walkthrough/upgrader-07-default-profile-after.png)

The four legacy files were no longer in the vault. Obsidian's `trashOption` was `system`, and ZotLit reported the system trash as the destination. The run did not find the files in the vault's local trash or in the directly inspected macOS Trash path. Therefore, this report confirms removal from the vault and the configured destination, but it does not claim direct recovery from Finder.

The visible Frontmatter rows remained editable after conversion, but the converted default Profile uses the copied manifest fields. The screen did not explain this ownership change.

## Timing summary

| Event | Observed time |
| --- | ---: |
| Fixture command to ready state | about 6.765 s |
| Select **Convert templates** to first pending check | about 33 ms; still pending |
| Select **Convert templates** to completed state | about 8.207 s |
| Confirm overwrite to updated legacy note | about 5.059 s |

The run did not instrument a separate layout-visible timestamp. It also did not relaunch a second pending Fixture because the postpone path and durable settings reminder were verified in the first session.

## Friction observed

1. The prompt named note, content, and filename templates, but conversion also verified, folded, and removed the annotation template.
2. The pre-action copy did not say that the old files would move to the system trash.
3. Conversion began without a separate confirmation step.
4. Postponement had no explicit action or explanation. The user had to leave the view.
5. **Review conversion** returned to the same Welcome banner. It did not show an additional review screen.
6. After success, the Welcome view changed to a v1 Eta migration message that did not apply to this v2.1 Liquid upgrade.
7. The old Frontmatter settings stayed visible after the Profile document became authoritative. The UI did not explain the relationship between them.
8. The success notice was transient and was not visible in the later steady-state check.

## Score

| Area | Score | Observation |
| --- | ---: | --- |
| Mental model | 2/5 | The one-document goal is clear, but the prompt omits the annotation slot and the later Frontmatter ownership change. |
| Predictability | 3/5 | Existing default-Profile work stayed functional and output was preserved. File movement and the post-success banner were unexpected. |
| Progressive disclosure | 2/5 | The first action is simple and the settings reminder is durable, but postponement, recovery, and the post-conversion state are not explained in context. |

These scores describe the observed run. They are evidence for the parent issue, not a product decision.
