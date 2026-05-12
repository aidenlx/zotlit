# Obsidian Style Guide

> Source: <https://publish-01.obsidian.md/access/f786db9fac45774fa4f0d8112e232d67/Contributing%20to%20Obsidian/Style%20guide.md>
>
> This is the upstream Obsidian documentation style guide, mirrored locally for offline reference. Some sections (Markdown formatting, callouts, images, layout, translations) target long-form docs rather than short UI strings — apply judgment when consulting them for UI copy. For the parts that always apply to UI strings, see the **Terminology and Grammar** section inlined in `SKILL.md`.

The Obsidian documentation follows style guidelines based on industry best practices, particularly the [Google developer documentation style guide](https://developers.google.com/style) and [Microsoft Style Guide](https://learn.microsoft.com/en-us/style-guide/).

## Terminology and Grammar

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

## Information Structure

### Callout Types

**Tip** (`[!tip]-`) - Practical advice or best practices. Use for shortcuts and non-essential helpful information. Collapsed by default.

**Info** (`[!info]+`) - Additional context and background. Use when information adds understanding but isn't required. Open by default.

**Warning** (`[!warning]+`) - Important cautions preventing data loss or errors. Use sparingly. Never collapsed.

**Example** (`[!example]-`) - Tangential or supplementary details. Collapsed by default.

### Lists vs. Prose

Use lists for discrete items without strong sequential relationships. Use prose when items build on each other, require explanation, or need narrative flow.

**Use lists for:**
- Unrelated features
- Installation requirements
- Configuration options
- Troubleshooting steps

**Use prose for:**
- How something works explanations
- Workflows with dependencies
- Conceptual overviews
- Context-requiring guidance

### Tables

Use tables to compare features, versions, or related data where alignment aids understanding. Avoid tables for simple lists or single-column data.

### Cross-References

Use internal wiki links (`[[Note name]]`) liberally to help navigation. Avoid over-linking:

- Don't link the same term multiple times on a single page
- Link only when the referenced page provides significant added context
- Use descriptive text: `[[Note name#Section|descriptive text]]`

### Platform-Specific Content

Use `Desktop` and `Mobile` as subsection headings to separate platform-specific instructions or features. Only create separate sections if content significantly differs; use inline notes for minor variations.

## Icons and Images

Include icons and images to explain things difficult to describe with words or show important Obsidian application parts. Save images in the `Attachments` folder.

Images should be `.png` or `.svg` format. Adjust dimensions if images appear too large, or place complex images in folded callouts. For pop-up windows or modals, show the entire Obsidian application window.

### Icons

[Lucide](https://lucide.dev/icons/) and custom Obsidian icons provide visual representation of features.

**Guidelines:**
- Store icons in `Attachments/icons`
- Prefix Lucide icons with `lucide-`
- Prefix Obsidian icons with `obsidian-icon-`
- Use SVG versions
- Set dimensions to 18 x 18 pixels with 1.5 stroke width
- Use the `icon` anchor for correct vertical alignment
- Surround icons with parentheses: `![[lucide-cog.svg#icon]]`

### Image Anchor Tags

**Icon** (`#icon`) - Ensures correct vertical alignment for interface element icons.

**Interface** (`#interface`) - Adds decorative box shadow around images.

**Outline** (`#outline`) - Adds subtle border around images.

### Optimization

Optimize images to reduce file size while maintaining visual integrity. Recommended optimization rate: 65-75%.

## Layout

### Broken Links

Check for broken links before submitting pull requests. Use community plugins or IDE tools for verification.

### Descriptions

Add a `description` property if the page lacks one. Descriptions should be 150 characters or fewer and provide an objective content summary.

### Directions

Include steps for both mobile and desktop versions when writing instructions. Note if mobile or desktop access is unavailable when submitting pull requests.

## Translations

Translate all content, including:
- Note names
- Folder names
- Aliases
- Attachment names
- Alt link text
