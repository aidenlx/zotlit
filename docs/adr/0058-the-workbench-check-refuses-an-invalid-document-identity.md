# The Workbench check refuses an invalid document identity

`zotlit:template-check` answers one question: what happens when this source is
used. A document whose identity the vault rejects can never be used, so the
check refuses it instead of reporting a check that passed. Two identities are
refused. A Template Draft whose manifest ID is neither `default` nor a
12-character Profile ID returns `INVALID_PROFILE_ID`, the same rule the
saved Profile scan applies. A saved Shared Partial whose filename is a Reserved
Partial Name returns `RESERVED_PARTIAL_NAME`, the same rule partial
reconciliation applies. Before this decision both cases reported success, so an
agent could check a draft, save it, and watch the vault reject the source the
check had just approved.

A refusal is not a failed check, and the answer says which one it is. A refusal
raised before the source is parsed carries no `checks` field, because no check
ran: the reserved name is read from the filename. A refusal raised from parsing
carries the `checks` map with the check that failed, because that check did run.
Forcing one shape on both would make one of the two answers untrue, so the two
shapes stand and the `check` guide topic states the rule.

## Considered options

- **Report the invalid identity as a failed check.** Rejected. It claims a check
  ran against a document the vault does not accept, and it puts the identity
  rule inside the check results, where an output selector could hide it.
- **Report a diagnostic and check the source anyway**, which is what ADR 0039
  does for an unevaluable Profile Match. Rejected here, and the difference is
  the point: ADR 0039 governs configuration that must never block note creation,
  so an unevaluable match is a nonmatch with a diagnostic. The check is the
  surface whose whole purpose is to predict the saved result, and a passing
  answer there is read as permission to save.
- **Leave both cases passing** and rely on the agent to notice. Rejected. A
  false success is the one answer this command must never give.

## Consequences

- The 12-character rule stays an Obsidian-app rule in `lib/profile-stamp.ts`,
  not a Template Document schema rule. The manifest schema still accepts any
  non-empty ID, so the rule applies where Profiles are resolved.
- The Note Preview keeps rendering a draft whose ID fails the rule, with the
  draft's own bindings. It is a human surface, so ADR 0031 and ADR 0039 apply
  there: an invalid document is diagnosed where it lives and blocks nothing.
  `bindDraftProfile` therefore exposes a validated entry point and a separately
  named unvalidated one, rather than one entry point with a cast inside it.
- Both refusals were added while Template Workbench CLI Contract 7 was
  unreleased, so the version does not move for them. A refusal added to a
  published contract would move it, because a call that used to succeed now
  fails.
