// Blockquote `>`-prefix formatting shared by the Eta and Liquid engines.

export function formatBlockquote(content: string): string {
  const lines = content
    .trim()
    .split("\n")
    .map((line) => (line.trim() === "" ? ">" : `> ${line}`));
  return lines
    .filter((line, i) => !(line === ">" && lines[i - 1] === ">"))
    .join("\n");
}
