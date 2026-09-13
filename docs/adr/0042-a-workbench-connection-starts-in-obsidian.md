# A Workbench Connection starts in Obsidian

> Current release scope is amended by [ADR 0046](0046-customize-is-a-chooser-between-the-web-workbench-and-the-profile-editor.md#current-release-amendment--2026-09-08): the Local Bridge is behind a build flag that defaults to off. Local Server settings and Live Update remain available; bridge controls are hidden and bridge requests are rejected while the flag is off.

The #947 contract carried two bootstraps for the web Template Workbench: Obsidian-first, where the page receives a one-time code in the URL fragment, and browser-first, where the page probes a fixed loopback port and waits for approval in Obsidian. The Fixture mock auto-approved the probe, so the `pending` state was never exercised, and every real user path starts from a Customize action in Obsidian. Decided in the Local Bridge grilling on map #835: a Workbench Connection starts in Obsidian only. The plugin mints a Connection code, opens the docs site with the code and the Local Server's port in the fragment, and the page exchanges the code for a session credential; the page's disconnected state tells the user to open the Workbench from Obsidian, and reconnection after a reload resumes on the kept credential and port. The Local Bridge is hosted on the plugin's one Local Server beside Live Update, on the configured server port with a fallback range for a second open vault. The session credential lives in plugin memory only, so plugin unload, Obsidian quit, disconnect, or a newer approval revokes it; there is no secret at rest on either side.

## Considered options

- **Keep both bootstraps**: a dormant probe endpoint that still has to be defended and a Connect button the page cannot honour when Obsidian is closed.
- **A separate bridge listener on a fixed port**: two servers with two lifecycles and a second port collision between open vaults, for a page that already learns the port from the URL.
- **A per-device session store with an expiry**: lets an open tab survive an Obsidian restart without a click, at the cost of a credential at rest; the per-device "do not ask again" flag on the launch sheet removes the friction that store would buy.

## Consequences

- The bridge contract moves to version 2: the probe path and the `pending` state are removed, the selected Item becomes nullable, the fragment carries the port, and the kept credential records its port.
- Live Update and the Local Bridge share one Hono app and one settings group: a server toggle and one toggle per hosted service. Bridge routes refuse non-loopback peers and emit CORS headers only for the docs origins, whatever address the server is bound to.
- The Fixture mock follows the contract bump and keeps serving the docs app's tests; the plugin's bridge is tested through the same Hono app seam and the end-to-end run.
