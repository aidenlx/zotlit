---
name: discord-announcement
description: Draft a Discord announcement from a changelog entry. Use when the user asks to "draft discord message", "write discord announcement", "announce this release", or references a changelog file and wants a Discord post.
---

# Discord release announcement

Drafts a Discord message announcing a ZotLit release, derived from a changelog `.mdx` file.

The audience is plugin users in the ZotLit Discord server. They want to know what changed and where to read more.

## Steps

### 1. Locate the changelog

If `$ARGUMENTS` names a version or file path, use it. Otherwise read `apps/obsidian/package.json` `version` and look for `apps/docs/content/changelog/<version>.mdx`. If neither resolves, ask.

### 2. Read the entry

Read the changelog `.mdx` file end to end. Note every section heading and its content.

### 3. Draft the message

Format:

```
ZotLit <version> is out. <one-sentence summary of the release>.

<companion line, if applicable>

https://zotlit.aidenlx.site/changelog/<version>

<sections>
```

The companion line depends on the frontmatter `companion` field. If the changelog has a `companion` version (Zotero add-on also updated), include: "Both Obsidian plugin and Zotero add-on have been updated, make sure to update both:". If `companion` is absent, omit the line entirely.

Section rules:

- One section per changelog `##` heading that has content. Use emoji prefixes: `⚠️` Breaking, `✨` Highlights, `🔗` New, `🐛` Bug fixes.
- Each section: emoji + title line, then bullets underneath.
- Bullets restate the user-facing change in one or two sentences. Keep template variable names and command names in backticks.
- No `@everyone` or `@here` unless the user explicitly asks for a ping.

### 4. Write to file

Write the draft to `/tmp/discord-<version>.md`.

### 5. Slop check

Run `/slop-check` on the written file. Fix high and medium flags in place. Em dashes are the most common hit; split into two sentences or use a period instead.

Print the file path back to the user.
