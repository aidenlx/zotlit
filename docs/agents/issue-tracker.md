# Issue tracker: GitHub

Issues, specifications, and tickets for this repo live in GitHub Issues at `aidenlx/zotlit`. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`.
- **Create a sub-issue**: add `--parent <parent-number>` to `gh issue create`, or link an existing issue with `gh issue edit <parent-number> --add-sub-issue <child-number>`.
- **Create a blocking edge**: add `--blocked-by <blocker-numbers>` to `gh issue create`, or link an existing issue with `gh issue edit <blocked-number> --add-blocked-by <blocker-number>`.
- **Read an issue**: `gh issue view <number> --comments`.
- **List issues**: `gh issue list --state open` with suitable label and state filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`.
- **Apply or remove labels**: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`.
- **Close an issue**: `gh issue close <number> --reason completed --comment "..."`.

Run commands inside this clone so `gh` infers the repository from the Git remote.

## Pull requests as a triage surface

External pull requests are not a request or triage surface. Triage GitHub issues only.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is one issue with child issues as tickets.

- **Map**: an issue labelled `wayfinder:map` that holds Notes, Decisions-so-far, and Fog.
- **Child ticket**: a GitHub sub-issue linked to the map with the sub-issue commands above. If sub-issues are unavailable, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body.
- **Ticket type**: apply `wayfinder:<type>`, where type is `research`, `prototype`, `grilling`, or `task`.
- **Blocking**: use GitHub issue dependencies with the blocking-edge commands above. If dependencies are unavailable, put `Blocked by: #<number>, #<number>` at the top of the child body.
- **Frontier**: select the first open child that has no open blocker and no assignee.
- **Claim**: run `gh issue edit <number> --add-assignee @me`.
- **Resolve**: add the answer as a comment, close the child issue, and add a short result with its link to Decisions-so-far in the map.
