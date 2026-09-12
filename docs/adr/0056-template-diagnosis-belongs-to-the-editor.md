---
status: accepted
---

# Template diagnosis belongs to the editor

> Amended 2026-09-13: a repair location is verified by one rule — the source
> this render read holds a call naming the template the engine blamed, or the
> partial it could not resolve. That call is the repair target and outranks the
> part the failure was reported under, because a failure inside a called
> template is repaired where it was called. A template the engine never
> resolved gets no reported location at all, since nothing was read there, and
> a caller is recorded only when the failure names a document path rather than
> a placeholder reference. Everything else leaves the repair location absent
> and says so.

> Amended 2026-09-13: the Problems area keeps one host repair control, Unpack
> partials for the `bundled-partial` document problem. That control is the only
> route to unpacking a shared Profile's carried partials, and it repairs the
> document the reader already has open rather than creating a template the
> reader has not asked for. Every render diagnosis keeps text suggestions
> alone. Remove the control here once an ordinary editor or settings workflow
> offers unpacking.

> Amended 2026-09-13: the scheduler's hold carried two conditions under one
> sentence — a document the parser refuses, and a preview that is paused or
> cannot render yet. They are separate inputs now. A document that does not
> parse is a failure: it takes the retained-preview sentence and offers Show
> problem, the same as a render that failed. Every other hold keeps its
> established wording, as do the on-demand wait and the pending live check.
> One sentence over both causes was the wrong-cause failure the design guide
> names.

The citation-template walkthrough showed a missing partial's name,
explanation, and two recovery actions squeezed into one source-line widget.
The preview repeated the failure. Researchers need room to read an
explanation and choose a repair while they edit the template.

The editor owns a dedicated Problems area for detailed template diagnosis
and repair suggestions. Source locations carry short markers that open the
corresponding problem. The preview names the effect on its result and links
to that same explanation. This keeps diagnosis available when the editor is
open without a preview pane and gives detailed guidance a stable home outside
the source text. The same responsibility applies to both hosts.

Expansion follows the reader's action. Automatic previews show a compact
problem summary while preserving editor focus, cursor, and scroll. Selecting
Show problem or a source marker, a failed explicit Run, and opening the
Workbench from a failed note operation expand the explanation. Later
automatic results preserve the reader's open or collapsed choice. A template
can be temporarily invalid while the reader types; this behavior keeps that
editing stable and provides immediate guidance after a deliberate failed
attempt.

Diagnosis leads with a plain explanation and a text suggestion for what to
check or change. Readers make repairs through the normal editor and settings;
diagnostic controls serve navigation, disclosure, and reporting. This keeps
the Problems area simple and avoids a second set of editing workflows.
The repair location is separate from the engine's reported location: the
walkthrough's Citation text error was caused by the data supplied from its
calling note. Specific suggestions and navigation use verified causes and
targets. Unknown failures get a plain fallback explanation with their
original evidence; unavailable locations are stated explicitly.
Technical details start collapsed, with Copy error report available beside
the disclosure.

The copied report preserves the original engine message and available error
name, stack, causes, source excerpt, and reported location. It captures the
caller and repair target separately, together with the failure time, trigger,
Template Document and section, template language, rendering root and options,
selected Item/Annotation/example reference, and available ZotLit, host, and
engine versions. Unavailable fields are marked explicitly. It remains tied
to that attempt while the reader edits or changes the selection.
Technical details shows the exact report text. Copy error report remains
available while that disclosure is collapsed. This gives
issue investigation the original evidence while researchers can work from
the plain explanation. Ask the community links to the existing community
page beside Copy error report, giving the reader a direct route to help.
The copied report remains suitable for the existing debug-log collection
workflow. Full logs and template-data exports remain separate, explicit
collection steps. The debug-log guide explains the copy action when it ships.
The report is a bounded local record for inspection and manual sharing.

Preview failures retain the last successful output for the same template
and preview selection, labeled Showing the last successful preview. A change
to the selected Item, Annotation, example, root, caller Profile, mode, or
variant shows Preview unavailable when the retained output no longer matches.
This gives the researcher a useful comparison while repairing source and
keeps output from another preview selection out of that comparison. The rule
applies to runtime failures as well as document-parse failures.

The area shows one full explanation at a time with a selector for detected
problems. Occurrences group when their cause and repair target match; equal
message text alone does not establish this. Counts name the problems found,
including when a parser can only report its first error. Automatic checks
preserve the selected problem. If it resolves while others remain, its resolved
state offers Next problem so the reader controls the change of explanation.

Source and Problems share the editor while both remain readable, with Expand
available on request. CSS container rules give Problems the full editor in
short or narrow panes. Return to template restores the source position.
Reporting controls stay outside the scrolling explanation, and long labels
wrap to keep them reachable.

Edits await the next automatic check, or Run in on-demand mode. Only a
successful applicable check clears the failure and publishes new output;
superseded or abandoned attempts cannot replace the current result or report.
An open Problems area keeps its size and shows No problems found in this
preview until the reader returns to the template or collapses it. The
inspected failure remains available as Copy last error report. A collapsed
area clears its warning and stays collapsed after success.

## Considered options

- **Detailed guidance in the preview:** meets the researcher where they
  inspect the result, but competes with that result and needs another route
  when the preview pane is closed.
- **An expanded block below the source line:** keeps one local error close
  to its source, but moves source text as problems appear and becomes harder
  to follow with repeated errors or errors in another template file.
- **Expand on every detected problem:** makes each explanation visible,
  but temporary editing errors repeatedly change the available source space.
- **Expand only on request:** gives the reader full control of space,
  but adds a step after an explicit failed attempt.
- **Engine message first:** gives template experts the original detail
  immediately, but asks other researchers to translate it into a repair.
- **Copy only the friendly explanation:** produces a short report, but
  loses the engine evidence and failed-attempt context needed to investigate.
- **Clear the preview on every failure:** makes the failed state
  unambiguous, but removes the last working output during a repair.
- **Repair buttons inside Problems:** shorten some fixes, but duplicate
  editor and settings workflows and add mutation handling to diagnosis.
- **Expand every problem:** exposes all explanations at once, but competes
  for reading space. One selected explanation leaves room for suggestions.
- **Keep a split at every size or collapse it automatically on success:**
  preserves simultaneous context or reclaims space sooner, but squeezes the
  explanation or moves the editor during a repair.

## Consequences

The Problems area uses editor space when expanded. Its space limits need to
preserve useful editing room. Diagnostics need structured causes and repair
targets for specific guidance, and captured technical context for reporting.
The current render path reduces errors to their message and publishes result
identities without retaining the failed request. Capture the original error
detail before that reduction and pair it with the attempt's source and
preview context. A source hash identifies content, not a unique attempt.
The existing CLI's preservation of engine source context
provides a precedent for this capture. The preview needs separate records
for the latest failure and the last successful output; a runtime failure
currently replaces the successful result with empty output. Capture the
attempt's triggering action to distinguish explicit Run failures from
automatic failures. Selection matching uses the preview's rendering root;
moving focus within the field explorer leaves that identity intact. The
detected-problem selector extends the first-only validation presentation in
[ADR 0032](0032-web-workbench-edits-one-source-document.md); parsers can still
stop at their first error. Draft saving and note-operation retry behavior
remain independent of preview success. Diagnostic suggestions require no
repair-command registry or mutation handlers.

Observable layout rules live in
[WORKBENCH-DESIGN.md](../../apps/docs/WORKBENCH-DESIGN.md#diagnosis-and-feedback).
This extends the local Annotation-format diagnosis in
[ADR 0041](0041-annotation-format-has-its-own-workbench-tab.md) and follows the
shared behavior and host styling boundary in
[ADR 0044](0044-workbench-ui-is-headless-and-hosts-own-the-look.md).
Implementation scope and acceptance criteria live in
[spec #1078](https://github.com/aidenlx/zotlit/issues/1078).
