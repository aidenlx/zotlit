// Pure status → copy/exits model for the 404 and runtime-error pages.
import { docsRoute, gitConfig } from "./shared";

export type ErrorStatus = "404" | "500";

export type ErrorExit =
  | { label: string; href: string }
  | { label: string; action: "reset" }
  | { label: string; action: "search" };

export interface ErrorModel {
  code: ErrorStatus;
  statusLabel: string;
  headline: string;
  standfirst: string;
  exitLabel: string;
  exits: ErrorExit[];
}

export function errorPageModel(status: ErrorStatus): ErrorModel {
  switch (status) {
    case "404":
      return {
        code: "404",
        statusLabel: "NOT FOUND",
        headline: "This page has been misplaced.",
        standfirst:
          "The link you followed points to nothing in the current docs.",
        exitLabel: "Try instead",
        exits: [
          { label: "Documentation home", href: docsRoute },
          { label: "Getting started", href: "/docs/tutorial/first-note" },
          { label: "Search the docs", action: "search" },
        ],
      };
    case "500":
      return {
        code: "500",
        statusLabel: "ERROR",
        headline: "Something broke on our end.",
        standfirst:
          "An unexpected fault interrupted this page — reloading usually fixes it.",
        exitLabel: "Recovery actions",
        exits: [
          { label: "Reload this page", action: "reset" },
          { label: "Documentation home", href: docsRoute },
          {
            label: "Report an issue",
            href: `https://github.com/${gitConfig.user}/${gitConfig.repo}/issues/new`,
          },
        ],
      };
  }
}
