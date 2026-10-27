/** Electron BrowserWindow methods used to show a background vault. */
export interface BackgroundWindow {
  showInactive(): void;
  isMinimized(): boolean;
  blur(): void;
  getOpacity(): number;
  setOpacity(opacity: number): void;
  once(event: "restore", listener: () => void): void;
}
