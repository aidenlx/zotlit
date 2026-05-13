export function requireElectron() {
  return require("electron") as typeof import("electron");
}

export function requireElectronRemote() {
  return require("@electron/remote") as typeof import("@electron/remote");
}

export function requireDialog() {
  return requireElectronRemote().dialog;
}
