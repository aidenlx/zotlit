---
status: accepted
---

# A Profile Match lives in the Profile document

[ADR 0038](0038-profile-selection-rules-belong-to-the-vault.md) put automatic selection in a vault-owned ordered list of rules in `data.json`, each selecting a Profile by ID. The same-day revisit on 2026-09-06, held in greenfield mode because no rule format has shipped (`main` is at settings version 9), reopened it on three drivers: a reader of a Profile document should see which Items it is for, a shared Profile should be able to carry that declaration, and the declaration should be editable as text by a person, an agent, the web Workbench, and git, like the rest of the Profile. Under [ADR 0031](0031-a-literature-note-profile-is-its-document.md) the Profile is its document, so the rule list was the one piece of a Profile that lived elsewhere.

**The Profile Match is a manifest key.** Each Profile document may carry one `match` key whose value is a Match tree: a Filter Expression string, or an explicit `and` / `or` tree in the shape of an Obsidian Bases `filters` block whose leaves are Match conditions. An absent `match` means the Profile is never selected automatically; a present empty tree matches every Item. The Default Profile carries no `match`, as it carries no bindings, and is the fallback. There is no settings-side list, rule ID, rule order, or separate Library scope: a Library is an ordinary condition, written as `personal` or `group:<groupID>`, and Tags and Collections are referenced by name so a leaf reads the same in any vault. The leaf syntax itself is decided in the Filter Expression work, not here.

**Exactly one match selects.** Automatic Profile Selection picks the one Profile whose Profile Match matches the source Item. Two or more matching Profiles are a Selection problem: the picker opens with the candidates and the user chooses. A user who wants precedence writes exclusions. Selection precedence is unchanged from ADR 0038: the manual choice for the current operation, then a Profile supplied by a command or Companion link, then the Profile Match, then Default. Batches select per Item, and the preview fixes the current selection.

**An unevaluable match is a nonmatch with a diagnostic.** A leaf that names an unknown Collection or group, a leaf outside the contract, or a syntax error makes the Profile's match unevaluable: the Profile is skipped for every Item and its settings row shows the problem. A document that is excluded from the registry — a failed manifest, a colliding ID — is not a Profile and its match is inert; the existing excluded-documents banner is the signal. This replaces ADR 0038's "broken rules stop creation" line with the rule that configuration errors are visible where the configuration is, and never block new notes.

**The document is the editor, with a modal for convenience.** The settings Profile row shows the match in words and a button that opens the match editor, which edits or removes the `match` key through the same targeted YAML edit that Duplicate and Share use, leaving the rest of the document untouched. The web Workbench sees `match` as an ordinary manifest key.

**The match travels with the Profile behind a toggle.** Share offers "Include match conditions", ticked by default; the import consent sheet shows the match in words behind an "Import match conditions" checkbox, also ticked. Omitting removes the key from the written file. Whether the names in a shared match mean anything in the recipient's Zotero is the user's concern; ZotLit does not repair references.

## Considered options

- **Keep the ordered list in settings** (ADR 0038): one place to inspect, and vault-bound references stay out of the document. Rejected because it is the one Profile fact outside the document, and the boundary it protected dissolves once references are names and sharing is opt-in.
- **Conditions in the document, order in settings**: re-creates the two-home scatter ADR 0031 removed.
- **A `priority` number per manifest**: explicit, but reordering means opening several files, and equal numbers need a tie-break anyway.
- **Unevaluable match stops creation** (ADR 0038's posture): rejected because an imported Profile with foreign names would block every new note; a visible row diagnostic serves the same need.

## Consequences

- `profile.selection-rules` leaves the settings schema without a migration; the rule list page, rule IDs, reordering, and per-rule diagnostics go with it. The rule editor is rehomed as the match editor on the Profile row.
- Profile deletion no longer warns about rule references; the match dies with the file.
- Spec [#971](https://github.com/aidenlx/zotlit/issues/971) and its child tickets are amended to this shape, and the settings reference page replaces the "Automatic profile selection" list with the per-Profile match row and drops "sharing or importing a Profile never carries them".
- The `apps/obsidian/CONTEXT.md` terms Profile Selection Rule, Rule Filter, and Rule condition are replaced by Profile Match, Match tree, and Match condition.
