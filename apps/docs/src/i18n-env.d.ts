export {};

declare global {
  /** Replaced by Vite with the paths of native Chinese content files. */
  const __DOCS_CHINESE_PAGES__: string[];
  /** Replaced by Vite with the `/learn` step media found on disk. @see src/lib/learn-media.ts */
  const __LEARN_MEDIA__: import("./lib/learn-media").LearnMedia;
}
