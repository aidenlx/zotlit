# Customize is a chooser between the web Workbench and the Profile Editor

## Current release amendment — 2026-09-08

The current release focuses on the Obsidian Profile Editor. The web Workbench's
beginner workflow is deferred until the template directory and AI-assisted
editing are available. This amends the release scope of
[#1011](https://github.com/aidenlx/zotlit/issues/1011); the chooser described below
remains available behind the build flag.

- The `WEB_WORKBENCH_ENABLED` build flag controls web editor integration and
  defaults to off. Setting `WEB_WORKBENCH_ENABLED=true` enables it for a build.
  With the flag off, Customize opens the Profile Editor directly, including on
  devices with a saved web editor preference or earlier launch approval.
- The Local Server settings and Live Update remain available. The flag hides
  the Local Bridge option, connection controls, web editor menu items and
  commands, and editor-choice preferences. Bridge requests are rejected while
  the flag is off, including when the saved bridge setting is enabled.
- User-facing documentation describes the Profile Editor and omits web
  Workbench and Local Bridge guidance. Internal ADRs, research, and glossary
  entries remain available. Agent Template Workbench CLI guidance remains
  available because it describes a separate feature.
- The web Workbench remains available at `/workbench` by direct URL for
  development feedback. Public links and its sitemap entry are removed, and
  the page is marked `noindex`.

## Original decision

The Local Bridge spec (#998, [ADR 0042](0042-a-workbench-connection-starts-in-obsidian.md)) made Customize the one door to template editing and had it open the web Workbench in a browser. With the Profile Editor ([ADR 0045](0045-the-profile-editor-is-a-dedicated-view-beside-the-markdown-view.md)) Obsidian has an editor of its own, and nobody is to be forced onto the web. Decided in the Profile Editor grilling on map #835 (2026-09-07): Customize opens one chooser sheet with two doors, "Start in the web Workbench", preselected as the recommended start for a first template, and "Edit here in Obsidian". A "Remember my choice" box backs a per-device setting under Advanced, Customize opens: Ask, Web Workbench, or Profile Editor. The file menu and the command palette always carry both doors, whatever the setting says. A Profile that needs Eta or JavaScript skips the sheet and opens the Profile Editor with a Notice, as #998 rules. The way back from the web is "Open in Obsidian": the page puts the document source on the clipboard and opens an `obsidian://zotlit` action that reads the clipboard and lands in the existing import sheet, which then opens the Profile Editor on the written document.

## Considered options

- **Web by default, native only from the file menu**: hides the local editor from the people it is for.
- **A build-time constant**: no user choice, and a release to change one door.
- **A per-device handoff token instead of the clipboard**: the clipboard path works without a Workbench Connection and is the pattern Obsidian Web Clipper users already know.

## Consequences

- The sheet is #998's once-per-device launch sheet with a second radio row; the web door lands when #998 merges, and until then Customize opens the Profile Editor directly.
- The web door's copy names guided editing and sample data now, and gains AI-assisted editing and the template directory when those ship.
