# Opening Zotero with RDP

This note records the local smoke-test result for launching Zotero 9 with the Firefox Remote Debugging Protocol (RDP) enabled.

## Conclusion

Zotero can be opened with RDP on this machine, but the debugger server did not listen until the Zotero profile had the DevTools remote-debugging prefs enabled.

The successful smoke test used:

```sh
/Applications/Zotero.app/Contents/MacOS/zotero \
  --purgecaches \
  --new-instance \
  --profile "$TEMP_PROFILE" \
  --dataDir "$TEMP_DATA_DIR" \
  --start-debugger-server="$PORT"
```

With `user.js` in the profile containing:

```js
user_pref("devtools.chrome.enabled", true);
user_pref("devtools.debugger.remote-enabled", true);
user_pref("devtools.debugger.prompt-connection", false);
user_pref("devtools.debugger.force-local", true);
```

After that, `connectWithRetry(PORT)` received Zotero's initial RDP root packet and the smoke script printed:

```text
zotero rdp handshake ok on port 61348
```

No Zotero process was left running after the test.

## Failed Attempts

These launch attempts kept Zotero alive or exited normally, but the selected TCP port never accepted connections; every retry ended in `ECONNREFUSED`:

- Fresh temporary profile and temporary `--dataDir`, no DevTools remote prefs.
- Normal local Zotero profile, no DevTools remote prefs.
- Double-dash `--profile` and `--start-debugger-server`, no DevTools remote prefs.

This points to profile prefs as the decisive requirement. The flag spelling may still matter for our runner, but the failed single-dash attempts were not isolated from the missing-pref condition.

## Local Zotero CLI Help

The installed Zotero binary reports:

```text
-P <profile>       Start with <profile>.
--profile <path>   Start with profile at <path>.
--new-instance     Open new instance, not a new window in running instance.
--jsdebugger [<path>] Open the Browser Toolbox.
--start-debugger-server [ws:][ <port> | <path> ] Start the devtools server on
                     a TCP port or Unix domain socket path.
```

For ZotLit, prefer the documented path-form flags in new code:

- `--profile <absProfilePath>`
- `--start-debugger-server <port>` or `--start-debugger-server=<port>`
- `--new-instance` instead of relying on `--no-remote` where possible

## On `-no-remote` (historical, no longer needed)

Zotero 9's `--help` does not list `-no-remote`. The Zotero source has no handler for it (`rg no-remote chrome/ app/` returns zero hits); the flag was always a Gecko platform feature. Recommended replacements:

- argv: `--new-instance` -- documented by Zotero 9.
- env (if you want stronger isolation matching Zotero's own test harness): `MOZ_NO_REMOTE=1`. `test/runtests.sh:183` still uses `MOZ_NO_REMOTE=1 NO_EM_RESTART=1` for this reason.

Historical intent of the flag:

- Inherited from Netscape's `-remote` IPC on X11, which let a second invocation drive an already-running browser. The env var `MOZ_NO_REMOTE` told the binary to ignore any running instance and start fresh; it was later promoted to the `-no-remote` argv flag. Original meaning was outbound-only: "don't fold into a running browser."
- Firefox 9 / [bug 650078](https://bugzilla.mozilla.org/show_bug.cgi?id=650078) (Nov 2011) made `-no-remote` also refuse incoming remote commands, so the instance was isolated in both directions. This broke workflows that wanted to launch fresh but still be targetable, so `-new-instance` was introduced as the softer variant (doesn't send, still receives). `-new-instance` was historically broken on Windows ([bug 855899](https://bugzilla.mozilla.org/show_bug.cgi?id=855899)), which is part of why `-no-remote` stayed dominant in docs.
- Modern Gecko's profile-per-installation behavior means two installs pointing at distinct `--profile` + `--dataDir` are already independent. The argv flag is redundant for our case; the env var remains the precise lever if we ever need it.
- Zotero's test runner has shipped `MOZ_NO_REMOTE=1` since at least 2015 (commit `ac363101`, "Always use latest Firefox version and echo it for tests"). The intent there matches ours: a developer's running Zotero must not hijack the test/dev process and vice versa.

## Runner Implication

For `scripts/dev-server/runner.ts`:

- Do not only pass `--start-debugger-server`; also ensure the chosen dev profile has the remote-debug prefs above, or document that the user-managed profile must set them.
- Use `--new-instance` in argv. Only set `MOZ_NO_REMOTE=1` in the spawn env if a future incident shows two Zotero processes folding into each other -- the distinct `--profile` + `--dataDir` should already prevent that.

A narrow pref overlay is enough for RDP. Avoid broad profile automation that carries unrelated profile creation, proxy install, update, signing, or test preferences outside ZotLit's planned `pnpm serve` scope.
