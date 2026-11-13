export {};

declare global {
  /** Replaced by Vite with the paths of native Chinese content files. */
  const __DOCS_CHINESE_PAGES__: string[];
  /** Replaced by Vite with the `/learn` step media found on disk. @see src/lib/learn-media.ts */
  const __LEARN_MEDIA__: import("./lib/learn-media").LearnMedia;
  /** Replaced by Vite with each video's media-store URL by its `/img/...` path; empty without a media origin. @see src/lib/media-store.ts */
  const __MEDIA_URLS__: Record<string, string>;
  /** Replaced by Vite with each content file's first commit day, by its path under `content/`. @see src/lib/first-commits.ts */
  const __FIRST_COMMIT_DAYS__: Record<string, string>;
}
