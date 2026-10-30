# UI seams

Functional core, imperative shell — logic returns data and publishes events;
the seam owns rendering. Effect code shows notices through the `Notifier`
service (`lib/notifier.ts`: `show`, `reportOutcome`, `reportProgress`).
A Promise edge with no Notifier uses `BaseNotice` (`@/lib/notice`) or
`toast.promise` (`@/lib/toast`). Unload silence follows `unload.md`.

Conditional flows decide when to show UI; a dedicated function at the seam
owns what to render and stays callable independently of the trigger. This also
lets `/obsidian-debug` inspect the UI without falsifying trigger state.

Reach for the lowest rung that fits:

1. A function returns the outcome; the caller renders it
   (`services/note-import/batch-import-notices.ts`).
2. A service publishes on its `changes` Stream; a notices layer shows each
   event (`services/note-feature/notices.ts`).
3. A decision tag, only when the user's answer feeds back mid-flow: it
   answers a typed value, a dismissal included (`awaitConfirm`,
   `lib/confirm.ts`). Work that a dialog's callbacks started stops with
   `UserCancelled` (`lib/user-cancel.ts`) when the user closes the dialog
   (`runDialog`, `setting-tab/profile-dialogs.ts`); unload stops it as an
   interrupt (`unload.md`).

Tests observe the core: returns, events, and decision answers. Only a test of
notice behavior itself checks Notifier calls through `testNotifier()` /
`layerSignalling` (`lib/__fixtures__/notifier.ts`): the Notifier, a notices
layer, a function that renders an outcome. A test that needs a notice to see
what its module did marks a module to reshape onto a rung above. A test that
would mock `@/lib/notice` or `@/lib/toast` marks a module to move behind the
Notifier; lint rule `zotlit-effect-tests/no-notice-mock` enforces this.
