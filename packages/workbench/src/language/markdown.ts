// Secondary source hints: prose keeps its ordinary typography.
import { styleTags, tags } from "@lezer/highlight";
import { parser } from "@lezer/markdown";

export const markdownParser = parser.configure({
  remove: ["HTMLBlock", "HTMLTag", "SetextHeading"],
  props: [
    styleTags({
      "HeaderMark QuoteMark": tags.special(tags.punctuation),
      ListMark: tags.special(tags.separator),
    }),
  ],
});
export const markdownTop = markdownParser.nodeSet.types.find(
  (type) => type.isTop,
)!;
