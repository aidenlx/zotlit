# agent-browser

Browser automation CLI — Chrome via CDP, accessibility-tree snapshots with compact `@eN` refs. Workspace devDependency; available on `PATH` inside the repo.

## Usage guide

Run `agent-browser skills get core` once per session for the version-matched reference. Pick subcommands and flags from there, not from memory.

## Session convention

Worktree-scoped session ids keep parallel worktrees from colliding. Derive one stable id per skill and export it:

```bash
SESSION="$(agent-browser session id --scope worktree --prefix <skill-name>)"
export AGENT_BROWSER_SESSION="$SESSION"
export AGENT_BROWSER_RESTORE="$SESSION"
```

Pass `--session "$SESSION" --restore` on `open`. Bare `--restore` uses the session id as the persistence key — loads saved cookies/localStorage before navigation, auto-saves on close. Without these env vars or flags, agent-browser may use an empty default session or drop login state.

## React introspection

The docs app is TanStack Start (React). Launch with `--enable react-devtools`:

```bash
agent-browser --session "$SESSION" --restore --headed --enable react-devtools open <url>
```

React commands (`react tree`, `react inspect`, `react renders`, `react suspense`) require this flag. Output goes stale after navigation — re-run.

## Settle and verify

After a click or navigation, settle before reading:

```bash
agent-browser wait --load networkidle
agent-browser snapshot -i
```

`wait --load networkidle` needs no path argument. Avoid `wait --url` unless you pass the link's exact href — a guessed path times out after 25 s.

## Stale sessions

A blank read, empty snapshot, `about:blank`, or "no browser session" error — right after `open` or after a click — is a dropped page, not a broken route. Reopen with `--session "$SESSION" --restore`; if still blank, `close` then reopen. Don't fall back to `curl` — it bypasses the browser under test.

## Login

The browser is the user's. If state was not restored (first run, expired session) and the page is gated, pause for the user to log in. `close` saves cookie state; the next `--restore open` keeps them logged in.
