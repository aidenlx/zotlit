export function requireElectron() {
  return require("electron") as typeof import("electron");
}
