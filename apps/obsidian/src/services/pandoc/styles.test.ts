import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { listInstalledStyles, loadStyleXml, StyleXmlCache } from "./styles";

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "zotlit-csl-styles-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

interface StyleFixture {
  id: string;
  title?: string;
  parentId?: string;
  hidden?: boolean;
}

/** Write a CSL file shaped like the ones Zotero installs. */
async function writeStyle(
  filename: string,
  { id, title, parentId, hidden }: StyleFixture,
): Promise<void> {
  const dir = join(dataDir, "styles", ...(hidden ? ["hidden"] : []));
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, filename),
    [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0">',
      "  <info>",
      ...(title === undefined ? [] : [`    <title>${title}</title>`]),
      `    <id>${id}</id>`,
      `    <link href="${id}" rel="self"/>`,
      ...(parentId === undefined
        ? []
        : [`    <link href="${parentId}" rel="independent-parent"/>`]),
      "  </info>",
      `  <bibliography><layout><text value="${id}"/></layout></bibliography>`,
      "</style>",
    ].join("\n"),
  );
}

describe("listInstalledStyles", () => {
  it("lists visible styles by style ID, sorted by title", async () => {
    await writeStyle("apa.csl", {
      id: "http://www.zotero.org/styles/apa",
      title: "APA Style 7th edition",
    });
    // Filename and style ID disagree: the ID is the identity that matters.
    await writeStyle("renamed.csl", {
      id: "http://www.zotero.org/styles/chicago-author-date",
      title: "Chicago Manual of Style 18th edition (author-date)",
    });
    await writeStyle("notes.txt", { id: "not-a-style" });

    await expect(listInstalledStyles(dataDir)).resolves.toEqual([
      {
        id: "http://www.zotero.org/styles/apa",
        title: "APA Style 7th edition",
      },
      {
        id: "http://www.zotero.org/styles/chicago-author-date",
        title: "Chicago Manual of Style 18th edition (author-date)",
      },
    ]);
  });

  it("omits hidden styles, which serve only as independent parents", async () => {
    await writeStyle("nature.csl", {
      id: "http://www.zotero.org/styles/nature",
      title: "Nature",
      hidden: true,
    });
    await writeStyle("apa.csl", {
      id: "http://www.zotero.org/styles/apa",
      title: "APA",
    });

    await expect(listInstalledStyles(dataDir)).resolves.toEqual([
      { id: "http://www.zotero.org/styles/apa", title: "APA" },
    ]);
  });

  it("decodes entities in a title and falls back to the filename", async () => {
    await writeStyle("ampersand.csl", {
      id: "http://www.zotero.org/styles/ampersand",
      title: "Alcohol &amp; Drug Education",
    });
    await writeStyle("untitled.csl", {
      id: "http://www.zotero.org/styles/untitled",
    });

    await expect(listInstalledStyles(dataDir)).resolves.toEqual([
      {
        id: "http://www.zotero.org/styles/ampersand",
        title: "Alcohol & Drug Education",
      },
      { id: "http://www.zotero.org/styles/untitled", title: "untitled" },
    ]);
  });

  it("lists nothing when Zotero installed no styles", async () => {
    await expect(listInstalledStyles(dataDir)).resolves.toEqual([]);
  });
});

describe("loadStyleXml", () => {
  it("loads the selected independent style", async () => {
    await writeStyle("apa.csl", {
      id: "http://www.zotero.org/styles/apa",
      title: "APA",
    });

    await expect(
      loadStyleXml(dataDir, "http://www.zotero.org/styles/apa"),
    ).resolves.toContain("<id>http://www.zotero.org/styles/apa</id>");
  });

  it("loads the independent parent of a dependent style", async () => {
    await writeStyle("nature-neuroscience.csl", {
      id: "http://www.zotero.org/styles/nature-neuroscience",
      title: "Nature Neuroscience",
      parentId: "http://www.zotero.org/styles/nature",
    });
    await writeStyle("nature.csl", {
      id: "http://www.zotero.org/styles/nature",
      title: "Nature",
      hidden: true,
    });

    await expect(
      loadStyleXml(dataDir, "http://www.zotero.org/styles/nature-neuroscience"),
    ).resolves.toContain("<id>http://www.zotero.org/styles/nature</id>");
  });

  it("falls back to the embedded default style", async () => {
    await writeStyle("orphan.csl", {
      id: "http://www.zotero.org/styles/orphan",
      title: "Orphan",
      parentId: "http://www.zotero.org/styles/uninstalled",
    });

    // Unset setting.
    await expect(loadStyleXml(dataDir, null)).resolves.toBeUndefined();
    // Style file removed or renamed since it was selected.
    await expect(
      loadStyleXml(dataDir, "http://www.zotero.org/styles/removed"),
    ).resolves.toBeUndefined();
    // Dependent style whose independent parent is not installed.
    await expect(
      loadStyleXml(dataDir, "http://www.zotero.org/styles/orphan"),
    ).resolves.toBeUndefined();
  });
});

describe("StyleXmlCache", () => {
  const APA = "http://www.zotero.org/styles/apa";
  const IEEE = "http://www.zotero.org/styles/ieee";

  /** A whole-second timestamp, which every filesystem stores exactly. */
  const PINNED = 1_700_000_000;

  it("re-reads a style file only when its timestamp moves", async () => {
    const path = join(dataDir, "styles", "apa.csl");
    await writeStyle("apa.csl", { id: APA, title: "APA" });
    await utimes(path, PINNED, PINNED);

    const styles = new StyleXmlCache();
    await expect(styles.load(dataDir, APA)).resolves.toContain(
      "<title>APA</title>",
    );

    // A body written under the timestamp the read already ran against is a
    // body no read looks at.
    await writeStyle("apa.csl", { id: APA, title: "APA Revised" });
    await utimes(path, PINNED, PINNED);
    await expect(styles.load(dataDir, APA)).resolves.toContain(
      "<title>APA</title>",
    );

    await utimes(path, PINNED + 1, PINNED + 1);
    await expect(styles.load(dataDir, APA)).resolves.toContain(
      "<title>APA Revised</title>",
    );
  });

  it("reads the style the setting names, and re-reads on a change of style", async () => {
    await writeStyle("apa.csl", { id: APA, title: "APA" });
    await writeStyle("ieee.csl", { id: IEEE, title: "IEEE" });
    const styles = new StyleXmlCache();

    await expect(styles.load(dataDir, APA)).resolves.toContain(
      `<id>${APA}</id>`,
    );
    await expect(styles.load(dataDir, IEEE)).resolves.toContain(
      `<id>${IEEE}</id>`,
    );
    await expect(styles.load(dataDir, APA)).resolves.toContain(
      `<id>${APA}</id>`,
    );
  });

  it("holds nothing for an unset or uninstalled style", async () => {
    const styles = new StyleXmlCache();

    await expect(styles.load(dataDir, null)).resolves.toBeUndefined();
    await expect(styles.load(dataDir, APA)).resolves.toBeUndefined();

    // A style installed after the miss is still found.
    await writeStyle("apa.csl", { id: APA, title: "APA" });
    await expect(styles.load(dataDir, APA)).resolves.toContain(
      `<id>${APA}</id>`,
    );
  });
});
