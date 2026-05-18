/**
 * Log a message to the Zotero browser console.
 * replace with Zotero.log when fix in https://github.com/zotero/zotero/pull/5920/commits is merged
 * @param {string} message
 * @param {"info" | "warning" | "error"} [type]
 * @param {string} [sourceName]
 */
export function logToBrowserConsole(
  message,
  type = "warning",
  sourceName = "bootstrap.js",
) {
  const scriptError = Components.classes[
    "@mozilla.org/scripterror;1"
  ].createInstance(Components.interfaces.nsIScriptError);

  var flagsByType = {
    error: scriptError.errorFlag, // 0
    warning: scriptError.warningFlag, // 1
    info: scriptError.infoFlag, // 8
  };

  var flags = Object.prototype.hasOwnProperty.call(flagsByType, type)
    ? flagsByType[type]
    : scriptError.warningFlag;

  scriptError.init(
    String(message),
    sourceName,
    0,
    0,
    flags,
    "system javascript",
    false,
    true,
  );

  Services.console.logMessage(scriptError);
}
