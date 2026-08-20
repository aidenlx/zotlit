# Verify outbound HTTP notifications

When the plugin's job is to send something (the notify feature POSTs events to Obsidian),
inspecting internal state is insufficient — prove the bytes leave Zotero.

Run the capture server on the port the plugin targets (`extensions.zotlit.notify-url`,
default `9091`):

```bash
node apps/zotero/scripts/debug/capture-server.ts 9091 > tmp/capture.log 2>&1 &
until rg -q "listening" tmp/capture.log; do sleep 1; done
```

Trigger the behaviour via `rdp-eval.ts` and read `tmp/capture.log`. Each `POST /notify` body
is logged with a timestamp — a line appearing is end-to-end proof the plugin dispatched; an
empty log means it did not (check prefs, enablement flags, and observer registration).

Stop the capture server when done:

```bash
pkill -f "scripts/debug/capture-server.ts"
```
