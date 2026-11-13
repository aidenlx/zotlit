# Obsidian on a real iPhone

1. **Connect.** Connect the iPhone over USB, unlock it, and bring Obsidian to the foreground.
   Enable Web Inspector under Settings → Apps → Safari → Advanced on iOS 18 and later.
   On earlier iOS versions, start at Settings → Safari. Complete the Trust prompt on the
   device if it appears.
2. **Find the WebView.** Run the following from the Mac. Continue when the list includes
   an Obsidian WebView at `capacitor://localhost`. With multiple devices, add
   `--udid <device-id>` to both commands. Use each command's `--help` for connection options.

   ```sh
   uvx pymobiledevice3@11.54.0 webinspector opened-tabs --timeout 6
   uvx pymobiledevice3@11.54.0 webinspector js-shell --bundle-id md.obsidian --no-console-enable
   ```

   If the list is empty, check that Obsidian is still in the foreground and compare with
   Safari → Develop → Inspect Apps and Devices on the Mac. If neither lists Obsidian,
   report that the app target is unavailable. Use a single inspector session for the probe.
3. **Confirm the target.** Evaluate this expression in the shell. Expect the Capacitor
   origin and `obsidian: true`. Before a vault write, confirm `app.vault.getName()` matches
   the intended test vault.

   ```js
   JSON.stringify({ origin: location.origin, obsidian: Boolean(globalThis.app?.vault) })
   ```

4. **Probe.** Use synchronous expressions for DOM and runtime values. For async probes,
   submit a single-line IIFE that saves its result in a temporary global, then read that
   global in a separate evaluation. The shell can return before the promise settles.
   Report the settled value or the error. Delete the temporary global and exit the shell
   with Ctrl+D.

## CLI cache in a restricted workspace

If `pymobiledevice3` fails when it creates its cache under the Mac home directory, use a
workspace-local cache. Save this as `.scratch/obsidian-ios/inspector.py`:

```python
from pathlib import Path

from pymobiledevice3 import common
from pymobiledevice3.__main__ import main

common._HOMEFOLDER = Path(__file__).resolve().parent / "device-cache"
main()
```

Replace `uvx pymobiledevice3@11.54.0` in the commands above with
`uv run --no-project --with pymobiledevice3==11.54.0 python .scratch/obsidian-ios/inspector.py`.
If uv's cache also needs a writable location, set `UV_CACHE_DIR` to a path under `.scratch/`.

See [Apple's iOS inspection guide](https://developer.apple.com/documentation/safari-developer-tools/inspecting-ios)
and the [pymobiledevice3 Web Inspector CLI reference](https://doronz88.github.io/pymobiledevice3/latest/cli/webinspector/).
