# Obsidian CLI: transport, vault routing, and vault identity

Findings from a reverse-engineering pass over Obsidian 1.13.4 (`main.js` — Electron main
process, `app.js` — renderer, and the native CLI shim). Line numbers refer to the
formatted extraction produced by `/obsidian-asar-extract` (`node_modules/.ob-rev-1.13.4/`).
These facts drive the ZotLit CLI design: single-target routing, `expect-source`-only
assertions, and the absence of a vault field in the Workbench identity.

Invoke the CLI as `obsidian` on every platform. The registered Windows command resolves
to `Obsidian.com`; macOS and Linux register an `obsidian` command. See the official
[Obsidian CLI installation guide](https://obsidian.md/help/cli#Install%20Obsidian%20CLI).

## Transport

ZotLit calls the registered `obsidian` command and uses the command response as
the liveness result. The transport addresses below belong to Obsidian.

The CLI reaches the running app through a Unix domain socket / Windows named pipe — not
`second-instance`, not `obsidian://`.

| Platform | Address |
| --- | --- |
| Windows | `\\.\pipe\obsidian-cli-<username>` |
| macOS | `$HOME/.obsidian-cli.sock` |
| Linux | `$XDG_RUNTIME_DIR/.obsidian-cli.sock`, else `$HOME/.obsidian-cli.sock` |

Wire protocol: one JSON header line `{"argv":[...],"tty":bool,"cwd":"..."}\n`, then raw
bidirectional stdin/stdout streaming. The server (`main.js:5415-5442`) enforces a 5 s header
timeout, then dispatches via `mt(socket, argv, tty, cwd)`.

Client paths:

- **Native shim** (macOS/Linux): connects to the socket. When Obsidian is not running it
  fails with "The CLI is unable to find Obsidian…" — it does not launch the app.
- **Electron fallback** (`main.js:4441-4491`): runs when the single-instance lock is taken.
- **Windows**: shim starts `Obsidian.exe session=<pipe>`; the primary instance dials back
  into that pipe and runs the same handler (`main.js:5489-5508`).

**Argv filter** (`main.js:4417-4433`): every `--`-prefixed argument is dropped except
`--copy --help --json --md --tsv --csv`. Plugin flags must use `key` / `key=value` form.

The main process injects into the target window (`main.js:5400-5410`):
`window.handleCli(argv)` when ready, else pushes onto `window.cliQueue`, drained in
`workspace.onLayoutReady` (`app.js:82271-82282`). **No timeout exists on this promise** — a
handler that never settles hangs the caller's terminal.

## Vault routing

All routing is `mt()` at `main.js:5451-5488`. Precedence, evaluated once per invocation:

1. **`vault=<id-or-name>`** — only as the **first** argv token; consumed before the renderer
   sees argv. Matches the 16-hex vault id or `basename(path)` case-insensitively; first hit
   in `obsidian.json` key order wins (`He`, `main.js:5205-5211`). An earlier entry whose
   *name* matches beats a later entry whose *id* matches.
2. **cwd containment** (`ct`, `main.js:5215-5221`): first registered vault whose path equals
   or prefixes the caller's cwd. First match, not longest — nested vaults can resolve to the
   outer vault. (The `obsidian://` path does use longest match, `main.js:6189-6192`.)
3. **Most recently focused window** (`Ie`, `main.js:5196-5204`), by `focusTime` stamped on
   every window `focus` event.
4. Otherwise: `"Vault not found."` — no chooser, no launch.

Consequences:

- **Routing is single-target and never fans out.** With a plugin installed in N vaults,
  exactly one vault window receives the command; the plugin cannot observe or decline
  requests routed elsewhere. Vault selection is finished before plugin code runs, so a
  vault filter inside a handler can only ever compare the answering vault against itself.
- `vault=<registered-but-closed>` **boots that vault window** (unfocused, `he(id, false)`,
  `main.js:5223-5329`) and blocks the caller through full vault load. Handlers registered
  synchronously in `Plugin.onload` are in place before the queued request drains; handlers
  registered after `onLayoutReady` race it.
- Automated callers must pass `vault=` as the first token; the cwd/focus fallbacks are only
  predictable for a human in a terminal inside the vault.
- Two main windows of one vault cannot exist (`Y` maps vaultId → window); pop-outs share the
  main window's `app`.
- The whole feature is gated by Settings → General → Advanced → "Command line interface"
  (`D.cli`, `main.js:5468-5474`). When off, every command fails with a generic message
  before any plugin handler runs; the plugin cannot detect the gate.

## Plugin surface

The CLI handler registry is separate from the command palette:

| Internal | Location | Public counterpart |
| --- | --- | --- |
| `yL` class, instance `app.cli` | `app.js:82123` | — |
| `yL.registerHandler(cmd, desc, flags, handler)` | `app.js:82128-82133` | via `Plugin.registerCliHandler` (`obsidian.d.ts`, since 1.12.2) |
| `yL.formatTable(headers, rows, fmt)` | `app.js:82134-82152` | — |
| `window.handleCli` / `cliQueue` | `app.js:82158-82282` | — |
| `commands` / `command id=<id>` built-ins | `app.js:83106`, `83128` | bridge to `app.commands` |

Parsing (`app.js:82193-82258`): `argv[0]` is the command; remaining tokens become
`params[k]=v` or `params[k]="true"` for bare tokens (why the Workbench rejects bare
assertion flags). A `format` flag declared with `a|b` values gets `--json`-style shorthand
folded in; `--copy` is consumed by the framework and copies the handler's return value.
Command ids are a global per-vault namespace; duplicate registration throws — hence the
`zotlit:` prefix.

## Vault identity

Obsidian's own stable vault handle is the 16-hex key in `<userData>/obsidian.json` →
`vaults`, surfaced in the renderer as `app.appId` and used as the prefix/partition key for
localStorage, IndexedDB, and session partitions.

| Event | `app.appId` survives? |
| --- | --- |
| Vault moved via Obsidian's own move | Yes (path rewritten, id kept) |
| Vault re-added at the same path | Yes (entry reused) |
| Vault removed from the chooser, then re-added | No (new random id) |
| Vault moved externally, then re-added | No |
| Same folder synced to another machine | No (`obsidian.json` is per-install) |
| `userData` wiped / reinstall | No |

So `app.appId` is a machine-local routing key, not a portable vault identity. A portable
identity must live inside the vault itself. Neither built-in CLI command exposes the id:
`vaults` prints basenames (+ paths with `verbose`); only a plugin handler can return it.

The Workbench draws the consequence: identity reports the answering vault's name and
absolute path so the caller can confirm the routing, while `expect-*` assertions cover only
the Zotero source, whose database can genuinely diverge from what the caller assumes. The
vault needs no assertion — Obsidian has already routed the request to exactly one vault, and
callers that must target a specific vault pass `vault=<name-or-id>` as the first token.
