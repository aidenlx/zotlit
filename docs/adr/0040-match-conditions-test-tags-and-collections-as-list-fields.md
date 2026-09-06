---
status: accepted
---

# Match conditions test Tags and Collections as list fields

[ADR 0038](0038-profile-selection-rules-belong-to-the-vault.md) gave the condition contract three global predicates — `hasTag(name)`, `inCollection(library, key)`, `inCollectionDirectly(library, key)` — and a Collection reference of Library selector plus Collection key. [ADR 0039](0039-a-profile-match-lives-in-the-profile-document.md) moved the match into the Profile document, made references names, and left the leaf syntax to the Filter Expression work. The grilling on 2026-09-06 settled that syntax on the [Obsidian Bases function vocabulary](https://help.obsidian.md/bases/functions), which the match editor and the Match tree already mirror.

**Tags and Collections are list fields.** The contract exposes `tags`, the Item's Tag names, and `collections`, the Item's Collection paths, as list-typed fields. The accepted tests are the Bases list functions on those fields — `contains`, `containsAny`, `containsAll`, `isEmpty` — plus `collections.within(path)` for filing in a Collection or any of its subcollections. `!` is the only negation, so a negated `containsAny` or `containsAll` has no labelled row and stays an expression row. The receivers and methods are hardcoded; a typed field registry is deferred until a second list field needs it. Tag matching stays exact and case-sensitive over manual and automatic Tags alike.

**A Collection reference is its path.** The names from the root ancestor to the Collection, joined by `/` without escaping; matching is segment-wise, so only a Collection name that itself contains `/` is ambiguous. One path names the same Collection in every Library the match covers, and a rename changes the path and the match stops matching until the user updates it. A path no Library holds is an ordinary nonmatch with a hint in the editor, under ADR 0039's unevaluable-match rule.

**One row shape for every kind.** A condition row is kind, operator, value. Subcollection scope is the operator (`within`, shown as "is inside", is the default; `contains`, shown as "is", tests direct filing), which removes the fourth control that made Collection rows wrap. Tags and Collections share one operator model and one multi-value input; Collection values offer the scoped Libraries' paths once each and accept a typed path that is not present yet, Tag values are typed freely.

## Considered options

- **Bases' own `file.hasTag(...tags)`**: variadic "any of" with nested-tag matching. Rejected because Zotero Tags do not nest and the list functions give any-of, all-of, and empty tests from one model.
- **Two Collection condition kinds** ("Collection, including subcollections" / "Collection, excluding subcollections"): keeps the global functions, but the pair reads as a sentence badly with any operator and doubles the kind list. Rejected for scope-as-operator.
- **`collections.contains` over Library-qualified keys**: keeps rename stability, but a key is not a name and does not read the same in another vault, which ADR 0039 requires.
- **Unknown path as a broken match**: rejected because portability is the point of paths; an absent path in one Library is a normal state.
