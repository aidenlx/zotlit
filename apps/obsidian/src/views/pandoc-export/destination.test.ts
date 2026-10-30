import { join, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

import { exportDestinationLocation } from "./destination";

const homePath = resolve("researcher");
const vaultPath = join(homePath, "Thesis");
const context = { vaultPath, homePath };

describe("export destination display", () => {
  it("uses the vault-relative path before home abbreviation", () => {
    expect(
      exportDestinationLocation(
        join(vaultPath, "Drafts", "Chapter 3.docx"),
        context,
      ),
    ).toEqual({ kind: "vault", path: join("Drafts", "Chapter 3.docx") });
  });

  it("abbreviates an external destination in the home folder", () => {
    expect(
      exportDestinationLocation(
        join(homePath, "Documents", "Chapter 3.docx"),
        context,
      ),
    ).toEqual({
      kind: "external",
      path: join("~", "Documents", "Chapter 3.docx"),
    });
  });

  it("keeps the destination absolute outside the home folder", () => {
    const destination = resolve("shared", "Chapter 3.docx");
    expect(exportDestinationLocation(destination, context)).toEqual({
      kind: "external",
      path: destination,
    });
  });

  it("keeps a sibling vault outside the current vault", () => {
    expect(
      exportDestinationLocation(
        join(`${vaultPath}-archive`, "Chapter 3.docx"),
        context,
      ),
    ).toEqual({
      kind: "external",
      path: join("~", "Thesis-archive", "Chapter 3.docx"),
    });
  });

  it("keeps a sibling home path absolute", () => {
    const destination = join(`${homePath}-other`, "Chapter 3.docx");
    expect(exportDestinationLocation(destination, context)).toEqual({
      kind: "external",
      path: destination,
    });
  });

  it("resolves parent segments before deciding whether the destination is in the vault", () => {
    const destination = `${vaultPath}${sep}..${sep}Documents${sep}Chapter 3.docx`;
    expect(exportDestinationLocation(destination, context)).toEqual({
      kind: "external",
      path: join("~", "Documents", "Chapter 3.docx"),
    });
  });
});
