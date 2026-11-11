# Fact sheet — Lesson 1

Checked against the running apps: Obsidian 1.14.5, Zotero 10.0, ZotLit on
`next` (walk `connect-zotero-to-obsidian` on branch `docs/learn-walks`).
On-screen labels are in **bold** and are exact.

## The lesson

- **Number:** 1 of 6. About 10 minutes.
- **The reader ends with:** ZotLit connected to their Zotero library, and a
  first literature note for one paper with their own thoughts in it.
- **Search words the title and description carry:** connect Zotero to
  Obsidian; how to use Zotero with Obsidian; literature note.
- **The reader needs:** Obsidian 1.14.5 or later on a desktop computer;
  Zotero 10 on the same computer; one paper in Zotero with a PDF they have
  highlighted.
- **True and worth saying once:** Zotero can stay closed. ZotLit reads the
  library on this computer and sends nothing to a server. Nothing in this
  lesson changes the Zotero library. No other add-on is needed.
- **Next lesson:** 2, "Read and annotate a paper in Obsidian".

## Steps

Pictures are at `apps/docs/public/img/learn/connect-zotero-to-obsidian/`.

### Step 1 — Install ZotLit

- **Action:** in Obsidian, open **Settings**, then **Community plugins**,
  then **Browse**. Search for `ZotLit`. Select **Install**, then **Enable**.
  If Obsidian asks first, select **Turn on community plugins**.
- **Result:** a tab named **Zotero library** opens. It starts with a badge
  **Let's get started** and four setup steps above the list of papers.
- **Picture:** `step-1.webp` (the result).
- **Fixes:**
  - A notice says Obsidian's installer is too old: download Obsidian again
    from obsidian.md/download, install it over the old one, enable ZotLit.
  - No tab opened: select the ZotLit icon in the ribbon on the left edge of
    Obsidian.

### Step 2 — Check that ZotLit found Zotero

- **Action:** the reader looks at the first setup step. When the check is
  there, they close the setup section with the × button at its top right.
- **Result:** **Connect to Zotero** has a green check, with the Zotero data
  folder (for example `~/Zotero`) and the number of items (for example
  `5 items`). ZotLit found Zotero by itself. After the section closes, the
  list of papers fills the tab.
- **Also on screen, to leave alone:** **Choose where literature notes live**
  (the folder `literatures` is already set); **Open your library**;
  **Install ZotLit Companion**, marked **Recommended**, which this lesson
  does not need.
- **Picture:** `step-2.webp`.
- **Fix:** the tab reads **Zotero not found**. In Zotero, open **Settings**,
  then **Advanced**, and read **Data Directory Location**. In Obsidian,
  select **Locate data folder** and choose that folder.

### Step 3 — Find a paper

- **Action:** type a few words of a title into **Search papers**. Select the
  paper in the list.
- **Result:** a card opens under the list. It shows the title, the authors,
  the journal and year (for example *PLOS Computational Biology, 9(10),
  e1003285 · 2013*), and the buttons **Open PDF** and **Write literature
  note**.
- **Picture:** `step-3.webp`. A recording of this step is being made.
- **Fix:** the list is empty: go back to step 2 and look for the green check.

### Step 4 — Open the PDF

- **Action:** on the card, select **Open PDF**.
- **Result:** the PDF opens in a new tab, at the page where the reader last
  read it in Zotero. The Zotero highlights show in their colours. The right
  side lists each highlight as a card with its page, the reader's comment and
  tags.
- **True and worth saying:** ZotLit opens the PDF where Zotero keeps it. It
  does not copy the file.
- **Picture:** `step-4.webp`.
- **Fix:** no highlights show: scroll to a page that has one. If the paper
  has none in Zotero yet, carry on; Lesson 2 adds one.

### Step 5 — Write the literature note

- **Action:** go back to the **Zotero library** tab. On the card, select
  **Write literature note**.
- **Result:** the notice **Literature note created.** The note opens in a new
  tab. It is a file named after the paper's citation key, for example
  `sandve2013`, in the folder `literatures`. It holds the paper's title, one
  line with a link to Zotero and a link to the PDF, and a section
  **Annotations** with a card for each highlight.
- **Picture:** `step-5.webp`.
- **Fix:** the button reads **Open literature note**: this paper already has
  a note; select the button to open it.

### Step 6 — Add your own thoughts

- **Action:** under the line with the two links, type a heading, such as
  `My thoughts`, and write what the paper means for the chapter.
- **Result:** the reader's text sits above the **Annotations** section.
- **True and worth showing as a small table:** what the reader writes is
  theirs; ZotLit never changes it and it never goes to Zotero. The
  **Annotations** section belongs to ZotLit; it shows the Zotero highlights
  and stays current by itself.
- **Picture:** `step-6.webp`.
- **Fix:** there are no highlight cards: the paper has no highlights in
  Zotero yet; they appear when the reader adds one.
