// External URLs surfaced by the Welcome View — docs, community, and news links.
// The docs-site links follow the reader's language, so each is read when used.

import { docsUrl } from "@/lib/docs-url";

export const docsHomeUrl = (): string => docsUrl("/docs");
export const gettingStartedUrl = (): string => docsUrl("/learn");
export const templatesDocsUrl = (): string =>
  docsUrl("/docs/reference/templates");
export const citationsDocsUrl = (): string =>
  docsUrl("/docs/how-to/insert-citations");
export const migrationGuideUrl = (): string =>
  docsUrl("/docs/how-to/migrate-from-v1");
export const blogUrl = (): string => docsUrl("/blog");
export const changelogUrl = (): string => docsUrl("/changelog");
export const GITHUB = "https://github.com/aidenlx/zotlit";
export const communityUrl = (): string => docsUrl("/community");
export const BUG_REPORT = `https://github.com/aidenlx/zotlit/discussions/new?category=bug-reports`;
export const SPONSOR = "https://github.com/sponsors/aidenlx";
