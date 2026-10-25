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
