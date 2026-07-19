<div align="center">

<!-- TODO: replace the wordmark with a product screenshot (annotation view or a literature note) once one is captured -->
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/logo/zotlit-wordmark-dark.svg">
  <img alt="ZotLit" src="assets/logo/zotlit-wordmark.svg" width="320">
</picture>

<p><strong>Your Zotero library, written into your vault.</strong></p>
<p>Integrate Zotero with Obsidian: literature notes, citations, annotations.</p>

<p>
  <a href="https://zotlit.aidenlx.site">Website</a>
  ·
  <a href="https://zotlit.aidenlx.site/docs">Docs</a>
  ·
  <a href="https://github.com/aidenlx/zotlit/discussions">Discussions</a>
</p>

<p>
  <a href="https://github.com/aidenlx/zotlit/stargazers"><img alt="GitHub stars" src="https://custom-icon-badges.demolab.com/github/stars/aidenlx/zotlit"></a>
  <a href="LICENSE"><img alt="License" src="https://custom-icon-badges.demolab.com/github/license/aidenlx/zotlit?logo=law&logoColor=white"></a>
  <a href="https://zotlit.aidenlx.site/docs/install-zotlit"><img alt="Obsidian plugin version" src="https://custom-icon-badges.demolab.com/badge/dynamic/json?query=%24.version&url=https%3A%2F%2Fraw.githubusercontent.com%2Faidenlx%2Fzotlit%2Fnext%2Fapps%2Fobsidian%2Fpackage.json&label=obsidian%20plugin&logo=obsidian&logoColor=white&color=8b6cef"></a>
  <a href="https://zotlit.aidenlx.site/docs/install-companion"><img alt="Zotero companion version" src="https://custom-icon-badges.demolab.com/badge/dynamic/json?query=%24.version&url=https%3A%2F%2Fraw.githubusercontent.com%2Faidenlx%2Fzotlit%2Fnext%2Fapps%2Fzotero%2Fpackage.json&label=zotero%20companion&logo=zotero-32&color=bc3a3c"></a>
</p>

<p>
  <a href="https://zotlit.aidenlx.site/docs/install-zotlit"><img alt="Install with BRAT" src="https://custom-icon-badges.demolab.com/badge/-Install%20with%20BRAT-8b6cef?style=for-the-badge&logo=obsidian"></a>
</p>

</div>

> [!WARNING]
> **ZotLit v2 is in beta.** It ships as GitHub pre-releases and installs with [BRAT](https://zotlit.aidenlx.site/docs/install-zotlit), not the Obsidian community store. The stable **v1** release lives on the [`v1` branch](https://github.com/aidenlx/zotlit/tree/v1). See the [v1 docs](https://zotlit-v1.aidenlx.site) for v1 usage.

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

Full guides live in the [documentation](https://zotlit.aidenlx.site/docs).

## Quick start

With ZotLit [installed](https://zotlit.aidenlx.site/docs/install-zotlit), open the command palette and run the [create-note command](https://zotlit.aidenlx.site/docs/how-to/create-and-open-notes). Pick an item from your Zotero library, and ZotLit writes a Markdown note shaped by your template: frontmatter, headings, highlights, and your own notes, ready to link.

New here? Follow the [first-note tutorial →](https://zotlit.aidenlx.site/docs/tutorial/first-note)

## Disclosures

> [!IMPORTANT]
> **Zotero database access**
> ZotLit reads your Zotero database directly, including files stored outside your Obsidian vault (Zotero's data directory, attachments on external drives or cloud storage). It reads only and does not write to your Zotero database.

> [!IMPORTANT]
> **Network access**
> Live updates run a local notification server so the Zotero companion can push changes to Obsidian. Connections stay on your machine (localhost); ZotLit does not send your data to any external service.

> [!IMPORTANT]
> **Third-party project: back up your data**
> ZotLit is a third-party project, not affiliated with Obsidian or Zotero, and may break when either updates. v2 is beta software. Back up your vault and Zotero data before using it. The stable v1 codebase remains on the [`v1` branch](https://github.com/aidenlx/zotlit/tree/v1), with [v1 docs](https://zotlit-v1.aidenlx.site).

## Support

Questions and help: [GitHub Discussions](https://github.com/aidenlx/zotlit/discussions). Bug reports: [open an issue](https://github.com/aidenlx/zotlit/issues/new).

---

<div align="center">

[MIT License](LICENSE) · Not affiliated with Obsidian or Zotero

</div>
