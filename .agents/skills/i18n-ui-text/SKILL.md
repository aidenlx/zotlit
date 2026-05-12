---
name: i18n-ui-text
description: Obsidian house style for the wording of user-facing UI strings — command names, setting labels, button text, notices, modal copy. Use when authoring or editing the English text of a message in `messages/*.json`, naming a command, or copy-editing UI strings. Pair with `paraglide-i18n` (mechanics); this skill covers the words, not the format.
paths: "messages/*.json"
---

# Writing UI Text

This skill is about **what the strings say**, not how they're wired up. For the JSON message format, key naming, pluralization/variants, and the Paraglide runtime (`m.*`, `getLocale`, `setLocale`), use the `paraglide-i18n` skill. Use the two together: `paraglide-i18n` for the file shape, this skill for the words inside it.

## When this applies

Any English string a user will read inside Obsidian:

- Command names registered via `plugin.addCommand({ name: ... })`
- Setting labels and descriptions (`new Setting(...).setName(...).setDesc(...)`)
- Button labels (`.setButtonText(...)`, `.setCta()`)
- Notices (`new Notice(...)`)
- Modal titles and body text
- Menu item titles
- Status bar text, ribbon tooltips, dropdown options
- Error and validation messages shown to the user

All of these should be authored in `messages/en.json` (the base locale) per the `paraglide-i18n` skill, then translated. **The base-locale string is the authoritative source — get the English right first.**

Internal logs, code comments, and developer-only diagnostics are *not* UI text and don't follow this guide. Those go through LogTape (see `AGENTS.md` → Logging).

## How to use this skill

1. Draft the string.
2. Run through the **quick checklist** below — most copy issues are caught here.
3. If anything is ambiguous (a term you're unsure about, an unusual interaction phrasing, OS-shortcut formatting, em-dash placement), consult the **Terminology and Grammar** section inlined below.
4. For long-form copy (multi-paragraph modal text, onboarding flows) or doc-like content, also consult `references/obsidian-style-guide.md` for sections on lists vs. prose, callouts, and information structure. Those sections target docs but apply when UI copy gets long.

## Quick checklist for UI strings

Before committing a new string, verify:

- **Sentence case** — `"Refresh Zotero database"`, not `"Refresh Zotero Database"`. Capitalize only the first word and proper nouns. Applies to command names, button labels, setting names, headings, modal titles.
- **Imperative verb for actions** — commands and buttons that perform something start with a verb: `"Import notes"`, `"Open library"`, not `"Importing notes"` or `"Library import"`.
- **"Select", not "click" or "tap"** — when copy refers to an action the user takes on UI (e.g., setting descriptions saying "Select a folder to…").
- **American English** — `organize`, `color`, `behavior`, `synchronize`. Not `organise`, `colour`, `behaviour`, `synchronise`.
- **Plain, global English** — no idioms, no jargon when a common word works. Active voice.
- **Match Obsidian's noun choices** — "note" (for `.md` files in the vault), "file" (other extensions), "folder" (not "directory"), "sidebar" (not "side bar"), "keyboard shortcut" (not "hotkey"), "heading" (not "header"), "sync"/"syncing" (not "synchronize"/"synchronizing"), "search term" (not "search query"), "active note" (not "current note"), "note name" (not "note title"), "file type" (not "file format"), "maximum"/"minimum" (not "max"/"min"), "perform" (not "invoke"/"execute").
- **Product names** — Obsidian products start with "Obsidian": "Obsidian Sync", "Obsidian Publish". Zotero is "Zotero" (proper noun, no prefix).
- **Sequential UI navigation uses →** — `"Settings → Community plugins"` with the actual arrow character (U+2192), not `->` or `>`.
- **Bold button references in prose** — when a setting description refers to a button, the button name is bold in Markdown-rendered contexts. (Plain Obsidian `Setting` descriptions render limited Markdown; check before relying on it.)
- **Keyboard shortcuts use `Ctrl+Z` / `Command+Z`** — no spaces around `+`, no `Cmd/Ctrl+Z` shorthand. Specify both OSes when they differ.
- **Realistic examples** — not `foo`/`bar`. Use plausible Zotero items, collection names, citation keys.
- **No trailing period on short labels** — button labels, command names, setting names omit the period. Multi-sentence descriptions and notices use full punctuation.
- **No directional anchoring for settings** — don't say "to the right of X, select Y"; settings re-flow by device. Say "Next to **X**, select **Y**." Use "above"/"below" for vertical relationships, not "up"/"down".
- **Don't echo the key into the value** — message key `database.refresh.success` with value `"Database refreshed"` is fine; value of `"database.refresh.success"` is a leak.

---

## Terminology and Grammar

*Inlined from the Obsidian Style Guide. The full upstream guide is in `references/obsidian-style-guide.md`.*

### Language Style

For English documentation, use [Global English](https://docs.openedx.org/en/latest/documentors/references/doc_english_writing.html) to serve a worldwide audience:

- Avoid idioms and culturally-specific expressions
- Use active voice and direct sentence construction
- Prefer simple, common words over complex terminology
- Be explicit rather than implied
- Use American English spelling (e.g., 'organize' not 'organise')

### Terms

- Prefer "keyboard shortcut" over "hotkey"
- Prefer "the Obsidian app" on mobile, "the Obsidian application" on desktop
- Prefer "sync" or "syncing" over "synchronise" or "synchronising"
- Prefer "search term" over "search query"
- Prefer "heading" over "header"
- Prefer "maximum" over "max" and "minimum" over "min"

### Product Names

Obsidian product names start with "Obsidian," such as "Obsidian Publish" and "Obsidian Sync." Use short forms in subsequent references if paragraphs become repetitive.

### UI and Interactions

- Use **bold** for button text
- Prefer "select" over "tap" or "click" (except mobile-specific instructions)
- Prefer "sidebar" over "side bar"
- Prefer "perform" over "invoke" or "execute"
- Use → (U+2192) symbol for sequential interactions: "**Settings → Community plugins**"

### Notes, Files, and Folders

- Use "note" for Markdown files in the vault
- Use "file" for other file extensions
- Prefer "note name" over "note title"
- Prefer "active note" over "current note"
- Prefer "folder" over "directory"
- Prefer "file type" over "file format"

Use "open" when the destination note is hidden; use "switch" when both source and destination are open in separate splits.

### Reference Documentation for Settings

Document settings within Obsidian when possible. Avoid external documentation unless:

- More in-depth knowledge is required
- The setting is commonly misused or questioned
- It drastically changes user experience

### Directional Terms

Hyphenate directional terms when used as adjectives; avoid hyphenation when used as nouns.

**Recommended:**
- "Select Settings in the bottom-left corner"
- "Select Settings in the bottom left"

**Not recommended:**
- "Select Settings in the bottom left corner"
- "Select Settings in the bottom-left"

Prefer "upper-left" and "upper-right" over "top-left" and "top-right."

Don't indicate direction when referring to settings, as location varies by device.

**Recommended:** "Next to **Pick remote vault**, select **Choose**"

**Not recommended:** "To the right of **Pick remote vault**, select **Choose**"

For vertical UI elements, use "above" and "below" for spatial relationships, not "up" and "down."

**Recommended:**
- "The search box appears above the file list"
- "Additional options are available below"

### Instructions

Use imperatives for guide names, section headings, and step-by-step instructions:

- Prefer "Set up" over "Setting up"
- Prefer "Move a file" over "Moving a file"
- Prefer "Import your notes" over "Importing your notes"

### Sentence Case

Prefer sentence case over title case for headings, buttons, and titles. Match the case of UI element text when referencing.

**Recommended:** "How Obsidian stores data"

**Not recommended:** "How Obsidian Stores Data"

### Examples

Use realistic examples over nonsense terms.

**Recommended:** `task:(call OR schedule)`

**Not recommended:** `task:(foo OR bar)`

### Key Names and Keyboard Shortcuts

**Individual key names:**

Add the character in parentheses after the key name.

**Recommended:**
- "Press the hyphen (-) key to add a dash"
- "Use the question mark (?) to search"

**Not recommended:**
- "Press the hyphen key to add a dash"
- "Use the ? to search"

**Keyboard shortcuts:**

Format with no spaces around plus signs. Specify both operating systems when shortcuts differ.

**Recommended:**
- "Press `Ctrl+Z` (Windows) or `Command+Z` (macOS) to undo"
- "Press `Escape` to close this window"
- "Use `Tab` to move between fields"

**Not recommended:**
- "Press `Cmd+Z` to undo"
- "Press `Ctrl + Z` (with spaces)"
- "Press `Ctrl/Cmd+Z` to undo"

For identical cross-platform shortcuts, OS specification isn't necessary.

### Markdown

Use newlines between Markdown blocks:

**Recommended:**
```md
# Heading 1

This is a section.

1. First item
2. Second item
3. Third item
```

**Em dashes in lists:**

Use em dashes (—) to separate bolded terms from descriptions in bullet lists. Don't use em dashes in simple nested bullet lists with links.

**Recommended:**
- **View menu** — create, edit, and switch views
- **Calculate values** — add prices, compute totals, or perform math operations

**Not recommended:**
- [[Create a base]] — Learn how to create and embed a base

### Images

Use "**width** x **height** pixels" for describing image dimensions.

**Example:** Recommended image dimensions: 1920 x 1080 pixels.

---

## Applying this to ZotLit specifically

A few project-specific notes that build on the rules above:

- **Two products, two rules.** Obsidian products are "Obsidian X" (with the prefix). Zotero is just "Zotero" — don't write "Zotero Library", write "Zotero library" (sentence case, generic noun).
- **"Citation", "item", "attachment", "collection", "library"** are Zotero's nouns — use them in singular/plural as Zotero does. Don't invent synonyms ("entry", "record", "doc").
- **Notices should be one sentence with a period.** Notices are transient — keep them short, declarative, past tense for completed work (`"Database refreshed."`), present continuous for in-progress (`"Refreshing database…"` with a real ellipsis character, U+2026).
- **Setting descriptions are usually one or two short sentences.** First sentence states what the setting does; optional second sentence states the consequence or default.
- **Don't translate Zotero/Obsidian feature names or citation-key formats.** Proper nouns stay as-is across all locales.

## When in doubt

- Skim `references/obsidian-style-guide.md` if you hit a case the inlined section doesn't cover (callouts, image dimensions, doc layout).
- Look at sibling strings in `messages/en.json` — match the established voice of nearby strings rather than introducing a new tone.
- If you're truly stuck on a term, leave a TODO comment alongside the change and ask the user; it's cheaper to pick a name once than to rename a user-visible string later.
