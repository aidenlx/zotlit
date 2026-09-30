---
title: Todo comment as a task
summary: A Zotero comment that starts with "todo" becomes a task you can tick off in Obsidian; every other comment stays as you wrote it.
minAppVersion: "2.2.0-beta.0"
context: annotation
tasks: [general-reading, close-reading, literature-review]
features: [tasks, comments]
problems:
  - I want to mark things to follow up while I read in Zotero.
  - I want my Zotero comments as tasks in Obsidian.
  - I want a to-do list from my annotations.
keywords:
  - todo
  - to-do
  - task
  - checkbox
  - checklist
  - follow up
  - Tasks plugin
  - comment
  - annotation
audience: Readers who note follow-up work in Zotero comments while they read and want those notes as tasks in Obsidian.
effort: Add the partial to your template folder, then use it in place of the comment in your profile's annotation format.
---

Write "todo" in any capitals, then a space or a colon. A comment that starts with a longer word, such as "Todorov", or is only "todo", stays as it is. Task searches and plugins such as Tasks find the task.

The task is in the part of the note that **Update literature note** refreshes, so a tick you set in Obsidian goes away on the next update. When the work is done, delete "todo" from the comment in Zotero.

The partial writes only the comment. In your look, replace each `{{ zt.comment }}` in the annotation format, or in the partial it calls, with the call from **Source**. The **Plain annotation quote** writes the comment in two places.
