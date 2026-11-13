<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/logo/zotlit-wordmark-dark.svg">
  <img alt="ZotLit" src="assets/logo/zotlit-wordmark.svg" width="320">
</picture>

<p><strong>Your Zotero research desk in Obsidian.</strong></p>
<p>Read and annotate papers beside your draft, find any highlight in your library, and cite as you write. Zotero keeps your PDFs; Obsidian keeps your thinking.</p>

<p>
  <a href="https://zotlit.aidenlx.site">🌐 Website</a>
  ·
  <a href="https://zotlit.aidenlx.site/docs">📖 Docs</a>
  ·
  <a href="https://zotlit.aidenlx.site/community">💬 Community</a>
</p>

<p>
  <a href="https://github.com/aidenlx/zotlit/stargazers"><img alt="GitHub stars" src="https://custom-icon-badges.demolab.com/github/stars/aidenlx/zotlit"></a>
  <a href="LICENSE"><img alt="License" src="https://custom-icon-badges.demolab.com/github/license/aidenlx/zotlit?logo=law&logoColor=white"></a>
  <a href="https://zotlit.aidenlx.site/docs/install-zotlit"><img alt="Obsidian plugin version" src="https://custom-icon-badges.demolab.com/badge/dynamic/json?query=%24.version&url=https%3A%2F%2Fraw.githubusercontent.com%2Faidenlx%2Fzotlit%2Fmain%2Fapps%2Fobsidian%2Fpackage.json&label=obsidian%20plugin&logo=obsidian&logoColor=white&color=8b6cef"></a>
  <a href="https://zotlit.aidenlx.site/docs/install-companion"><img alt="Zotero companion version" src="https://custom-icon-badges.demolab.com/badge/dynamic/json?query=%24.version&url=https%3A%2F%2Fraw.githubusercontent.com%2Faidenlx%2Fzotlit%2Fmain%2Fapps%2Fzotero%2Fpackage.json&label=zotero%20companion&logo=zotero-32&color=bc3a3c"></a>
</p>

<p>
  <a href="https://zotlit.aidenlx.site/docs/install-zotlit"><img alt="Install in Obsidian" src="https://custom-icon-badges.demolab.com/badge/-Install%20in%20Obsidian-8b6cef?style=for-the-badge&logo=obsidian"></a>
</p>

</div>

> [!WARNING]
> **Update the Obsidian installer first.** ZotLit needs Obsidian 1.14.5 or newer, and the **installer version** must also be 1.14.5 or newer. Obsidian's in-app update does not replace the installer. Check yours in **Settings → About**.
>
> If the installer is older, ZotLit does not load. Obsidian shows _Failed to load plugin "zotlit"_, and the developer console shows a `SyntaxError`.
>
> **Fix:** download Obsidian from [obsidian.md/download](https://obsidian.md/download) and run it over your current installation. Nothing is deleted, and no notes are lost. [Full steps →](https://zotlit.aidenlx.site/docs/how-to/update-obsidian-installer)

> [!NOTE]
> **Coming from v1?** v2 is a major upgrade with breaking changes. Your existing literature notes and custom templates do not carry over unchanged. Read the [migration guide](https://zotlit.aidenlx.site/docs/how-to/migrate-from-v1) before upgrading.

## Overview

ZotLit lets Zotero manage your papers, PDFs, and annotations, and keeps Obsidian for your thinking and writing. Browse your library in an Obsidian tab and query its items, annotations, and attachments, read and annotate a paper's PDF beside your draft, turn what you read into literature notes and citations, and export the finished note to Word with a bibliography. Your notes stay as plain Markdown in your vault.

## Features

| Feature | Description |
| --- | --- |
| **Library View** | Browse your Zotero collections and tags in an Obsidian tab. Select a paper to see its abstract, its PDF, and how many highlights you made in each color. |
| **ZotLit Query** | Ask questions of your Zotero library without leaving Obsidian: every highlight in a collection, the papers from one journal, the papers tagged for a chapter. See the answers as tables, cards, or lists, and add columns of your own. |
| **PDF reader** | Read a paper beside your draft. With Zotero 10, the highlights and comments you make in Obsidian save to Zotero and sync to your other devices. |
| **Annotation view** | See all of a paper's highlights in one list beside the PDF. Drag one into your note, and it becomes a quote that links back to its page. |
| **Literature notes** | Create a note for a paper in one step, with its details, your highlights, and a link back to Zotero. |
| **Citations** | Cite as you type, and see the reference list in your citation style, such as APA or Chicago, as you write. |
| **Export** | Export your draft to Word with its citations and reference list already formatted. |
| **Citation graph** | See in Obsidian's graph view which papers each note cites, and which papers your notes have in common. |
| **Note import** | Bring the notes you wrote in Zotero into your vault. |
| **Keep notes updated** | When you correct a paper's details in Zotero, update its note with one command. |
| **Templates** | Choose what each note contains and where it goes. Use a different layout for books, articles, or a project, and see a live preview as you edit. |
| **Agent-assisted templates** | [Describe the note you want](https://zotlit.aidenlx.site/docs/install-skill) in plain words, and your AI assistant builds and tests the template for you. |

Full guides live in the [documentation](https://zotlit.aidenlx.site/docs).

## Quick start

With ZotLit [installed](https://zotlit.aidenlx.site/docs/install-zotlit), open the command palette and run **ZotLit: Open Zotero library**. The [Library View](https://zotlit.aidenlx.site/docs/how-to/use-library-view) shows your collections and papers. Select a paper to see its abstract and annotations, double-click it to [read its PDF in Obsidian](https://zotlit.aidenlx.site/docs/how-to/open-pdf-in-obsidian), or drag it into a note to cite it.

When you have something to say about a paper, run the [create-note command](https://zotlit.aidenlx.site/docs/how-to/create-and-open-notes). ZotLit writes a Markdown note shaped by your template: frontmatter, headings, highlights, and your own notes, ready to link.

New here? Follow the [first-note lesson →](https://zotlit.aidenlx.site/learn/connect-zotero-to-obsidian)

## Disclosures

> [!IMPORTANT]
> **Zotero database access**
> ZotLit reads your Zotero database directly, including files stored outside your Obsidian vault (Zotero's data directory, attachments on external drives or cloud storage). It never writes to the database file. Changes you make from Obsidian, such as PDF annotations, go through Zotero's local API, and only after you grant permission in Zotero. When your Zotero data directory sits on a different drive than your system temp folder, ZotLit keeps its short-lived database snapshots in a `.zotlit-db-reads` folder inside that data directory, which you can delete at any time.

> [!IMPORTANT]
> **Network use**
> Live updates run a local notification server so the Zotero companion can push changes to Obsidian. Connections stay on your machine (localhost); ZotLit does not send your data to any external service.
>
> After you consent, ZotLit will download the `zh-CN.json` Language Pack from `github.com/aidenlx/zotlit`.

> [!IMPORTANT]
> **Shell command (macOS only)**
> On macOS, ZotLit runs the system `cp -c` command to create zero-copy clones of files. A zero-copy clone duplicates a file instantly without using extra disk space — macOS shares the underlying data on disk until one copy is changed. ZotLit uses this for two things: snapshotting the Zotero database so it can be read safely without interfering with Zotero, and importing attachments (PDFs, images) into your vault without doubling disk usage. Node.js does not expose this macOS feature directly, so ZotLit invokes the system `cp` command. No other shell commands are executed.

> [!IMPORTANT]
> **Third-party project: back up your data**
> ZotLit is a third-party project, not affiliated with Obsidian or Zotero, and may break when either updates. Back up your vault and Zotero data before using it. The v1 codebase remains on the [`v1` branch](https://github.com/aidenlx/zotlit/tree/v1), with [v1 docs](https://zotlit-v1.aidenlx.site).

## Support

Questions, help, and bug reports: [Community](https://zotlit.aidenlx.site/community) — Discord for chat, GitHub Discussions for ideas and bugs.

---

<div align="center">

[AGPL-3.0-or-later](LICENSE) · [Credits](https://zotlit.aidenlx.site/docs/credits) · Not affiliated with Obsidian or Zotero

</div>
