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

While you read in Zotero, start a comment with the word "todo", in any capitals, followed by a space or a colon. In the literature note, that comment becomes a task:

- `todo Check the sample size.` becomes `- [ ] Check the sample size.`
- `TODO: Check the sample size.` becomes the same task.

Every other comment stays exactly as you wrote it, including a comment that only contains a word that starts with "todo", such as "Todorov". When an annotation has no comment, the partial writes nothing.

Obsidian shows the task with a checkbox, and task searches and plugins such as Tasks find it. The task is part of the note that ZotLit refreshes, so a tick you set in Obsidian goes away on the next update. To close a task for good, delete "todo" from the comment in Zotero.

The partial reads one annotation's data and writes only the comment. Use it in your profile's annotation format, the part below `--- zotlit:annotation ---`, in place of `{{ zt.comment }}`:

```liquid
{% render "todo-task" with zt as zt %}
```
