<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/logo/zotlit-wordmark-dark.svg">
  <img alt="ZotLit" src="assets/logo/zotlit-wordmark.svg" width="320">
</picture>

<p><strong>Your Zotero library, written into your vault.</strong></p>
<p>Literature notes, citations, and annotations from Zotero in Obsidian.</p>

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
  <a href="https://zotlit.aidenlx.site/docs/install-zotlit"><img alt="Obsidian plugin version" src="https://custom-icon-badges.demolab.com/badge/dynamic/json?query=%24.version&url=https%3A%2F%2Fraw.githubusercontent.com%2Faidenlx%2Fzotlit%2Fnext%2Fapps%2Fobsidian%2Fpackage.json&label=obsidian%20plugin&logo=obsidian&logoColor=white&color=8b6cef"></a>
  <a href="https://zotlit.aidenlx.site/docs/install-companion"><img alt="Zotero companion version" src="https://custom-icon-badges.demolab.com/badge/dynamic/json?query=%24.version&url=https%3A%2F%2Fraw.githubusercontent.com%2Faidenlx%2Fzotlit%2Fnext%2Fapps%2Fzotero%2Fpackage.json&label=zotero%20companion&logo=zotero-32&color=bc3a3c"></a>
</p>

<p>
  <a href="https://zotlit.aidenlx.site/docs/install-zotlit"><img alt="Install in Obsidian" src="https://custom-icon-badges.demolab.com/badge/-Install%20in%20Obsidian-8b6cef?style=for-the-badge&logo=obsidian"></a>
</p>

</div>

> [!WARNING]
> **Update the Obsidian installer first.** ZotLit needs Obsidian 1.13.4 or newer, and the **installer version** must also be 1.13.4 or newer. Obsidian's in-app update does not replace the installer. Check yours in **Settings → About**.
>
> If the installer is older, ZotLit does not load. Obsidian shows _Failed to load plugin "zotlit"_, and the developer console shows a `SyntaxError`.
>
> **Fix:** download Obsidian from [obsidian.md/download](https://obsidian.md/download) and run it over your current installation. Nothing is deleted, and no notes are lost. [Full steps →](https://zotlit.aidenlx.site/docs/how-to/update-obsidian-installer)

> [!NOTE]
> **Coming from v1?** v2 is a major upgrade with breaking changes. Your existing literature notes and custom templates do not carry over unchanged. Read the [migration guide](https://zotlit.aidenlx.site/docs/how-to/migrate-from-v1) before upgrading.

## Overview

ZotLit connects your Zotero library to Obsidian. One command turns a Zotero item into a Markdown literature note shaped by your template. You can search the library and insert citations without leaving the editor, and read your Zotero annotations in a sidebar that follows the active reader. Everything stays as plain Markdown in your vault.

## Features

| Feature | Description |
| --- | --- |
| **Literature notes** | One command turns a Zotero item into a Markdown note, shaped by your template. |
| **Citations** | Search your library and insert citations without leaving the editor. |
| **Annotation view** | A sidebar of highlights and notes that follows your active Zotero reader. |
| **Note import** | Bring Zotero child and standalone notes into your vault as Markdown. |
| **Keep notes updated** | Re-render notes and refresh their metadata as items change in Zotero. |
| **Live updates** | Push changes from Zotero to Obsidian as they happen. *Requires the [companion](https://zotlit.aidenlx.site/docs/install-companion).* |
| **Templates** | Customize note, citation, and filename output with Liquid or Eta templates. |
| **Agent-assisted templates** | [Describe the note you want](https://zotlit.aidenlx.site/docs/install-skill). Your agent edits and tests its templates against your Zotero library. |

Full guides live in the [documentation](https://zotlit.aidenlx.site/docs).

## Quick start

With ZotLit [installed](https://zotlit.aidenlx.site/docs/install-zotlit), open the command palette and run the [create-note command](https://zotlit.aidenlx.site/docs/how-to/create-and-open-notes). Pick an item from your Zotero library, and ZotLit writes a Markdown note shaped by your template: frontmatter, headings, highlights, and your own notes, ready to link.

New here? Follow the [first-note tutorial →](https://zotlit.aidenlx.site/docs/tutorial/first-note)

## Disclosures

> [!IMPORTANT]
> **Zotero database access**
> ZotLit reads your Zotero database directly, including files stored outside your Obsidian vault (Zotero's data directory, attachments on external drives or cloud storage). It reads only and does not write to your Zotero database.

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

[MIT License](LICENSE) · [Credits](https://zotlit.aidenlx.site/docs/credits) · Not affiliated with Obsidian or Zotero

</div>
