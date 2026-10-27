# A. Setup and onboarding: compact abstractions

All paths under `apps/docs/content/docs/`. Message keys written as m.xxx (paraglide).

## Index
| path | title | archetype | lines |
|---|---|---|---|
| (intro)/index.mdx | Introduction | Mixed(landing: pitch + onboarding path + nav) | 68 |
| (intro)/install-zotlit.mdx | Install ZotLit | How-to | 80 |
| (intro)/install-companion.mdx | Install ZotLit Companion | How-to (+short Explanation) | 104 |
| (intro)/install-skill.mdx | Install the ZotLit skill | How-to | 93 |
| (intro)/credits.mdx | Credits | Reference | 36 |
| tutorial/first-note.mdx | Create your first literature note | Tutorial | 138 |
| how-to/keep-zotero-and-obsidian-in-sync.mdx | Keep Zotero and Obsidian in sync | Mixed(How-to + decision Explanation) | 84 |
| how-to/set-up-live-updates.mdx | Set up live updates | How-to | 89 |
| how-to/suppress-zotero-security-prompt.mdx | Suppress the Zotero security prompt | How-to | 87 |
| how-to/_security-prompt-callout.mdx | (partial, no frontmatter) | partial | 5 |
| concepts/how-zotlit-connects-to-zotero.mdx | How ZotLit connects to Zotero | Explanation | 130 |
| how-to/sync-across-devices.mdx | Use ZotLit on multiple devices | How-to | 80 |
| how-to/fix-stale-data.mdx | How to fix Zotero changes that do not appear | How-to (troubleshooting) | 81 |
| how-to/update-obsidian-installer.mdx | How to update the Obsidian installer | How-to | 52 |
| how-to/collect-debug-logs.mdx | Collect debug logs | How-to (four independent procedures) | 248 |

---

## (intro)/index.mdx
- Title: Introduction | Description: Documentation for ZotLit, the Obsidian plugin that integrates Zotero into your knowledge base.
- Archetype: Mixed(landing page: pitch + onboarding path + nav cards)
- Purpose: Orient a new reader, warn v1/2.1 upgraders, route to install -> first note, then optional extras and doc sections.
- Prerequisites stated: none
- Product facts asserted:
  - ZotLit brings Zotero library into Obsidian: browse papers, read PDFs with Zotero highlights, write literature notes and citations without leaving the vault.
  - ZotLit reads the library straight from the Zotero database; no other add-on needed to browse and read papers.
  - v2 has breaking changes vs v1: existing literature notes do not carry over unchanged (notes lose incremental updates until re-created); custom Eta templates need rework.
  - 2.1 literature note templates keep working; ZotLit offers a one-pass conversion folding them into profile documents; until converted only the Default profile creates and updates notes.
  - Companion (Zotero add-on) purpose: recent Zotero changes reach Obsidian; Zotero menus can open notes.
  - Better BibTeX recommended for stable citation keys when citing.
- Steps: 1. Install ZotLit. 2. Open your library (find paper in Library View, read beside library, write first literature note).
- UI labels / commands / settings named: Library View (plain text); Default profile; no typed messages
- Anchors defined: none
- Outbound links: /docs/how-to/migrate-from-v1 ("Migrate from v1"); /docs/how-to/migrate-from-2.1-templates ("Migrate from 2.1 templates"); /docs/install-zotlit ("Install and enable ZotLit in Obsidian."); /docs/tutorial/first-note ("Find a paper in the Library View, read it beside the library, and write your first literature note."); /docs/how-to/keep-zotero-and-obsidian-in-sync ("Keep Zotero and Obsidian in sync"); /docs/how-to/insert-citations#citation-keys ("Install Better BibTeX"); Cards: /docs/how-to ("How-to guides"), /docs/concepts ("Concepts"), /docs/reference ("Reference")
- Images: none
- Code blocks: 0
- MDX components used: Callout warn "Coming from v1?", Callout info "Upgrading from 2.1?", Steps/Step (2), Cards/Card (3: How-to guides "Step-by-step solutions for specific tasks."; Concepts "How ZotLit works and why it works that way."; Reference "Settings, template syntax, and configuration details.")
- Notes: "Install Better BibTeX" link text points at a section of insert-citations, not an install page. No Tutorials card in Browse. install-skill not linked from here. Companion positioned as optional.

## (intro)/install-zotlit.mdx
- Title: Install ZotLit | Description: Install the ZotLit plugin in Obsidian.
- Archetype: How-to
- Purpose: Install and enable ZotLit from community directory (stable) or via BRAT (pre-release).
- Prerequisites stated: Obsidian >= 1.14.2; installer version >= 1.13.4; desktop only.
- Product facts asserted:
  - Desktop-only Obsidian plugin; Windows, macOS, Linux; mobile unsupported.
  - Needs Obsidian 1.14.2+, and installer version 1.13.4+. VERIFY: version numbers. In-app update does not replace the installer. Check in Settings > About. If installer older, ZotLit does not load.
  - Stable channel: Obsidian community plugin directory (https://community.obsidian.md/plugins/zotlit); plugin id zotlit.
  - Pre-release channel: via BRAT (Beta Reviewers Auto-update Tester), installs/auto-updates pre-releases from GitHub repo aidenlx/zotlit; BRAT keeps ZotLit updated, no manual reinstall.
  - Plugin list may need refresh before ZotLit appears in Community plugins after BRAT add.
  - On a new install ZotLit then opens the Zotero library in the Library View.
  - VersionLedger component shows per-channel version (app=obsidian, channel stable / pre-release).
- Steps (Stable): 1. Open plugin listing (link, or Settings > Community plugins > Browse > search "ZotLit", or obsidian://show-plugin?id=zotlit). 2. Click Install then Enable.
- Steps (Pre-release): 1. Install BRAT (obsidian://show-plugin?id=obsidian42-brat) and enable; skip if installed. 2. Add ZotLit to BRAT (obsidian://brat?plugin=aidenlx/zotlit, or command palette "BRAT: Add a beta plugin" and enter aidenlx/zotlit). 3. Settings > Community plugins, enable ZotLit (refresh list if needed).
- UI labels / commands / settings named: Settings > About; Settings > Community plugins; Browse; Install; Enable; BRAT: Add a beta plugin (hard-coded). No typed messages.
- Anchors defined: none (Tabs use id stable / pre-release with updateAnchor)
- Outbound links: /docs/how-to/update-obsidian-installer ("how to update the Obsidian installer"); https://community.obsidian.md/plugins/zotlit ("View ZotLit"); obsidian://show-plugin?id=zotlit ("Show ZotLit in Obsidian"); obsidian://show-plugin?id=obsidian42-brat ("Install BRAT"); obsidian://brat?plugin=aidenlx/zotlit ("Add ZotLit to BRAT"); /docs/tutorial/first-note ("open your library and create your first literature note")
- Images: none
- Code blocks: 0 (inline `aidenlx/zotlit`)
- MDX components used: Callout warn "Update the Obsidian installer first"; Tabs items [Stable, Pre-release] updateAnchor, Tab; VersionLedger x2; ActionLink x3 (kind="obsidian"); Steps/Step
- Notes: Obsidian 1.14.2 duplicated in install-skill; installer 1.13.4 appears nowhere else (update-obsidian-installer gives no number). No mention of Zotero requirement here (Zotero 9+ lives only in concepts page).

## (intro)/install-companion.mdx
- Title: Install ZotLit Companion | Description: Install the ZotLit Companion add-on in Zotero.
- Archetype: How-to (with short Explanation sections)
- Purpose: Download and install the Companion .xpi in Zotero and know the WAL checkpoint setting.
- Prerequisites stated: none explicit (Zotero installed)
- Product facts asserted:
  - Companion keeps recent Zotero changes available to ZotLit and adds ZotLit actions to Zotero menus. ZotLit browses/reads without it.
  - Stable: latest .xpi via XpiDownload component; Firefox users should right-click link and choose `Save Link As...`; releases at GitHub releases page; filename starts with `zt-`.
  - Pre-release: installs auto-update through Zotero as new releases ship on either channel.
  - Install via Zotero Tools > Add-ons > gear menu > Install Add-on From File..., confirm.
  - After install a Zotero prefs pane (m["zotero.prefs_pane_label"]) appears in Zotero settings; nothing needs configuring yet.
  - Companion enables WAL checkpoint (m["zotero.prefs_wal_checkpoint.label"]) by default; lets ZotLit read recent Zotero changes when updating a literature note; keep enabled under database section (m["zotero.prefs_database_section"]) of the pane.
  - Database setting works without live updates. Basic context-menu actions work through protocol links with no extra setup.
  - Live updates: push Zotero changes to Obsidian; need Companion notification setting + ZotLit server in Obsidian; optional; Companion keeps database file current even with live updates disabled.
- Steps (identical in both tabs): 1. Download `.xpi` (XpiDownload channel stable|pre-release). 2. Install in Zotero (Tools > Add-ons). 3. Confirm prefs pane appears.
- UI labels / commands / settings named: Tools > Add-ons; Install Add-on From File...; prefs pane (m["zotero.prefs_pane_label"]); WAL checkpoint (m["zotero.prefs_wal_checkpoint.label"]); database section (m["zotero.prefs_database_section"])
- Anchors defined: none
- Outbound links: /docs/how-to/keep-zotero-and-obsidian-in-sync ("Keep Zotero and Obsidian in sync"); https://github.com/aidenlx/zotlit/releases ("ZotLit releases page", x2); /docs/how-to/set-up-live-updates ("Set up live updates"); /docs/tutorial/first-note ("open your library and create your first literature note")
- Images: none
- Code blocks: 0 (inline `.xpi`, `Save Link As...`, `zt-`)
- MDX components used: Tabs/Tab (updateAnchor), VersionLedger (app=zotero) x2, XpiDownload x2, Steps/Step, UiLabel
- Notes: Step 3 text ("The next section explains when this matters") is a forward pointer to the WAL section. Tab bodies duplicated (3 identical steps twice). No supported Zotero versions stated. Does not say the WAL setting matters mostly on Windows / ext4 (that lives in keep-in-sync). Overlaps keep-in-sync and set-up-live-updates ("About live updates" section).

## (intro)/install-skill.mdx
- Title: Install the ZotLit skill | Description: Install the ZotLit skill in one vault for Claude Code, Codex, or pi.
- Archetype: How-to
- Purpose: Install the ZotLit agent skill into a vault with `npx skills`, verify it, and make a first template request.
- Prerequisites stated: Node.js 18+; Obsidian desktop 1.14.2+; open vault with ZotLit loaded; Obsidian CLI activated (per Obsidian CLI guide).
- Product facts asserted:
  - Skill helps an agent edit and test templates and configure managed frontmatter field templates in one vault.
  - Agent can receive Zotero metadata and annotation text returned by Template Workbench CLI; agent's own data-handling policies apply.
  - Installer run from vault root (folder containing `.obsidian`); command `npx skills@latest add https://zotlit.aidenlx.site/`.
  - Select Project scope (install into current vault); select each agent used (Claude Code, Codex, pi); choose recommended symlink method; decline `find-skills` (unrelated to ZotLit). VERIFY: installer prompt wording.
  - Verification: start agent from vault folder, send "check my current template setup, do not change any files"; agent should use the Template Workbench CLI and report active vault and template setup; template files unchanged.
  - First request example: add Zotero tags below title; agent inspects current template + relevant Zotero data, edits vault template, tests rendered Markdown in memory.
- Steps: 1. Open terminal in vault root. 2. Run npx installer. 3. Select Project scope, agents, symlink. 4. Decline find-skills. Then verify; then first request.
- UI labels / commands / settings named: installer prompts "Project", "No" (hard-coded); Template Workbench CLI
- Anchors defined: none
- Outbound links: https://obsidian.md/help/cli ("Obsidian CLI guide"); /docs/concepts/template-workbench (Card "Template Workbench CLI": How the skill, CLI, and safety boundaries fit together.); /docs/how-to/customize-a-template (Card "Customize a template": Edit a ZotLit template yourself in Obsidian.)
- Images: none
- Code blocks: 1; bash, npx skills@latest add command. Plus two blockquote prompts (copyable agent prompts, not fences).
- MDX components used: Callout warn "Agent data access"; Steps/Step (4); Cards/Card (2)
- Notes: Obsidian 1.14.2 dup with install-zotlit. Only place for agent-skill install; not linked from index.

## (intro)/credits.mdx
- Title: Credits | Description: Credits for the projects and people behind ZotLit.
- Archetype: Reference
- Purpose: Acknowledge inspirations, v1 tutorial authors, and v2 contributors.
- Prerequisites stated: none
- Product facts asserted: names alphabetical, not by contribution amount. Contributors' proposals shipped in v2; most original PRs closed and reimplemented during v2 rewrite. Tutorial authors wrote for ZotLit v1 before docs existed.
- Steps: none
- UI labels: none
- Anchors defined: none
- Outbound links:
  - Inspirations: BibNotes Formatter https://github.com/stefanopagliari/bibnotes; obsidian-citation https://github.com/hans/obsidian-citation-plugin; obsidian-zotero-integration https://github.com/mgmeyers/obsidian-zotero-integration; zotero-plugin-scaffold https://github.com/zotero-plugin-dev/zotero-plugin-scaffold (Zotero devtool hot-reload workflow); obsidian-pandoc-reference-list https://github.com/mgmeyers/obsidian-pandoc-reference-list; PDF++ https://github.com/RyotaUshio/obsidian-pdf-plus (PDF annotation); ZotFlow https://github.com/duanxianpi/zotflow (Zotero PDF reader in Obsidian)
  - Tutorial authors: @FeralFlora https://github.com/FeralFlora -> "ZotLit template walkthrough" https://forum.obsidian.md/t/zotlit-previously-obsidian-zotero-import-templates/56901 (Obsidian Forum); @MichaTarlton https://github.com/MichaTarlton -> "Beginner's set up for AidenLX's Zotero Integration Plugin" https://gist.github.com/MichaTarlton/67c24bfe65bb4cc2c6158e67363a4b45 (Gist)
  - Contributors (PR links https://github.com/aidenlx/zotlit/pull/N; names link github.com/<handle>): Ascarshen #459 (Zotero 8 support and citation-key handling stabilization; merged into v1); DanielRunningen #353, #351 (full-date parsing; bulk create/update of literature notes); OliverDudgeon #433 (related items and relations in templates); theotheo #296 (folder routing by allowing `/` in filenames to specify directories); Tisen-Ray #466 (Zotero 9 support); yukiizumi3 #464 (custom Zotero column showing each item's Obsidian note status)
- Images: none
- Code blocks: 0
- MDX components used: none (no imports)
- Notes: Pure list; link inventory above is the payload.

## tutorial/first-note.mdx
- Title: Create your first literature note | Description: A hands-on walkthrough: open your Zotero library in Obsidian, read a paper beside it, and write a literature note with its metadata and annotations.
- Archetype: Tutorial
- Purpose: Reader goes from installed ZotLit to a literature note (title, Zotero link, annotations) beside the paper's PDF.
- Prerequisites stated: ZotLit installed; Zotero need not be open; DB found automatically from Zotero profile; a paper with annotations made in Zotero PDF reader.
- Product facts asserted:
  - On a new install ZotLit opens Library View in a tab titled m.library_view_name(); else ribbon ZotLit icon or command palette (Ctrl+P / Cmd+P).
  - Setup banner may sit above list; once its connect step (m.welcome_step_connect_title()) done, ZotLit is reading library.
  - If view shows m.library_view_not_found(), select m.library_view_locate() and choose Zotero data folder.
  - Facet button m.library_view_facet_annotated() in buttons below the tree on left filters to annotated papers; search box m.library_view_search_label() filters by title.
  - Clicking a row opens the Reading Card on the right: title, authors, journal; abstract if Zotero has one; annotations with first two quoted, link under them shows all. On narrow pane it opens over the list.
  - Row right-click m.library_view_menu_open_pdf_right() opens PDF in new pane right of library; ZotLit does not copy the file into the vault.
  - Zotero highlights/notes appear on page in same colors; m.annot_view_name() view opens in right sidebar, one card per annotation.
  - Click row again then Ctrl+Enter (Cmd+Enter macOS) writes the literature note and opens it in a new tab in front of the library; PDF stays right. Brief notice m.notice_created_note(). Plain Enter writes same note but opens it in the pane beside the library, replacing the PDF.
  - If asked which profile, choose m.settings_profile_default_name().
  - Note appears in `literatures` folder (default); contains heading with title, link to Zotero item, links to attached files, **Annotations** section; filename defaults to item's citation key.
  - Built from Default profile (built-in; decides note name, folder, properties, body).
  - CHANGED (#1687; "What you are looking at" on next): ZotLit writes this body once, when it creates the note; from then on the body is the user's to edit. The **Annotations** section is a live view (query block), so new highlights appear without an update. A later update refreshes the note's properties and leaves the body as written. No managed-region markers and no child-note list in a new default note. (Old text about `%%zt-managed%%` markers is false for new notes.) Page still links concepts/literature-notes-and-the-managed-region for "more on how this works".
  - NEW (#1626): each annotation the user later inserts into the note links back with a durable `zotero://` link (hover shows the annotation; click opens the PDF in Obsidian). See B open-pdf-in-obsidian.
  - Existing note: row shows it has a literature note; Enter opens existing note, no duplicate. Command m.command_open_lit_note_name() opens any paper's note without library (search for paper).
  - VERIFY (running app): Reading Card layout, setup banner, key bindings, `literatures` default folder, citation-key filename.
- Steps: Open library: 1 Open Library View. 2 Find an annotated paper. 3 Select the paper (Reading Card). Read: 4 Open PDF beside library. 5 See highlights. Write: 6 Ctrl/Cmd+Enter in new tab. 7 See result.
- UI labels / commands / settings named: Library View name (m.library_view_name); Command Open Library View (m.command_open_library_view_name); connect step (m.welcome_step_connect_title); not found (m.library_view_not_found); locate (m.library_view_locate); Annotated facet (m.library_view_facet_annotated); search box (m.library_view_search_label); Open PDF to the right (m.library_view_menu_open_pdf_right); annotation view name (m.annot_view_name); created note notice (m.notice_created_note); Default profile name (m.settings_profile_default_name); Command open literature note (m.command_open_lit_note_name, inline); keys Ctrl+P/Cmd+P, Ctrl+Enter/Cmd+Enter, Enter
- Anchors defined: none
- Outbound links: /docs/install-zotlit ("Install ZotLit"); /docs/concepts/profiles ("profiles"); /docs/concepts/literature-notes-and-the-managed-region ("Literature notes and the managed region"); Cards: /docs/tutorial/customize-template ("Customize your annotations": Edit a template to change how callouts render, then update the note in place. #1687: "update the note in place" no longer re-renders a default note's body; see D tutorial/customize-template CONTRADICTION); /docs/how-to/use-library-view ("Browse your library in the Library View": Every control of the Library View: the tree, Recent, search, filters, the Reading Card, and the row menu.); /docs/how-to/open-pdf-in-obsidian ("Open an item's PDF in Obsidian": Every way to open a paper's PDF in Obsidian, and what you see when it opens.)
- Images: /img/tutorial/first-note-library-view.webp (alt: Library View with Annotated filter on, two papers listed, Reading Card of "Ten Simple Rules for Better Figures" on right with title/authors/journal above Open PDF and Write literature note buttons, first two annotations quoted at bottom); /img/tutorial/first-note-note-beside-pdf.webp (alt: new note rougier2014 in a tab in front of library on left with title heading, Zotero and PDF links, annotations; paper PDF with colored highlights on right; annotation cards in right sidebar)
- Code blocks: 0 (inline keys/paths)
- MDX components used: Callout info "Before you start"; Steps/Step (3 groups, 7 steps); Command (block and inline); UiLabel; Cards/Card (3)
- Notes: Screenshot shows "Open PDF" and "Write literature note" buttons on Reading Card but steps never mention them (use right-click / Ctrl+Enter instead). Includes explanation of managed region and "Opening an existing note" beyond core tutorial. Filename = citation key claim: page does not mention Better BibTeX dependence.

## how-to/keep-zotero-and-obsidian-in-sync.mdx
- Title: Keep Zotero and Obsidian in sync | Description: Install ZotLit Companion so recent Zotero changes reach Obsidian and Zotero's menus can open your notes.
- Archetype: Mixed(How-to + decision Explanation)
- Purpose: Decide whether the Companion is needed on this OS/filesystem, install it, use its menu actions, optionally enable live updates.
- Prerequisites stated: none
- Product facts asserted:
  - Browsing Library View, searching, reading PDF need nothing more than Zotero database.
  - Companion adds three things: keeps Zotero DB file current; adds ZotLit actions to Zotero menus (open/update item's literature note); optional push live updates.
  - On Windows, and Linux filesystems that cannot clone files (e.g. ext4): ZotLit reads only main database `zotero.sqlite`. VERIFY: Zotero 10+ saves each change first to log file `zotero.sqlite-wal` and copies later: when log grows large, when Zotero idle, when Zotero closes. Until then Library View and updated notes can show older data. Companion has Zotero copy changes shortly after each change; install it on these systems. Zotero 9 normally writes straight to main file.
  - On macOS and Linux with cloning (Btrfs, reflink-enabled XFS): ZotLit reads a copy already holding recent changes; Companion skippable unless wanting menu actions or live updates.
  - Zotero settings > Companion pane > Database section: keep WAL checkpoint on; enabled by default on new installs.
  - Zotero right-click item > ZotLit submenu (m["zotero.menu_submenu.label"]): open, update, import literature notes, open item's PDF in Obsidian; via `obsidian://` links; no extra Obsidian setup.
  - Live updates push changes as you read/annotate and let annotation view follow Zotero reader; need Companion + ZotLit server in Obsidian; both off by default.
- Steps: 1. Install add-on (per Install ZotLit Companion). 2. Confirm WAL checkpoint enabled.
- UI labels / commands / settings named: Zotero Tools > Add-ons; prefs pane (m["zotero.prefs_pane_label"]); database section (m["zotero.prefs_database_section"]); WAL checkpoint (m["zotero.prefs_wal_checkpoint.label"]); ZotLit submenu (m["zotero.menu_submenu.label"])
- Anchors defined: [#when] "Check whether you need the Companion"; [#install] "Install the Companion"; [#zotero-actions] "Run ZotLit actions from Zotero"; [#live-updates] "Get changes as they happen (optional)"
- Outbound links: /docs/how-to/use-library-view ("Library View"); /docs/concepts/how-zotlit-connects-to-zotero#reading-the-zotero-database ("How ZotLit connects to Zotero"); /docs/install-companion ("Install ZotLit Companion"); /docs/how-to/keep-notes-updated ("Keep notes up to date"); /docs/reference/protocol-links ("Protocol links"); /docs/how-to/set-up-live-updates ("Set up live updates"); Cards: /docs/how-to/fix-stale-data ("Fix Zotero changes that do not appear": What to do when a Zotero change still does not reach Obsidian.); /docs/install-companion ("Install ZotLit Companion": Download and install the Zotero add-on.); /docs/concepts/how-zotlit-connects-to-zotero ("How ZotLit connects to Zotero": How database reads, Zotero actions, and live updates fit together.)
- Images: none
- Code blocks: 0 (inline file names)
- MDX components used: Callout warn "On Windows, and on Linux with ext4"; Steps/Step (2); Cards (3); UiLabel
- Notes: Read-mode facts duplicated in concepts page; Companion WAL in install-companion and fix-stale-data. This page does not name APFS (concepts does).

## how-to/set-up-live-updates.mdx
- Title: Set up live updates | Description: Enable optional live updates so Zotero pushes changes to Obsidian automatically.
- Archetype: How-to
- Purpose: Enable the ZotLit server in Obsidian and the Companion notify preference in Zotero, then verify with reader-following mode.
- Prerequisites stated: Companion installed (implied; See also card)
- Product facts asserted:
  - Companion pushes changes as you read and annotate; annotation view's reader-following mode and automatic database refreshes depend on this optional connection.
  - Not needed for basic Companion actions (open items/PDFs, update notes, import notes from Zotero context menu): they use protocol links, no server. Live updates only for real-time push (reader-following, instant DB refresh).
  - Obsidian: Zotero settings page (m.settings_page_zotero()) > sync group (m.settings_zotero_sync_heading()): keep live updates (m.settings_live_updates_enabled_name()) on. Local server row (m.settings_advanced_local_server_heading()) has open action (m.settings_zotero_local_server_open()) that opens the local server group on the Advanced page (m.settings_page_advanced()). Enable server (m.settings_local_server_enabled_name()). Default hostname `127.0.0.1` (this computer only). Configured port default **9091**; actual port shown at m.settings_local_server_active_port_name(); ZotLit tries a higher port if configured one busy.
  - Zotero: Edit > Settings (Win/Linux) / Zotero > Settings (macOS) > Companion pane; Notify section (m["zotero.prefs_notify_section"]) check m["zotero.prefs_notify_enable.label"]; set m["zotero.prefs_notify_url"]; default `http://localhost:9091`; use active port (e.g. `http://localhost:9092`); each vault can use a different port.
  - Verify: annotation view mode m.annot_view_mode_zotero_reader(); view starts in m.annot_view_mode_active_tab() mode and keeps last chosen mode; open item in Zotero PDF reader; annotation view updates; if not, check port and hostname match between server settings and Notify URL.
  - Source ID filtering: server accepts requests only from the Zotero install whose profile and data dir match the connected source; others silently ignored; source id displayed read-only as m.settings_db_source_id_name() under Zotero page > location setting (m.settings_page_zotero_location()).
- Steps: Enable server: 1 Open sync settings. 2 Turn on listener. Companion: 3 Open Zotero prefs. 4 Enable notifications. 5 Set Notify URL. Then Verify.
- UI labels / commands / settings named: SettingsPath(m.settings_page_zotero); m.settings_zotero_sync_heading; m.settings_live_updates_enabled_name; m.settings_advanced_local_server_heading; m.settings_zotero_local_server_open; SettingsPath(m.settings_page_advanced); m.settings_local_server_enabled_name; m.settings_local_server_active_port_name; m["zotero.prefs_pane_label"]; m["zotero.prefs_notify_section"]; m["zotero.prefs_notify_enable.label"]; m["zotero.prefs_notify_url"]; m.annot_view_mode_zotero_reader; m.annot_view_mode_active_tab; m.settings_db_source_id_name; SettingsPath(m.settings_page_zotero + m.settings_page_zotero_location)
- Anchors defined: none
- Outbound links: Cards: /docs/install-companion ("Install ZotLit Companion": Install the Zotero add-on that live updates need.); /docs/how-to/use-annotation-view ("Use the annotation view": Browse and drag annotations from the sidebar into your notes.)
- Images: none
- Code blocks: 0
- MDX components used: Callout info "When you do not need this"; Steps/Step (two groups); SettingsPath; UiLabel; Cards (2)
- Notes: Default hostname 127.0.0.1 vs default Notify URL host localhost (consistency to verify). Needs running app: setting names, port fallback.

## how-to/suppress-zotero-security-prompt.mdx
- Title: Suppress the Zotero security prompt | Description: Stop Zotero from showing a confirmation dialog every time it opens an obsidian:// link.
- Archetype: How-to
- Purpose: Add a Zotero Config Editor preference so obsidian:// links open without a confirmation.
- Prerequisites stated: none (Zotero desktop)
- Product facts asserted:
  - Zotero shows a security confirmation each time it opens an `obsidian://` URI (e.g. clicking a backlink in Zotero pointing to an Obsidian note).
  - Distinct from the Zotero permission dialog for annotation editing; answer that with **Always Allow** (see edit-pdf-annotations).
  - Preference `network.protocol-handler.external.obsidian` does not exist by default; searching shows a row for typed name with types Boolean/Number/String; keep Boolean, click **+** (Add); created with value `true`.
  - For prompts from other applications (not from within Zotero): also create `network.protocol-handler.prompt-from-external` (Boolean, +); created as `true`, click **Toggle** to change to `false`.
  - Credit: procedure adapted from zotero-markdb-connect.
- Steps: 1. Zotero Edit > Settings (Win/Linux) / Zotero > Settings (macOS). 2. Advanced pane > Config Editor > Accept the Risk and Continue (opens own window). 3. Search `network.protocol-handler.external.obsidian`. 4. Keep Boolean, click +.
- UI labels / commands / settings named: Edit > Settings / Zotero > Settings; Advanced; Config Editor; Accept the Risk and Continue; Search preference name; Boolean/Number/String; + (Add); Toggle. No typed messages.
- Anchors defined: none
- Outbound links: /docs/how-to/edit-pdf-annotations ("Edit PDF annotations in Obsidian"); https://github.com/daeh/zotero-markdb-connect ("zotero-markdb-connect"); Cards: /docs/how-to/keep-notes-updated ("Keep notes up to date": Update notes in batch from Zotero's context menu.); /docs/how-to/import-zotero-notes ("Import Zotero notes": Re-import notes in batch from Zotero's context menu.); /docs/how-to/explore-template-data ("Explore template data": Open the data explorer from Zotero's context menu.)
- Images: /img/how-to/protocol-choose-app.webp (alt: Zotero security confirmation dialog asking whether to open an obsidian link); /img/how-to/config-editor.webp (alt: Zotero Config Editor showing the new network.protocol-handler.external.obsidian preference set to Boolean)
- Code blocks: 1; plain (no language), the pref name `network.protocol-handler.external.obsidian`
- MDX components used: Steps/Step (4); Callout info x2 ("Links triggered from outside Zotero", "Credit"); Cards (3). The partial is NOT included here.
- Notes: Partial `_security-prompt-callout.mdx` points to this page. Image filename "protocol-choose-app" vs alt text.

## how-to/_security-prompt-callout.mdx
- Title: none (no frontmatter) | Description: none
- Archetype: partial (single Callout)
- Purpose: Reusable info callout saying Zotero may confirm each obsidian:// open, linking to the suppress page.
- Product facts asserted: Zotero may show a confirmation dialog each time it opens an `obsidian://` link.
- Outbound links: /docs/how-to/suppress-zotero-security-prompt ("Suppress the Zotero security prompt")
- MDX components used: Callout type info title "Security prompt in Zotero" (no import in partial; relies on includer's Callout import)
- Included by (via `<include>./_security-prompt-callout.mdx</include>`): how-to/keep-notes-updated.mdx (line 99); how-to/import-zotero-notes.mdx (line 166); how-to/explore-template-data.mdx (line 50). Not included by any page in this group.

## concepts/how-zotlit-connects-to-zotero.mdx
- Title: How ZotLit connects to Zotero | Description: How database reads, Zotero actions, and optional live updates connect Zotero to Obsidian.
- Archetype: Explanation
- Purpose: Explain the three connection kinds (DB read, protocol links, live updates), read modes, per-device paths, and annotation write-back.
- Prerequisites stated: Zotero 9 or later; Zotero 10 or later for editing annotations.
- Product facts asserted:
  - Browsing/reading need only the DB: Library View, search, open PDF work with Zotero closed and no add-on.
  - Supports Zotero 9+. Saving annotation edits from Obsidian needs Zotero 10+; with Zotero 9 read-only for PDFs/annotations.
  - Zotero can keep recent changes in a separate DB file (WAL) while running.
  - Read mode default m.settings_db_read_mode_auto(): tries reflink on macOS/Linux; uses clone on APFS, Btrfs, reflink-enabled XFS; on Windows and other filesystems (e.g. ext4) falls back to immutable. Overridable in Settings.
  - Reflink (m.settings_db_read_mode_reflink()): fast lightweight snapshot, sees recent edits.
  - Immutable (m.settings_db_read_mode_immutable()): reads main DB file directly, no copy; recent edits can stay in write-ahead log until Zotero writes them to main file.
  - Copy (m.settings_db_read_mode_copy()): any filesystem, sees recent edits, copies entire DB each time (slower, more disk, esp. large libraries); auto never selects it; choose manually if others unavailable.
  - Companion keeps main DB file current by writing recent changes into it (WAL checkpoint m["zotero.prefs_wal_checkpoint.label"], default on, works without live updates).
  - Per-device path resolution: profile dir and data dir are absolute paths that differ per computer; auto-detects default Zotero profile (from `profiles.ini`) and data dir; non-default location needs a Device Override on that device only; stored locally (per vault, per device), never syncs through the vault.
  - Companion: context-menu actions (open/update/import notes, open item's PDF in Obsidian); can push live events. Zotero WAL holds recent changes before writing to main file; Companion tells Zotero to write them after Zotero updates library; default on; no server needed.
  - Companion runs no background server; actions build `obsidian://zotlit/...` links handed to the OS, routed to Obsidian; no Obsidian server/listener needed.
  - Protocol links work out of the box after installing ZotLit + Companion; carry a source identifier so ZotLit processes only links from expected Zotero install.
  - Batch actions (many items) may exceed URL length limit; Companion falls back to an HTTP request to ZotLit server; if server not enabled, Zotero shows a notice asking to enable it or select fewer items.
  - Live updates: Companion sends HTTP notifications as you read/annotate in Zotero PDF reader (powers annotation view reader-following mode); after finishing DB work it also sends a payload-free refresh signal. DB checkpoint works independently; live updates add only the refresh signal.
  - Live updates need: Obsidian ZotLit server (local HTTP listener, port 9091 default) with m.settings_live_updates_enabled_name() on; Zotero Companion notify preference pointed at same address.
  - Both sides carry source identifier + protocol version; server discards requests from unrecognized Zotero installs (source mismatch) and rejects incompatible protocol version.
  - Both server and notify preference disabled by default; protocol links handle all context-menu actions without them.
  - Annotation write-back: DB connection read-only; edits sent to Zotero via Zotero's local API while Zotero running; saved like a reader annotation; syncs with Zotero library. Needs (a) Zotero Settings -> Advanced "Allow other applications on this computer to communicate with Zotero" on; (b) first time, Zotero permission dialog, choose **Always Allow** once; permission saved per vault per device. Does not use protocol links or ZotLit server.
  - Summary: ZotLit can read DB while Zotero closed; install Companion to keep data current, esp. in immutable mode; protocol links and live updates depend on Companion.
- Steps: none
- UI labels / commands / settings named: m.settings_db_read_mode_auto / _reflink / _immutable / _copy; m["zotero.prefs_wal_checkpoint.label"]; m.settings_live_updates_enabled_name; "Allow other applications on this computer to communicate with Zotero" (hard-coded, Settings -> Advanced); Always Allow
- Anchors defined: [#reading-the-zotero-database] "Reading the Zotero database". Other headings: Per-device path resolution (h3), ZotLit Companion, Protocol links versus live updates (with h3 "Protocol links (no server required)" and "Live updates (server required)"), Saving annotation changes to Zotero, How the pieces fit together.
- Outbound links: /docs/how-to/set-up-live-updates ("live updates"; Card "Set up live updates": Enable the server and Companion notification setting step by step.); /docs/reference/settings ("Settings reference"); /docs/how-to/sync-across-devices ("Use ZotLit on multiple devices"); /docs/how-to/edit-pdf-annotations ("Edit PDF annotations in Obsidian"); /docs/how-to/keep-zotero-and-obsidian-in-sync ("Keep Zotero and Obsidian in sync"); Cards: /docs/how-to/fix-stale-data ("Fix Zotero changes that do not appear": What to do when changes in Zotero don't appear in ZotLit.); /docs/install-companion ("Install ZotLit Companion": Download and install the Zotero add-on.); /docs/concepts/literature-notes-and-the-managed-region ("Literature notes and the managed region": How ZotLit separates your writing from generated content.)
- Images: none
- Code blocks: 0 (inline `profiles.ini`, `obsidian://zotlit/...`)
- MDX components used: Callout info x2 ("Batch actions and the URL length limit", "Off by default"); Cards (4); UiLabel
- Notes: Heavy overlap with keep-in-sync (read modes, WAL), set-up-live-updates (port, off by default, source ID), sync-across-devices (per-device paths), and edit-pdf-annotations (write-back). Companion section says it "can push live events" yet "does not run a background server" (server is Obsidian's). Zotero 10 WAL change specific to keep-in-sync; here only generic WAL wording. Managed-region card in See also is unrelated to page topic.

## how-to/sync-across-devices.mdx
- Title: Use ZotLit on multiple devices | Description: Set different Zotero profile or data directory paths on each computer when syncing a vault across devices.
- Archetype: How-to
- Purpose: Configure per-device Zotero profile/data dir overrides when a vault syncs across computers; recover when a device cannot find Zotero.
- Prerequisites stated: vault synced between computers.
- Product facts asserted:
  - Profile path and data dir path stored per device; one machine's path never overwrites another's via vault sync.
  - Annotation-edit permission also saved per device; on each computer allow once and choose **Always Allow** (see edit-pdf-annotations).
  - Default install: auto-detects profile (from `profiles.ini`) and data directory; freshly synced vault connects with no setup; nothing to configure if all machines use default.
  - Non-default: on that device open Zotero settings page > location setting; m.settings_db_profile_dir_name() picker for profile dir; m.settings_db_data_dir_name() picker for data dir override (skip profile step if only data dir changes). Paths apply to this device only; other devices keep own or auto-detect.
  - Clearing a Device Override: reset picker to default value; auto-detect resumes on that device.
  - Unresolved new device (non-default Zotero, no override): Library View shows m.library_view_not_found() and offers m.library_view_locate(); with no Library View open, a notice m.notice_db_not_found_on_device() with action m.notice_db_not_found_action() opens Library View. One such notice at a time; goes away once DB readable; shows on every launch while unresolved; not shown when auto-detect succeeds or a working Device Override is set.
- Steps: 1. Open Zotero settings (location). 2. Set Zotero profile. 3. Set data directory override if needed.
- UI labels / commands / settings named: SettingsPath(m.settings_page_zotero + m.settings_page_zotero_location); m.settings_db_profile_dir_name; m.settings_db_data_dir_name; m.library_view_not_found; m.library_view_locate; m.notice_db_not_found_on_device; m.notice_db_not_found_action; term Device Override
- Anchors defined: none
- Outbound links: /docs/how-to/edit-pdf-annotations ("Edit PDF annotations in Obsidian"); /docs/how-to/use-library-view#not-found ("Library View"); Cards: /docs/concepts/how-zotlit-connects-to-zotero ("How ZotLit connects to Zotero": How ZotLit locates and reads the Zotero database, and why paths are per device.); /docs/reference/settings ("Settings": template-literal description "Full reference for every ZotLit setting, including the ${m.settings_page_zotero()} page.")
- Images: none
- Code blocks: 0
- MDX components used: Callout info "Clearing a Device Override"; Steps/Step (3); SettingsPath; UiLabel; Cards (2)
- Notes: Duplicates concepts "Per-device path resolution". Depends on anchor `#not-found` in use-library-view. Needs running app: notice behaviour.

## how-to/fix-stale-data.mdx
- Title: How to fix Zotero changes that do not appear | Description: Update your connection when Zotero changes do not appear in a literature note.
- Archetype: How-to (troubleshooting)
- Purpose: Escalating procedure when Zotero changes do not show up after updating a literature note.
- Prerequisites stated: none
- Product facts asserted:
  - Companion keeps recent Zotero changes available; install/update it.
  - Zotero Edit -> Settings (Win/Linux) / Zotero -> Settings (macOS) > Companion pane (m["zotero.prefs_pane_label"]); Database section (m["zotero.prefs_database_section"]); enable WAL checkpoint (m["zotero.prefs_wal_checkpoint.label"]); default on for new installs.
  - Zotero item pane: select database status control (m["zotero.database_status.tooltiptext"]) beside **Locate**; if m["zotero.database_status_write_now"] available, select it; makes recent changes available immediately.
  - Obsidian: run Update note command (m.command_update_note_name); if still old, run Refresh database command (m.command_refresh_db_name), then update note again. STALE on next (#1687 did not edit this page): for a default-template note, Update refreshes properties only; the Annotations query block reads Zotero live, so a missing annotation there is a database-freshness problem (Write now / Refresh database), not something Update fixes. Body text written at creation never changes on update.
  - Last resort: Zotero page > location setting; set m.settings_db_read_mode_name() to m.settings_db_read_mode_copy() ("Full copy" in heading); refresh DB; update note. Copy mode copies entire DB on every refresh; large libraries slower, more disk.
  - If copy also fails: collect debug logs; file bug report in GitHub discussions with ZotLit version, OS, reproduction steps.
  - VERIFY (running app): Zotero item-pane status control and Write now item.
- Steps: 1 Install/update Companion. 2 Confirm Companion setting. 3 Make recent changes available (Write now). 4 Update literature note. 5 Refresh ZotLit. Then Advanced: Full copy. Then report.
- UI labels / commands / settings named: m["zotero.prefs_pane_label"]; m["zotero.prefs_database_section"]; m["zotero.prefs_wal_checkpoint.label"]; m["zotero.database_status.tooltiptext"]; m["zotero.database_status_write_now"]; Locate (hard-coded); Command m.command_update_note_name (inline); Command m.command_refresh_db_name (inline); SettingsPath(m.settings_page_zotero + m.settings_page_zotero_location); m.settings_db_read_mode_name; m.settings_db_read_mode_copy
- Anchors defined: [#read-mode] "Advanced: Use Full copy as a last resort"
- Outbound links: /docs/install-companion ("Install the latest Companion"; Card "Install ZotLit Companion": Install or update the Zotero add-on.); /docs/how-to/collect-debug-logs ("collect debug logs"); https://github.com/aidenlx/zotlit/discussions/new?category=bug-reports ("file a bug report"); Card /docs/concepts/how-zotlit-connects-to-zotero ("How ZotLit connects to Zotero": Learn how the Companion and ZotLit read modes work together.)
- Images: none
- Code blocks: 0
- MDX components used: Steps/Step (5); Command inline x2; SettingsPath; UiLabel; Cards (2)
- Notes: Bug report URL here is /discussions/new?category=bug-reports while collect-debug-logs uses /discussions/categories/bug-reports. Heading says "Full copy"; actual label is m.settings_db_read_mode_copy. Does not explain Windows/ext4 or Zotero 10 WAL context.

## how-to/update-obsidian-installer.mdx
- Title: How to update the Obsidian installer | Description: Update Obsidian's bundled Electron version when ZotLit asks you to run the latest installer, or when ZotLit does not load with a SyntaxError.
- Archetype: How-to
- Purpose: Run the current Obsidian installer over the existing install so ZotLit loads.
- Prerequisites stated: none
- Product facts asserted:
  - Triggers: persistent notice "Update Obsidian to use ZotLit" (bold, hard-coded), or ZotLit fails to load: Obsidian shows `Failed to load plugin "zotlit"` and dev console shows `SyntaxError`.
  - Obsidian automatic updates update app version but cannot replace bundled Electron; ZotLit needs newer Electron; installer update = download and run current installer over existing install.
  - No need to uninstall Obsidian first.
  - Install in the same location as current Obsidian.
  - After: ZotLit enables without the installer update notice.
- Steps: 1. Download installer (notice action m.notice_installer_update_download, or obsidian.md/download; pick OS). 2. Close every Obsidian window, wait for exit. 3. Run installer in same location. 4. Reopen Obsidian; Settings > Community plugins; Enable ZotLit.
- UI labels / commands / settings named: notice "Update Obsidian to use ZotLit"; m.notice_installer_update_download; Settings > Community plugins; Enable; Failed to load plugin "zotlit"
- Anchors defined: none
- Outbound links: https://obsidian.md/download ("Obsidian download page"); https://obsidian.md/help/updates#installer-updates ("installer update guide", Obsidian Help)
- Images: none
- Code blocks: 0
- MDX components used: Callout info "Keep your current installation"; Steps/Step (4); UiLabel
- Notes: No minimum installer/Electron version here (1.13.4 only in install-zotlit). No per-OS instructions. Notice wording in bold is hard-coded and may differ from actual message.

## how-to/collect-debug-logs.mdx
- Title: Collect debug logs | Description: Gather a template error report, ZotLit logs, Zotero debug output, and Obsidian debug info to include when reporting a bug.
- Archetype: How-to (four-plus independent procedures)
- Purpose: Collect the right evidence for a bug report; each section self-contained.
- Prerequisites stated: none
- Product facts asserted:
  - Report to Bug reports discussion.
  - Cross-component bugs (syncing, live update, importing, any action relying on Zotero running) need setup of BOTH ZotLit logs and Zotero debug output before reproducing; reproduce once, save both.
  - Template error report (for Template Workbench preview failure): contents = engine message, error name, causes, source excerpt, engine-named location, time of failure, whether automatic check or Run (m.workbench_preview_run) started it, template doc and section, template language, preview root and options, selected item/example, source revision, ZotLit and Obsidian versions; unknown values read `unavailable`. Nothing leaves vault until user pastes. Technical disclosure (m.workbench_problems_technical) shows same text. Report describes the failed attempt; later edits or different selected item do not change it; after a successful repair, open Problems area offers m.workbench_problems_copy_last. Community button (m.workbench_problems_community) opens /community page and sends nothing.
  - Add more evidence: ZotLit logs (no engine message, or failure while creating/updating a note), Template data (rendered without failing but wrong content), Obsidian debug info (other plugin/theme/build). Copied report never carries log archive or template-data export.
  - Obsidian debug info: command palette "Show debug info" (hard-coded), copy output.
  - ZotLit logs: Advanced page > Logging group; log level -> **debug**; log to file on; appends to `zotlit.log.jsonl` in plugin folder; Export action exports log file; attach archive. Afterwards: level back to **info**, log-to-file off.
  - Template data: open Template Data Explorer on the item; for annotation template, annotation node more-options menu > m.workbench_explorer_menu_explore_annotation; explorer tab more-options menu > m.template_data_explorer_menu_export_json; downloads file like `zotlit-template-data-ABCD2345-20260512-143000.json`; always whole current root (full note template data at note root, or annotation's data when anchored); explorer filter does not narrow. File contains library metadata for item, absolute attachment paths in Zotero data folder, Zotero account username: review before public attach. Explorer never writes files into vault, so helpers (annotation excerpt images, imported child notes) yield placeholder markers: `$inert` entries; helpers appear as `$helper`; both expected. CONTRADICTION (#1687 code vs this page on next, callout "Placeholder markers are expected"): packages/workbench/src/explorer/inert-resolvers.ts now resolves a child note's `noteLink` to the imported file if one exists, else to a `zotero://` link that opens the note in Zotero; no `$inert` placeholder for child notes. Excerpt images still use the placeholder. Teach only the excerpt-image case.
  - Zotero debug output: Companion pane logging level (m["zotero.prefs_logging_level"]) -> m["zotero.prefs_log_level_debug.label"]; Help > Debug Output Logging > Restart with Logging Enabled...; do NOT choose Restart in Troubleshooting Mode (disables all add-ons incl. Companion); reproduce immediately after restart; Help > Debug Output Logging > View Output; File > Save..., Format Text Files; do NOT use Submit Output or Copy to Clipboard (full log file needed); attach; reset log level to previous value afterwards.
- Steps (per section): Template error report 3 (open problem, copy, paste); Obsidian debug info 2; ZotLit logs 5 (open Advanced, debug+file, reproduce, export archive, upload); Template data 4 (open explorer, anchor at annotation, save, upload); Zotero debug output 6 (set level, restart with logging, reproduce, open viewer, save, upload).
- UI labels / commands / settings named: m.workbench_problem_show; m.workbench_problems_heading; m.workbench_problems_copy; m.workbench_problems_technical; m.workbench_preview_run; m.workbench_problems_copy_last; m.workbench_problems_community; Command "Show debug info" (hard-coded inline); SettingsPath(m.settings_page_advanced); m.settings_advanced_logging_heading; m.settings_log_level_name; m.settings_log_to_file_name; m.settings_log_export_name; m.workbench_explorer_menu_explore_annotation; m.template_data_explorer_menu_export_json; m["zotero.prefs_pane_label"]; m["zotero.prefs_logging_level"]; m["zotero.prefs_log_level_debug.label"]; Zotero: Edit > Settings / Zotero > Settings, Help > Debug Output Logging, Restart with Logging Enabled…, View Output, File > Save…, Text Files, Submit Output, Copy to Clipboard, Restart in Troubleshooting Mode
- Anchors defined: [#template-error-report] "Template error report"; [#obsidian-debug-info] "Obsidian debug info"; [#template-data] "Template data". Implicit slugs linked: #zotlit-logs ("ZotLit logs"), #zotero-debug-output ("Zotero debug output").
- Outbound links: https://github.com/aidenlx/zotlit/discussions/categories/bug-reports ("Bug reports discussion"); #zotlit-logs; #zotero-debug-output; #template-data; #obsidian-debug-info; /community ("community page"; Card "Community": Where to file a bug report or ask a question.); /docs/how-to/explore-template-data ("Open the Template Data Explorer"); Card /docs/reference/settings ("Settings": template-literal "Full reference for every ZotLit setting, including ${m.settings_page_advanced()}.")
- Images: none
- Code blocks: 0 (inline `unavailable`, `zotlit.log.jsonl`, `$inert`, `$helper`, sample filename)
- MDX components used: Callout warn x3 (cross-component bugs; read file before sharing; do not use troubleshooting mode); Callout info x5 (report survives repair; ask community; turn logging back off; placeholder markers; reset log level); Steps/Step; Command (inline); SettingsPath; UiLabel; Cards (2)
- Notes: Longest page. Section order: template error report, Obsidian debug info, ZotLit logs, template data, Zotero debug output. Bug report URL differs from fix-stale-data. Needs running app: log file location, Zotero Debug Output menu names.

---

## Cross-page notes (for synthesis)
- Duplicated: Obsidian 1.14.2 (install-zotlit, install-skill); read-mode/WAL explanation (keep-in-sync, concepts, install-companion, fix-stale-data); live-updates summary (install-companion, keep-in-sync, concepts, set-up-live-updates); per-device paths (concepts, sync-across-devices); Zotero Settings path "Edit > Settings / Zotero > Settings" repeated in 4 pages; Always Allow (suppress, concepts, sync-across-devices).
- Bug-report URL variants: /discussions/new?category=bug-reports (fix-stale-data) vs /discussions/categories/bug-reports (collect-debug-logs).
- Version facts to verify: Obsidian 1.14.2, installer 1.13.4, Zotero 9+ (read), Zotero 10+ (WAL change and annotation write-back).
- Anchors referenced by others: concepts#reading-the-zotero-database (from keep-in-sync), use-library-view#not-found (from sync-across-devices), insert-citations#citation-keys (from index). Defined in this group: keep-in-sync #when/#install/#zotero-actions/#live-updates; fix-stale-data #read-mode; collect-debug-logs #template-error-report/#obsidian-debug-info/#template-data; concepts #reading-the-zotero-database.
- Link targets outside group that must keep working: migrate-from-v1, migrate-from-2.1-templates, insert-citations, use-library-view, keep-notes-updated, import-zotero-notes, explore-template-data, edit-pdf-annotations, customize-a-template, tutorial/customize-template, open-pdf-in-obsidian, use-annotation-view, concepts/profiles, concepts/literature-notes-and-the-managed-region, concepts/template-workbench, reference/settings, reference/protocol-links, /community, /docs/how-to, /docs/concepts, /docs/reference.
- Security-prompt partial is included only by keep-notes-updated, import-zotero-notes, explore-template-data (not by the suppress page itself).
