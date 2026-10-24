// Shared synthetic note shape for the host and desktop scan budgets (#1695).
// One citation per paragraph, a callout every fifth, and a fence every 25th.
// Dense/sparse prose repeats 2/30 times; truncation fixes the UTF-16 length.
export function syntheticNote(size: number, dense: boolean, links: boolean): string {
  const paragraphs: string[] = [];
  let length = 0;
  for (let n = 1; length < size; n++) {
    const prose = "Evidence supports this reading. ".repeat(dense ? 2 : 30);
    let paragraph = `${prose}[@work${n}]\n\n`;
    if (n % 5 === 0)
      paragraph += links
        ? "> [!quote] Evidence\n> [](zotero://open/library/items/ABCD2345?annotation=EFGH6789&page=2)\n\n"
        : "> [!quote] Evidence\n> A passage from the source.\n\n";
    if (n % 25 === 0)
      paragraph += `\`\`\`md\n[@excluded]${links ? " ![](zotero://open/library/items/ABCD2345?annotation=EXCL2345)" : ""}\n\`\`\`\n\n`;
    paragraphs.push(paragraph);
    length += paragraph.length;
  }
  return paragraphs.join("").slice(0, size);
}
