import { regex } from "arkregex";
import { EditorSuggest } from "obsidian";
import type {
  App,
  Editor,
  EditorPosition,
  EditorSuggestContext,
  EditorSuggestTriggerInfo,
  TFile,
} from "obsidian";

import { isEtaTemplatePath } from "@/services/template/path";

const ETA_OPEN_TAG = regex("<%([ =]?)$");
const ETA_CLOSE_TAG = regex("^([\\w ]*)%>");

interface EtaHint {
  prefix: "=" | " ";
  name: string;
  description: string;
}

const hints: EtaHint[] = [
  {
    prefix: "=",
    name: "interpolate tag",
    description: "An interpolation outputs data into the template",
  },
  {
    prefix: " ",
    name: "evaluation tag",
    description:
      "An evaluate tag inserts its contents into the template function.",
  },
];

export class EtaSuggest extends EditorSuggest<EtaHint> {
  constructor(app: App) {
    super(app);
  }

  onTrigger(
    cursor: EditorPosition,
    editor: Editor,
    file: TFile | null,
  ): EditorSuggestTriggerInfo | null {
    if (!file || !isEtaTemplatePath(file.path)) return null;

    const line = editor.getLine(cursor.line);
    const beforeCursor = line.substring(0, cursor.ch);
    const match = ETA_OPEN_TAG.exec(beforeCursor);
    if (!match) return null;

    const [full, prefix = ""] = match;
    const trailingSpace = ETA_CLOSE_TAG.exec(line.substring(cursor.ch));
    let end: EditorPosition;
    if (!trailingSpace) {
      end = { ...cursor };
    } else {
      const [, spaces = ""] = trailingSpace;
      if (prefix === " " && spaces.length === 1) return null;
      end = { ...cursor, ch: cursor.ch + spaces.length };
    }

    return {
      end,
      start: {
        ch: match.index! + full.length - prefix.length,
        line: cursor.line,
      },
      query: prefix,
    };
  }

  getSuggestions(context: EditorSuggestContext): EtaHint[] {
    if (!context.query) return hints;
    return hints.filter((hint) => hint.prefix === context.query);
  }

  renderSuggestion({ prefix, name, description }: EtaHint, el: HTMLElement) {
    if (prefix === " ") el.createSpan({ text: "No Prefix" });
    else el.createEl("code", { text: prefix });
    el.createDiv({ text: name });
    el.createDiv({ text: description });
  }

  selectSuggestion({ prefix }: EtaHint): void {
    if (!this.context) return;

    const { editor, end, start } = this.context;
    const text = prefix === " " ? "  " : "= zt. ";
    editor.transaction({
      changes: [{ from: start, to: end, text }],
      selection: { from: { ...start, ch: start.ch + text.length - 1 } },
    });
  }
}
