import { obRun } from "./obsidian-cli.ts";
// An in-memory clipboard for each vault window of a run (ADR 0078).

/**
 * Eval code that installs the in-memory clipboard in the window it runs in,
 * once; a later call keeps the store.
 *
 * Runs in other worktrees share the one Obsidian app, and the OS clipboard
 * with it, so a run that wrote and read the OS clipboard would read another
 * run's text or the developer's. The window instead swaps the methods of
 * Electron's `clipboard` and of `navigator.clipboard` for one store. The
 * plugin's own copy paths call these same objects, so they still run:
 * Electron's renderer `clipboard` is one plain object per renderer process,
 * which the plugin's `require("electron")` returns too. `navigator.clipboard`
 * keeps plain text and HTML, the two types the plugin writes and reads.
 *
 * @see https://github.com/electron/electron/blob/v43.3.0/lib/renderer/api/clipboard.ts
 */
export const installMemoryClipboard = (vaultId: string): Promise<void> =>
  obRun(vaultId, () => {
    if (window.__ztMemoryClipboard) return;
    window.__ztMemoryClipboard = true;
    const { clipboard, nativeImage } =
      require("electron") as typeof import("electron");
    const empty = () => ({
      text: "",
      html: "",
      rtf: "",
      image: nativeImage.createEmpty(),
      bookmark: { title: "", url: "" },
    });
    let store = empty();
    Object.assign(clipboard, {
      readText: () => store.text,
      writeText: (text: string) => {
        store = { ...empty(), text: text };
      },
      readHTML: () => store.html,
      readRTF: () => store.rtf,
      readImage: () => store.image,
      readBookmark: () => ({ ...store.bookmark }),
      write: (data: import("electron").Data) => {
        store = {
          text: data.text ?? "",
          html: data.html ?? "",
          rtf: data.rtf ?? "",
          image: data.image ?? nativeImage.createEmpty(),
          bookmark:
            data.bookmark === undefined
              ? { title: "", url: "" }
              : { title: data.bookmark, url: data.text ?? "" },
        };
      },
      clear: () => {
        store = empty();
      },
    });
    navigator.clipboard.readText = async () => store.text;
    navigator.clipboard.writeText = async (text) => {
      clipboard.writeText(text);
    };
    navigator.clipboard.write = async (items) => {
      const read = async (item: ClipboardItem, type: string) =>
        item.types.includes(type) ? (await item.getType(type)).text() : "";
      const [item] = items;
      clipboard.write(
        item
          ? {
              text: await read(item, "text/plain"),
              html: await read(item, "text/html"),
            }
          : {},
      );
    };
    navigator.clipboard.read = async () => {
      const types: Record<string, Blob> = {};
      if (store.text)
        types["text/plain"] = new Blob([store.text], { type: "text/plain" });
      if (store.html)
        types["text/html"] = new Blob([store.html], { type: "text/html" });
      return Object.keys(types).length ? [new ClipboardItem(types)] : [];
    };
  });

declare global {
  interface Window {
    __ztMemoryClipboard?: boolean;
  }
}
