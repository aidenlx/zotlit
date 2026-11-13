# Obsidian on Android

## Device setup

Use a USB Android device with USB debugging enabled, or boot an Android Virtual Device.
For a local emulator on Apple Silicon, install a JDK and the
[Mac ARM command-line tools](https://developer.android.com/studio#command-line-tools-only).
With the tools on PATH and the SDK directory set, install one ARM64 image:

```sh
sdkmanager platform-tools emulator 'system-images;android-35;google_apis;arm64-v8a'
printf 'no\n' | avdmanager create avd -n ZotLitAndroid -k 'system-images;android-35;google_apis;arm64-v8a'
emulator -avd ZotLitAndroid -no-window -no-audio -no-snapshot -gpu swiftshader_indirect
```

Omit `-no-window` for setup that needs the emulator UI. If a sandboxed launch exits
with signal 4 before boot, check `emulator -accel-check`. On the Mac used for the
trial, the emulator booted when run with access to Hypervisor.framework outside
the command sandbox.

Run `adb devices -l` and use the intended serial for every command below. Continue
when `adb -s <serial> shell getprop sys.boot_completed` returns `1`.

## Attach

1. **Open Obsidian.** Install the [official APK](https://obsidian.md/download) on the
   test device with `adb -s <serial> install <apk>`. Launch the app and create a
   disposable vault. Record the Android version with `getprop ro.build.version.release`
   and the WebView provider with `dumpsys webviewupdate`, both through `adb shell`.
2. **Find the app socket.** Use the PID reported by `adb -s <serial> shell pidof md.obsidian`.
   Confirm that `adb -s <serial> shell cat /proc/net/unix` lists
   `@webview_devtools_remote_<pid>`. If the socket is absent, bring Obsidian to the
   foreground and check again. If the build does not expose an inspector, run the
   probe from a temporary plugin in the disposable vault. See the
   [Android WebView debugging guide](https://developer.chrome.com/docs/devtools/remote-debugging/webviews/).
3. **Forward and select.** Forward to a free local port and query the page list.

   ```sh
   adb -s <serial> forward --no-rebind tcp:9224 localabstract:webview_devtools_remote_<pid>
   curl -fsS http://127.0.0.1:9224/json/list
   ```

   Use the Obsidian page's `webSocketDebuggerUrl` with a CDP client, or select it in
   Chrome at `chrome://inspect/#devices`. Confirm `location.origin` and
   `app.vault.getName()` before a vault write. The Android trial used
   `http://localhost`. The onboarding page can expose the WebView before a vault exists.
4. **Probe.** For a CLI client, send `Runtime.evaluate` with `awaitPromise: true`
   and `returnByValue: true`. Record the returned value or `exceptionDetails`.
5. **Relaunch.** If the bug requires a cold start, run
   `adb -s <serial> shell am force-stop md.obsidian` and reopen Obsidian. Remove
   the old forward, get the new PID, and attach again before repeating the probe.
6. **Clean up.** Close the CDP client and run
   `adb -s <serial> forward --remove tcp:9224`. Report the app and WebView versions,
   test results, and whether the target was an emulator or a physical device.
