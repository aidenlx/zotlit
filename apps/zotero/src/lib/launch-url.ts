// Launching `obsidian://` links through the handler the operating system registers.

import { getLogger } from "@logtape/logtape";

const logger = getLogger(["zotlit", "zotero", "launch-url"]);

/**
 * `Zotero.launchURL` hands `nsIExternalProtocolService.loadURI` a null
 * triggering principal. Gecko 140.15 added
 * `NS_ENSURE_ARG_POINTER(aTriggeringPrincipal)` to that call, so Zotero 10.0.2
 * fails every non-HTTP launch with `NS_ERROR_ILLEGAL_VALUE` before the OS
 * handler can prompt or start.
 *
 * @see [Zotero 10.0.1 `launchURL`](https://github.com/zotero/zotero/blob/10.0.1/chrome/content/zotero/xpcom/zotero.js#L1237)
 * @see [Gecko 140.15 `LoadURI`](https://hg.mozilla.org/releases/mozilla-esr140/file/FIREFOX_140_15_0esr_RELEASE/uriloader/exthandler/nsExternalHelperAppService.cpp#l1012)
 */
function isMissingPrincipalFailure(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { result?: unknown }).result ===
      Components.results.NS_ERROR_ILLEGAL_VALUE
  );
}

/**
 * The plugin sandbox types narrow `Services` to a few members. The sandbox
 * receives the same object that Zotero chrome reads, so the members below exist
 * at runtime.
 */
interface LaunchServices {
  io: nsIIOService;
  scriptSecurityManager: nsIScriptSecurityManager;
}

/**
 * Open `url` with the handler that the operating system registers for its
 * scheme.
 *
 * `Zotero.launchURL` runs the checks this plugin relies on — a registered OS
 * handler and cleared Mozilla environment variables — so it stays the default
 * path. When the triggering principal is the only defect, repeat its final
 * call with a system principal, the call `Zotero.launchFile` makes.
 *
 * @throws the `Zotero.launchURL` error for every other cause, such as a scheme
 * with no registered handler.
 */
export function launchExternalUrl(url: string): void {
  try {
    Zotero.launchURL(url);
    return;
  } catch (error) {
    if (!isMissingPrincipalFailure(error)) throw error;
    logger.warn("retrying external launch with a system principal", { url });
  }

  const { io, scriptSecurityManager } = Services as unknown as LaunchServices;
  Cc["@mozilla.org/uriloader/external-protocol-service;1"]!.getService(
    Ci.nsIExternalProtocolService,
  ).loadURI(io.newURI(url), scriptSecurityManager.getSystemPrincipal());
}
