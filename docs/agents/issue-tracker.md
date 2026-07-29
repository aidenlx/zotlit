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

## Query sub-issues and dependencies

`gh issue view` and `gh issue list` read the relationship graph through `--json`. Use these fields instead of the GraphQL API:

| Field              | Shape                                    | Holds                         |
| ------------------ | ---------------------------------------- | ----------------------------- |
| `parent`           | object, or `null`                        | The parent issue              |
| `subIssues`        | connection                               | The child issues              |
| `subIssuesSummary` | `{ completed, total, percentCompleted }` | Child progress counts         |
| `blockedBy`        | connection                               | The issues that gate this one |
| `blocking`         | connection                               | The issues this one gates     |

A connection is `{ nodes: [{ id, number, state, title, url }], totalCount }`. Reach the members through `.nodes[]`.

- **List the children of one issue**: `gh issue view <parent> --json subIssues --template '{{range .subIssues.nodes}}{{.number}}	{{.state}}	{{.title}}{{"\n"}}{{end}}'`.
- **Search for children across the repo**: `gh issue list --search "parent-issue:aidenlx/zotlit#<parent>"`. This qualifier needs the full `OWNER/REPO#NUMBER` form, and it combines with other qualifiers such as `state:open` and `no:assignee`.

To select the frontier — each open child with no assignee and no open blocker:

```sh
gh issue list --search "parent-issue:aidenlx/zotlit#<parent> state:open no:assignee" \
  --json number,title,blockedBy \
  --jq '.[] | select([.blockedBy.nodes[] | select(.state == "OPEN")] | length == 0) | "\(.number)\t\(.title)"'
```

`--jq` overrides `--template` when both are present.

## Specs and tickets

- Label a spec (PRD) issue `spec`. Label each tracer-bullet implementation issue carved from it `ticket`.
- A ticket is a sub-issue of its spec and declares blocking edges to the tickets that gate it, using the relationship commands above.

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
- **Frontier**: select the first open child that has no open blocker and no assignee, with the frontier query above.
- **Claim**: run `gh issue edit <number> --add-assignee @me`.
- **Resolve**: add the answer as a comment, close the child issue, and add a short result with its link to Decisions-so-far in the map.
