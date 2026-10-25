---
title: Note path collisions
---
# Note path collisions

This page checks what ZotLit does when a new note's path is already taken.
ZotLit looks for the path in Obsidian's vault cache before it creates the
note. The lookup is case-sensitive, so a file whose name differs only in
case is not found there. On a disk that ignores case (the default on macOS
and Windows), Obsidian then refuses the create, and ZotLit reports an error.

Run each case in a fresh Fixture Vault (`pnpm fixture open --purge`) with
the Scope Case `all`. Delete the notes a case creates before the next case.

## Import skips an existing note

1. Run **Import all child and standalone notes**.
2. In the confirmation modal, find the row for "Standalone personal note".
   Copy the path it shows, such as
   `zotero_notes/Standalone_personal_note_aB3dE9.md`.
3. Keep the modal open. Outside Obsidian (in Finder, Explorer or a
   terminal), create a file at exactly that path in the vault folder, with
   the text `Mine`. For example:
   `printf Mine > "zotero_notes/Standalone_personal_note_aB3dE9.md"`.
4. Wait until the file shows in the file explorer behind the modal. Then
   select **Import notes**.

Expected: the summary counts that note as skipped. The note you created
still holds only `Mine`. No second file for "Standalone personal note"
appears in `zotero_notes/`.

## Import beside a note that differs only in case

Do the steps above, but in step 3 change the case of one letter of the
file name, for example `zotero_notes/standalone_personal_note_aB3dE9.md`.

Expected on macOS and Windows: the import of that note fails, the summary
counts it as failed, and the note you created still holds only `Mine`.
Earlier builds counted this note as skipped.

Expected on Linux: the import creates the note at the path the modal
showed, beside your note.

## New Literature Note takes a suffix

1. Create a plain note `literatures/sharedReadingAlpha2023.md` with the
   text `Mine`. It has no `zotero-key` property, so it is not a Literature
   Note.
2. Run **Open literature note quick switcher**, search for "Alpha of the
   shared reading group", and select it to create its Literature Note.

Expected: ZotLit creates `literatures/sharedReadingAlpha2023_XXXXXX.md`,
where `XXXXXX` is six random letters and digits, and opens it. The plain
note still holds only `Mine`.

## New Literature Note beside a note that differs only in case

Do the steps above, but in step 1 name the plain note
`literatures/SharedReadingAlpha2023.md`.

Expected on macOS and Windows: the create fails with a notice, and no new
note appears. The plain note still holds only `Mine`. Earlier builds
created the note with a suffix.

Expected on Linux: ZotLit creates `literatures/sharedReadingAlpha2023.md`
beside the plain note.

## New Profile takes a second name

1. Outside Obsidian, create `templates/zotlit-profile.fieldwork.md` with the
   text `Mine`.
2. In **Settings → Profiles**, select **Add profile**, enter the name
   `Fieldwork`, and create it.

Expected: ZotLit writes the new Profile to
`templates/zotlit-profile.fieldwork-<id>.md`, where `<id>` is the Profile's
12-character ID. Your file still holds only `Mine`.

## New Profile beside a file that differs only in case

Do the steps above, but in step 1 name the file
`templates/zotlit-profile.Fieldwork.md`.

Expected on macOS and Windows: creating the Profile fails with an error, and
no Profile named Fieldwork appears. Your file still holds only `Mine`.
Earlier builds wrote the Profile under the second name.

Expected on Linux: ZotLit writes `templates/zotlit-profile.fieldwork.md`.

## Profile import keeps a partial that appeared during the import

1. Run **Import profile…** and choose
   `profile-examples/profile-import-partials.md`. The sheet says it unpacks
   `reading-log`.
2. Keep the sheet open. Outside Obsidian, create
   `templates/zotlit-partial.reading-log.md` with the text `Mine`. Wait until
   it shows in the file explorer.
3. Select **Import profile**.

Expected: the import completes. `templates/zotlit-partial.reading-log.md`
still holds only `Mine`.

## Profile import beside a partial that differs only in case

Do the steps above, but in step 2 name the file
`templates/zotlit-partial.Reading-log.md`.

Expected on macOS and Windows: the import fails with an error, and your file
still holds only `Mine`. Earlier builds kept your file and completed the
import.

Expected on Linux: the import writes `templates/zotlit-partial.reading-log.md`
beside your file.

## Profile import refuses when its file appeared during the import

1. Run **Import profile…** and choose
   `profile-examples/profile-import-replacement-v1.md`. The sheet names one
   profile file, such as `templates/zotlit-profile.reading-import.md`.
2. Keep the sheet open. Outside Obsidian, create a file at exactly that path
   with the text `Mine`. Wait until it shows in the file explorer.
3. Select **Import profile**.

Expected: the import fails with "The profile files changed while this sheet
was open; reopen the import to review the current files." Your file still
holds only `Mine`.

## Profile import beside a file that differs only in case

Do the steps above, but in step 2 change the case of one letter of the file
name, for example `templates/zotlit-profile.Reading-import.md`.

Expected on macOS and Windows: the import fails with an error other than
"The profile files changed…", and your file still holds only `Mine`. Earlier
builds showed "The profile files changed…".

Expected on Linux: the import writes the Profile at the path the sheet named.

## Cases this page does not run

- **Eject the Default beside a file that differs only in case.** The outcome
  did not change: with `templates/Zotlit-profile.default.md` in place, the
  eject fails on macOS and Windows, as it did before.
- **Save the Default where its document path is taken.** ZotLit refuses the
  save as "document exists". It is reached only when a save from the web
  Template Workbench races a file that lands at the Default's document path,
  which a tester cannot time by hand. Service tests cover it
  (`profile/service.test.ts`, "refuses to save the Default where a folder
  holds its document path").
