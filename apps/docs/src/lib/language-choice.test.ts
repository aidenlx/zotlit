// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CHINESE_READER_ATTR,
  LANGUAGE_CHOICE_KEY,
  chineseReaderScript,
} from "./language-choice";

/** Run the <head> script as the browser would, under the given browser languages. */
function runHeadScript(languages: string[]) {
  vi.spyOn(navigator, "languages", "get").mockReturnValue(languages);
  // oxlint-disable-next-line typescript/no-implied-eval -- the script ships as an inline <script> string; this runs that exact string.
  new Function(chineseReaderScript)();
  return document.documentElement.hasAttribute(CHINESE_READER_ATTR);
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  document.documentElement.removeAttribute(CHINESE_READER_ATTR);
});

// Failure modes: a Chinese-first reader (Traditional included) gets no
// suggestion; an English-first reader with Chinese second, or a language code
// that only starts with "zh", gets one; the reader's English choice is ignored.
describe("chineseReaderScript", () => {
  it.each([
    [["zh"], true],
    [["zh-TW", "en"], true],
    [["en-US", "zh-CN"], false],
    [["zhx"], false],
  ])("marks %j: %s", (languages, marked) => {
    expect(runHeadScript(languages)).toBe(marked);
  });

  it("respects a reader who chose English", () => {
    localStorage.setItem(LANGUAGE_CHOICE_KEY, "en");
    expect(runHeadScript(["zh-CN"])).toBe(false);
  });
});
