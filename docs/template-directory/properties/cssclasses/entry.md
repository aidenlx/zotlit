---
title: CSS classes
summary: A literature-note CSS class on every literature note, so a CSS snippet or your theme can style literature notes apart from other notes.
minAppVersion: "2.2.0-beta.0"
tasks: [general-reading]
features: [properties]
problems:
  - I want my literature notes to look different from my other notes.
  - I want wider pages for my literature notes.
  - My cssclasses are lost when the note updates.
keywords:
  - cssclasses
  - cssclass
  - CSS snippet
  - style
  - theme
  - wide page
  - appearance
audience: Readers who use a CSS snippet or a theme feature to change how literature notes look.
effort: Add one property to your profile in the Properties tab, and a CSS snippet or theme that uses the class.
expected:
  journal-article: { cssclasses: [literature-note] }
  book: { cssclasses: [literature-note] }
  book-section: { cssclasses: [literature-note] }
  thesis: { cssclasses: [literature-note] }
---

The CSS class `literature-note` in the `cssclasses` property of every literature note. Obsidian gives a note the classes in its `cssclasses` property, so a CSS snippet can change how literature notes look and leave your other notes as they are.

| Item | `cssclasses` |
| --- | --- |
| Journal article | literature-note |
| Book | literature-note |
| Book chapter | literature-note |
| Thesis | literature-note |

The class does nothing by itself. For example, this CSS snippet makes literature notes wider:

```css
.literature-note {
  --file-line-width: 60rem;
}
```

Save it as a `.css` file in your vault's snippets folder and turn it on in **Settings > Appearance > CSS snippets**. Some themes also offer classes of their own; add them to the list in the rule.

When the note updates: **Add to the existing list**. ZotLit adds `literature-note` when the note does not have it, and keeps every class already in the note, so a class you add by hand stays.

To add it to a profile:

1. Open **Settings > ZotLit > Literature note profiles** and select **Edit profile**, the pencil button, on your profile.
2. In the **Properties** tab, select **Add a property**. Enter `cssclasses` as the **Property name**.
3. In the **Value format** menu beside **Value**, choose **Rule · JSON-e**, then select **Change format and reset value**.
4. In **Value**, replace the example rule with this entry's rule.
5. Set **When the note is updated** to **Add to the existing list**.

Limits: a class you delete from one note comes back on its next update. To remove it from every note, remove it from the rule. When the note holds `cssclasses` as text and not as a list, ZotLit leaves it as it is and adds no class.
