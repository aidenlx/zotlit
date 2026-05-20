import { EditorState, type Extension, Prec } from "@codemirror/state";
import { editorInfoField, type TFile, type Vault } from "obsidian";

import { isEtaTemplatePath } from "@/services/template/path";

interface CloseBracketsLanguageData {
  closeBrackets: {
    brackets: string[];
  };
}

export function bracketExtension(vault: Vault): Extension {
  return Prec.highest(
    EditorState.languageData.of((state) => {
      const brackets: string[] = [];
      const config = vault as Vault & {
        getConfig(name: "autoPairBrackets" | "autoPairMarkdown"): boolean;
      };

      if (config.getConfig("autoPairBrackets")) {
        brackets.push("(", "[", "{", "'", '"');
      }
      if (config.getConfig("autoPairMarkdown")) {
        brackets.push("*", "_", "`", "```");
      }

      const fileInfo = state.field(editorInfoField, false);
      if (fileInfo?.file && isEtaFile(fileInfo.file)) {
        brackets.push("<", "%");
      }

      return [
        {
          closeBrackets: { brackets },
        } satisfies CloseBracketsLanguageData,
      ];
    }),
  );
}

function isEtaFile(file: TFile): boolean {
  return isEtaTemplatePath(file.path);
}
